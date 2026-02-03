import { useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import DemoPackLoader from './components/DemoPackLoader';
import ReadOnlyBanner from './components/ReadOnlyBanner';
import PackStatusChip from './components/PackStatusChip';
import VerdictHeader from './components/VerdictHeader';
import CaseHeader from './components/CaseHeader';
import OutcomePanel from './components/OutcomePanel';
import RoundsTimeline from './components/RoundsTimeline';
import IntegrityPanel from './components/IntegrityPanel';
import WarningsAndExceptionsPanel from './components/WarningsAndExceptionsPanel';
import ResponsibilityPanel from './components/ResponsibilityPanel';
import InsurancePanel from './components/InsurancePanel';
import PassportPanel from './components/PassportPanel';
import EvidenceFilesPanel from './components/EvidenceFilesPanel';
import VerifyBlock from './components/VerifyBlock';
import CopyVerifyCommandButton from './components/CopyVerifyCommandButton';
import ExportPDFButton from './components/ExportPDFButton';
import ExportInsurerPDFButton from './components/ExportInsurerPDFButton';
import GenerateClaimsPackageButton from './components/GenerateClaimsPackageButton';
import { loadPackFromFile } from './lib/loadPack';
import type { AuditorPackData, PackVerifyResultView, ReplayVerifyResultView } from './types';
import './App.css';

function App() {
  const [packData, setPackData] = useState<AuditorPackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFileSelect = async (file: File, verifyPath?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await loadPackFromFile(file);
      // Demo packs: show packs/<file>.zip; dragged file: show filename
      setPackData(
        verifyPath != null
          ? { ...data, source: 'demo_public', demoPublicPath: verifyPath }
          : data
      );
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
        <ReadOnlyBanner packData={packData} />
        
        {!packData ? (
          <div className="upload-section">
            <DemoPackLoader onLoadPack={handleFileSelect} isLoading={isLoading} />
            <p className="upload-helper">Choose a demo pack or drag-drop an Auditor Pack ZIP.</p>
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

            <VerdictHeader
              gcView={packData.gcView}
              judgment={packData.judgment}
              packData={packData}
            />

            <VerifyBlock packData={packData} />

            <PackStatusChip
              fileName={packData.zipFile?.name || 'pack.zip'}
              packData={packData}
            />

            <CaseHeader
              manifest={packData.manifest}
              gcView={packData.gcView}
              transcriptId={packData.transcriptId}
            />

            <div className="panels-grid">
              <div className="panels-left">
                <OutcomePanel gcView={packData.gcView} />
                <RoundsTimeline
                  transcriptJson={packData.transcript}
                  replayVerifyResult={packData.replayVerifyResult as ReplayVerifyResultView | null | undefined}
                  packVerifyResult={packData.packVerifyResult as PackVerifyResultView | null | undefined}
                />
              </div>
              <div className="panels-right">
                <IntegrityPanel 
                  gcView={packData.gcView} 
                  packFileName={packData.zipFile?.name}
                  merkleDigest={packData.merkleDigest}
                  packData={packData}
                />
                <WarningsAndExceptionsPanel packData={packData} />
                <ResponsibilityPanel
                  judgment={packData.judgment}
                  gcView={packData.gcView}
                />
                <InsurancePanel insurerSummary={packData.insurerSummary} />
                <PassportPanel
                  manifest={packData.manifest}
                  transcriptJson={packData.transcript}
                  gcView={packData.gcView}
                  judgment={packData.judgment}
                  insurerSummary={packData.insurerSummary}
                  transcriptId={packData.transcriptId}
                />
              </div>
            </div>

            <EvidenceFilesPanel packData={packData} />

            <div className="viewer-footer-copy">
              <CopyVerifyCommandButton packData={packData} variant="panel" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
