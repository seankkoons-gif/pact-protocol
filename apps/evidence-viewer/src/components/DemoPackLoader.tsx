import { useState, useEffect, useRef } from 'react';

interface DemoPackLoaderProps {
  onLoadPack: (file: File, verifyPath?: string) => void;
  isLoading: boolean;
  onError?: (message: string) => void;
}

const DEMO_PACKS = [
  {
    id: 'success',
    label: 'Success',
    description: 'Completed transaction, no fault',
    path: 'packs/auditor_pack_success.zip',
    filename: 'auditor_pack_success.zip',
  },
  {
    id: '101',
    label: 'Policy Abort (PACT-101)',
    description: 'Buyer policy violation',
    path: 'packs/auditor_pack_101.zip',
    filename: 'auditor_pack_101.zip',
  },
  {
    id: '420',
    label: 'Provider Unreachable (PACT-420)',
    description: 'Provider failed to respond',
    path: 'packs/auditor_pack_420.zip',
    filename: 'auditor_pack_420.zip',
  },
  {
    id: 'tamper',
    label: 'Tamper Detection',
    description: 'Semantic tampering detected',
    path: 'packs/auditor_pack_semantic_tampered.zip',
    filename: 'auditor_pack_semantic_tampered.zip',
  },
] as const;

export default function DemoPackLoader({ onLoadPack, isLoading, onError }: DemoPackLoaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showDropdown]);

  const loadDemo = async (demo: (typeof DEMO_PACKS)[number]) => {
    setShowDropdown(false);
    setSelectedId(demo.id);
    try {
      const res = await fetch(`/${demo.path}`);
      if (!res.ok) throw new Error(`Failed to fetch ${demo.filename}`);
      const blob = await res.blob();
      const file = new File([blob], demo.filename, { type: 'application/zip' });
      onLoadPack(file, demo.path);
    } catch (err) {
      console.error(err);
      setSelectedId(null);
      onError?.(err instanceof Error ? err.message : 'Failed to load demo pack');
    }
  };

  return (
    <div className="demo-pack-loader" ref={containerRef}>
      <button
        type="button"
        className="show-demo-button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isLoading}
        aria-expanded={showDropdown}
        aria-haspopup="listbox"
      >
        {showDropdown ? 'Choose a demo' : 'Show Demo'}
      </button>

      {showDropdown && (
        <div className="demo-dropdown" role="listbox">
          {DEMO_PACKS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              role="option"
              className={`demo-option ${selectedId === demo.id ? 'selected' : ''}`}
              onClick={() => loadDemo(demo)}
              disabled={isLoading}
            >
              <span className="demo-option-label">{demo.label}</span>
              <span className="demo-option-desc">{demo.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
