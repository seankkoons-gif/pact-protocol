import './DemoPackLoader.css';

export const DEMO_PACKS = [
  { label: 'Success', filename: 'auditor_pack_success.zip' },
  { label: 'Policy Abort 101', filename: 'auditor_pack_101.zip' },
  { label: 'Timeout 420', filename: 'auditor_pack_420.zip' },
  { label: 'Tamper (derived output altered)', filename: 'auditor_pack_semantic_tampered.zip' },
] as const;

interface DemoPackLoaderProps {
  onLoadPack: (file: File, verifyPath?: string) => void;
  isLoading: boolean;
}

export default function DemoPackLoader({ onLoadPack, isLoading }: DemoPackLoaderProps) {
  const handleSelect = async (filename: string) => {
    if (!filename) return;
    try {
      const response = await fetch(`/packs/${filename}`);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const file = new File([blob], filename, { type: 'application/zip' });
      onLoadPack(file, `packs/${filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load pack';
      console.error('Demo pack load failed:', msg);
      alert(`Failed to load demo pack: ${msg}\n\nEnsure packs exist in public/packs/`);
    }
  };

  return (
    <div className="demo-pack-loader">
      <label htmlFor="demo-pack-select" className="demo-pack-label">
        Load Demo Pack:
      </label>
      <select
        id="demo-pack-select"
        className="demo-pack-select"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) handleSelect(v);
          e.target.value = '';
        }}
        disabled={isLoading}
        aria-label="Load a demo auditor pack"
      >
        <option value="">— Choose one —</option>
        {DEMO_PACKS.map(({ label, filename }) => (
          <option key={filename} value={filename}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
