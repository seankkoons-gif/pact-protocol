import { useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import DemoMode from './components/DemoMode';
import ReadOnlyBanner from './components/ReadOnlyBanner';
import PackStatusChip from './components/PackStatusChip';
import CaseHeader from './components/CaseHeader';
import OutcomePanel from './components/OutcomePanel';
import IntegrityPanel from './components/IntegrityPanel';
import ResponsibilityPanel from './components/ResponsibilityPanel';
import InsurancePanel from './components/InsurancePanel';
import PassportPanel from './components/PassportPanel';
import EvidenceFilesPanel from './components/EvidenceFilesPanel';
import VerifyLocally from './components/VerifyLocally';
import ExportPDFButton from './components/ExportPDFButton';
import ExportInsurerPDFButton from './components/ExportInsurerPDFButton';
import GenerateClaimsPackageButton from './components/GenerateClaimsPackageButton';
import { loadPackFromFile } from './lib/loadPack';
import type { AuditorPackData } from './types';
import './App.css';

function App() {
  const [packData, setPackData] = useState<AuditorPackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const handleFileSelect = async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadPackFromFile(file);
      setPackData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse auditor pack');
      setPackData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Listen for demo pack load events
  useEffect(() => {
    const handleDemoPack = (event: CustomEvent<{ file: File }>) => {
      handleFileSelect(event.detail.file);
    };
    window.addEventListener('loadDemoPack', handleDemoPack as EventListener);
    return () => {
      window.removeEventListener('loadDemoPack', handleDemoPack as EventListener);
    };
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Pact Evidence Viewer</h1>
        <p className="app-subtitle">Read-only evidence viewer for Auditor Packs</p>
      </header>

      <main className="app-main">
        <ReadOnlyBanner packFileName={packData?.zipFile?.name} />
        
        {!packData ? (
          <div className="upload-section">
            <div className="demo-toggle-container">
              <button 
                className="demo-toggle"
                onClick={() => setDemoMode(!demoMode)}
              >
                {demoMode ? '▼ Hide Demo Mode' : '▶ Show Demo Mode'}
              </button>
            </div>
            {demoMode && (
              <DemoMode onLoadPack={handleFileSelect} isLoading={isLoading} />
            )}
            <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />
            {error && (
              <div className="error-message">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>
        ) : (
          <div className="viewer-section">
            <div className="viewer-header">
              <button className="back-button" onClick={() => setPackData(null)}>
                ← Load Different Pack
              </button>
              <div className="export-buttons">
                <ExportPDFButton packData={packData} />
                <ExportInsurerPDFButton packData={packData} />
                <GenerateClaimsPackageButton packData={packData} />
              </div>
            </div>

            <PackStatusChip
              fileName={packData.zipFile?.name || 'unknown.zip'}
              gcView={packData.gcView}
            />

            <CaseHeader
              manifest={packData.manifest}
              gcView={packData.gcView}
              transcriptId={packData.transcriptId}
            />

            <div className="panels-grid">
              <div className="panels-left">
                <OutcomePanel gcView={packData.gcView} />
              </div>
              <div className="panels-right">
                <IntegrityPanel 
                  gcView={packData.gcView} 
                  packFileName={packData.zipFile?.name}
                  merkleDigest={packData.merkleDigest}
                />
                <ResponsibilityPanel
                  judgment={packData.judgment}
                  gcView={packData.gcView}
                />
                <InsurancePanel insurerSummary={packData.insurerSummary} />
                <PassportPanel
                  insurerSummary={packData.insurerSummary}
                  gcView={packData.gcView}
                  judgment={packData.judgment}
                  transcriptId={packData.transcriptId}
                />
              </div>
            </div>

            <EvidenceFilesPanel packData={packData} />

            <VerifyLocally packFileName={packData.zipFile?.name} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
