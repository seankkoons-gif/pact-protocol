import { useState, useEffect } from 'react';
import FileUpload from './components/FileUpload';
import DemoPackLoader from './components/DemoPackLoader';
import PackStatusChip from './components/PackStatusChip';
import VerdictHeader from './components/VerdictHeader';
import ExecutionSummaryPanel from './components/ExecutionSummaryPanel';
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
import ExportPDFButton from './components/ExportPDFButton';
import ExportInsurerPDFButton from './components/ExportInsurerPDFButton';
import GenerateClaimsPackageButton from './components/GenerateClaimsPackageButton';
import AttachmentsDropZone, { type AttachmentEntry } from './components/AttachmentsDropZone';
import { loadPackFromFile, PackLoadError } from './lib/loadPack';
import type { AuditorPackData, PackVerifyResultView, ReplayVerifyResultView } from './types';
import './App.css';

function App() {
  const [packData, setPackData] = useState<AuditorPackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentEntry[]>([]);

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
      if (err instanceof PackLoadError) {
        const found = err.foundPaths.length > 0
          ? `\n\nFound paths in ZIP:\n${err.foundPaths.map((p) => `  • ${p}`).join('\n')}`
          : '\n\nZIP appears empty or has no recognized entries.';
        setError(`Invalid auditor pack. Missing: ${err.missing.join(', ')}.${found}`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to parse auditor pack');
      }
      setPackData(null);
      setAttachments([]);
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
        <div className="app-header-inner">
          <h1>Pact Evidence Viewer</h1>
          <p className="app-subtitle">Read-only evidence viewer for Auditor Packs</p>
        </div>
      </header>

      <main className="app-main">
        {!packData ? (
          <div className="container">
            <div className="read-only-frame">
              <div className="read-only-frame-title">Read-Only Evidence Viewer</div>
              <div className="read-only-frame-desc">
                <p>This viewer is read-only and does not execute transactions. The source of truth is the Auditor Pack ZIP.</p>
                <p>This UI does not perform verification; verification must be done with the pact-verifier CLI.</p>
                <p>For audit, dispute review, and insurance workflows. This tool does not provide legal advice.</p>
              </div>
            </div>
            <VerifyBlock packData={null} />
            <DemoPackLoader onLoadPack={handleFileSelect} isLoading={isLoading} onError={(msg) => setError(msg)} />
            <p className="upload-helper">Or drag-drop an Auditor Pack ZIP below</p>
            <FileUpload
              onFileSelect={handleFileSelect}
              onError={(msg) => setError(msg || null)}
              isLoading={isLoading}
            />
            {error && (
              <div className="error-message" role="alert">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>
        ) : (
          <div className="container">
            <div className="read-only-frame">
              <div className="read-only-frame-title">Read-Only Evidence Viewer</div>
              <div className="read-only-frame-desc">
                <p>This viewer is read-only and does not execute transactions. The source of truth is the Auditor Pack ZIP.</p>
                <p>This UI does not perform verification; verification must be done with the pact-verifier CLI.</p>
                <p>For audit, dispute review, and insurance workflows. This tool does not provide legal advice.</p>
              </div>
            </div>
          <div className="viewer-section">
            {packData.source === 'demo_public' &&
              (packData.packVerifyResult as { recompute_ok?: boolean } | undefined)?.recompute_ok === false &&
              !packData.demoPublicPath?.includes('semantic_tampered') && (
                <div className="demo-out-of-sync-banner" role="alert">
                  This demo pack is out of sync with the current verifier. Regenerate required.
                </div>
              )}
            <VerdictHeader
              gcView={packData.gcView}
              judgment={packData.judgment}
              packData={packData}
            />

            <ExecutionSummaryPanel
              gcView={packData.gcView}
              transcriptJson={packData.transcript}
              replayVerifyResult={packData.replayVerifyResult as { errors?: Array<{ round_number?: number; message?: string }> } | null | undefined}
            />

            <VerifyBlock packData={packData} />

            <header className="viewer-header">
              <button
                className="back-button"
                onClick={() => {
                  setPackData(null);
                  setAttachments([]);
                }}
              >
                ← Load Different Pack
              </button>
              <div className="export-buttons-row" role="group" aria-label="Export actions">
                <ExportPDFButton packData={packData} />
                <ExportInsurerPDFButton packData={packData} />
                <GenerateClaimsPackageButton packData={packData} attachments={attachments} />
              </div>
            </header>

            <div className="case-header-row">
              <PackStatusChip
                fileName={packData.zipFile?.name || 'pack.zip'}
                packData={packData}
              />
              <CaseHeader
                manifest={packData.manifest}
                gcView={packData.gcView}
                transcriptId={packData.transcriptId ?? '—'}
                packVerifyResult={packData.packVerifyResult as { tool_version?: string } | null | undefined}
              />
            </div>

            <div className="claims-section">
              <AttachmentsDropZone
                attachments={attachments}
                onAttachmentsChange={setAttachments}
              />
            </div>

            <div className="panels-stack">
              <OutcomePanel gcView={packData.gcView} />
              <RoundsTimeline
                transcriptJson={packData.transcript}
                replayVerifyResult={packData.replayVerifyResult as ReplayVerifyResultView | null | undefined}
                packVerifyResult={packData.packVerifyResult as PackVerifyResultView | null | undefined}
              />
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
              <EvidenceFilesPanel packData={packData} />
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}

export default App;
