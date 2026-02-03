import { useCallback } from 'react';

interface DemoPackLoaderProps {
  onLoadPack: (file: File, verifyPath?: string) => void;
  isLoading: boolean;
  onError?: (message: string) => void;
}

/** Demo packs: labels must match pack semantics. Expected UI when loaded:
 *  - Success: COMPLETED, NO_FAULT, Integrity VALID
 *  - Policy Abort 101: ABORTED_POLICY, BUYER_AT_FAULT, Integrity VALID
 *  - Timeout 420: FAILED_PROVIDER_UNREACHABLE, PROVIDER_AT_FAULT, Integrity VALID
 *  - Tamper: Integrity TAMPERED (ok=false, recompute_ok=false)
 */
const DEMO_PACKS = [
  { id: '', label: 'Choose a demo pack...', path: '', filename: '' },
  { id: 'success', label: 'Success', path: 'packs/auditor_pack_success.zip', filename: 'auditor_pack_success.zip' },
  { id: '101', label: 'Policy Abort 101', path: 'packs/auditor_pack_101.zip', filename: 'auditor_pack_101.zip' },
  { id: '420', label: 'Timeout 420', path: 'packs/auditor_pack_420.zip', filename: 'auditor_pack_420.zip' },
  { id: 'tamper', label: 'Tamper', path: 'packs/auditor_pack_semantic_tampered.zip', filename: 'auditor_pack_semantic_tampered.zip' },
] as const;

export default function DemoPackLoader({ onLoadPack, isLoading, onError }: DemoPackLoaderProps) {
  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      const demo = DEMO_PACKS.find((d) => d.id === id);
      if (!demo || !demo.path) return;
      try {
        const res = await fetch(`/${demo.path}`);
        if (!res.ok) throw new Error(`Failed to fetch ${demo.filename}`);
        const blob = await res.blob();
        const file = new File([blob], demo.filename, { type: 'application/zip' });
        onLoadPack(file, demo.path);
      } catch (err) {
        console.error(err);
        onError?.(err instanceof Error ? err.message : 'Failed to load demo pack');
      } finally {
        e.target.value = '';
      }
    },
    [onLoadPack, onError]
  );

  return (
    <div className="demo-pack-loader">
      <label htmlFor="demo-select" className="demo-label">
        Select a demo pack
      </label>
      <select
        id="demo-select"
        className="demo-select"
        onChange={handleChange}
        disabled={isLoading}
        value=""
      >
        {DEMO_PACKS.map((d) => (
          <option key={d.id || 'placeholder'} value={d.id} disabled={!d.path}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}
