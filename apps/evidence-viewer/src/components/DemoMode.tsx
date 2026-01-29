import './DemoMode.css';

interface DemoModeProps {
  onLoadPack: (file: File) => void;
  isLoading: boolean;
}

const DEMO_PACKS = [
  {
    name: 'Success Pack',
    path: '/packs/success.zip',
    fileName: 'success.zip',
    description: 'COMPLETED transaction with NO_FAULT',
  },
  {
    name: 'Policy Abort Pack',
    path: '/packs/policy_abort.zip',
    fileName: 'policy_abort.zip',
    description: 'ABORTED_POLICY with BUYER_AT_FAULT',
  },
  {
    name: 'Tamper Pack',
    path: '/packs/tamper.zip',
    fileName: 'tamper.zip',
    description: 'FAILED_INTEGRITY with tamper detection',
  },
];

export default function DemoMode({ onLoadPack, isLoading }: DemoModeProps) {
  const handleLoadPack = async (path: string, fileName: string) => {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load: ${response.statusText} (${response.status})`);
      }
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: 'application/zip' });
      onLoadPack(file);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to load demo pack from ${path}:`, errorMsg);
      alert(`Failed to load demo pack: ${errorMsg}\n\nPlease ensure demo packs are available in public/packs/.`);
    }
  };

  return (
    <div className="demo-mode">
      <h3 className="demo-title">Demo Mode</h3>
      <p className="demo-description">Load pre-configured auditor packs for demonstration:</p>
      <div className="demo-buttons">
        {DEMO_PACKS.map((pack) => (
          <button
            key={pack.name}
            className="demo-button"
            onClick={() => handleLoadPack(pack.path, pack.fileName)}
            disabled={isLoading}
          >
            <div className="demo-button-name">{pack.name}</div>
            <div className="demo-button-desc">{pack.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
