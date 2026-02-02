import type { AuditorPackData } from '../types';
import { formatConfidence } from './loadPack';
import { getIntegrityStatusForPack, getWarningsAndExceptions, displayIntegrityOrFault, displayTranscriptId, getVerdictSummaryLine, INDETERMINATE_TOOLTIP, INDETERMINATE_VERIFY_VIA_CLI } from './integrity';

/** Constructor type for jsPDF (default export is the class). */
type JSPDFConstructor = new () => InstanceType<typeof import('jspdf').default>;

/**
 * Generate a lightweight GC Summary PDF (legal greenlight page).
 * This is a single-page PDF with key information.
 */
function generateGCSummaryPDF(packData: AuditorPackData, JSPDFClass: JSPDFConstructor): Uint8Array {
  const doc = new JSPDFClass();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let yPos = margin;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PACT GC SUMMARY — LEGAL GREENLIGHT', pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  // Get data
  const { manifest, gcView, judgment, transcriptId } = packData;
  const status = gcView.executive_summary.status;
  const faultDomainRaw = gcView.responsibility.judgment?.fault_domain || judgment.dblDetermination || '—';
  const faultDomain = displayIntegrityOrFault(faultDomainRaw);
  const requiredAction = gcView.responsibility.judgment?.required_action || judgment.requiredAction || 'NONE';
  const integrityStatusRaw = getIntegrityStatusForPack(packData);
  const integrityStatus = displayIntegrityOrFault(integrityStatusRaw);
  const constitutionHash = manifest.constitution_hash;

  // Helper to add label-value pair
  const addLabelValue = (label: string, value: string, monospace: boolean = false) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label + ':', margin, yPos);
    
    if (monospace) {
      doc.setFont('courier', 'normal');
    } else {
      doc.setFont('helvetica', 'normal');
    }
    const valueLines = doc.splitTextToSize(value, contentWidth - 60);
    doc.text(valueLines, margin + 60, yPos);
    yPos += Math.max(7, valueLines.length * 5) + 3;
  };

  yPos += 5;
  addLabelValue('Transcript ID', displayTranscriptId(transcriptId), true);
  addLabelValue('Outcome', status);
  addLabelValue('Integrity', integrityStatus);
  addLabelValue('Fault Domain', faultDomain);
  addLabelValue('Required Action', requiredAction);
  addLabelValue('Constitution Hash', constitutionHash.substring(0, 32) + '...', true);

  // Footer
  const footerY = pageHeight - 15;
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(
    'Generated locally by Pact Evidence Viewer — Verifiable via auditor pack',
    pageWidth / 2,
    footerY,
    { align: 'center' }
  );

  // Return as Uint8Array
  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

/**
 * Generate the README.txt content based on pack data.
 */
function generateREADME(packData: AuditorPackData): string {
  const { gcView, judgment, insurerSummary } = packData;
  const coverage = insurerSummary.coverage;
  const moneyMoved = gcView.executive_summary.money_moved;
  const faultDomainRaw = gcView.responsibility.judgment?.fault_domain || judgment.dblDetermination || '—';
  const faultDomain = displayIntegrityOrFault(faultDomainRaw);
  const integrityStatusRaw = getIntegrityStatusForPack(packData);
  const integrityStatus = displayIntegrityOrFault(integrityStatusRaw);
  const hasNonStandardRules = insurerSummary.risk_factors?.includes('NON_STANDARD_RULES') ||
                               insurerSummary.surcharges?.includes('NON_STANDARD_CONSTITUTION') ||
                               !!insurerSummary.constitution_warning;

  const lines: string[] = [];
  lines.push('PACT CLAIMS INTAKE PACKAGE');
  lines.push('');
  lines.push('This package contains verified evidence for an agent-related transaction.');
  lines.push('All artifacts are derived from a signed transcript and verified auditor pack.');
  lines.push('');

  // Hard rules for README
  if (coverage === 'EXCLUDED') {
    lines.push('⚠️  NOT ELIGIBLE FOR COVERAGE');
    lines.push('');
  }

  if (integrityStatus !== 'VALID') {
    lines.push('⚠️  EVIDENCE INVALID — DO NOT PROCESS CLAIM');
    lines.push('');
  }

  if (hasNonStandardRules) {
    lines.push('⚠️  NON-STANDARD RULES — MANUAL REVIEW REQUIRED');
    lines.push('');
  }

  // What happened
  const whatHappened = gcView.executive_summary.what_happened || 'Transaction completed';
  lines.push(`What happened: ${whatHappened.substring(0, 100)}${whatHappened.length > 100 ? '...' : ''}`);
  lines.push('');

  // Coverage status
  lines.push(`Coverage status: ${coverage}`);
  lines.push('');

  // Money moved
  const moneyMovedText = moneyMoved === true ? 'YES' : moneyMoved === false ? 'NO' : '—';
  lines.push(`Money moved: ${moneyMovedText}`);
  lines.push('');

  // Fault
  lines.push(`Fault domain: ${faultDomain}`);
  lines.push('');

  // What to verify
  lines.push('What to verify:');
  lines.push('1. Run: pact-verifier auditor-pack-verify --zip 04_AUDITOR_PACK.zip');
  lines.push('2. Expected result: ok=true (evidence valid)');
  lines.push('3. If ok=false, evidence is tampered or invalid — do not process claim');
  lines.push('');

  // Keep to max 20 lines
  return lines.slice(0, 20).join('\n');
}

/**
 * Generate the verify command text file.
 */
function generateVerifyCommand(): string {
  return `pact-verifier auditor-pack-verify --zip 04_AUDITOR_PACK.zip

Expected result:
- ok=true → evidence valid
- ok=false → evidence tampered or invalid`;
}

/**
 * Generate metadata.json for the claims package.
 */
function generateMetadata(packData: AuditorPackData): string {
  const { manifest, gcView, judgment, insurerSummary, transcriptId } = packData;
  const status = gcView.executive_summary.status;
  const coverage = insurerSummary.coverage;
  const faultDomainRaw = gcView.responsibility.judgment?.fault_domain || judgment.dblDetermination || '—';
  const faultDomain = displayIntegrityOrFault(faultDomainRaw);
  const integrityStatusRaw = getIntegrityStatusForPack(packData);
  const integrityStatus = displayIntegrityOrFault(integrityStatusRaw);
  const constitutionHash = manifest.constitution_hash;

  const metadata: Record<string, unknown> = {
    version: 'claims_intake/1.0',
    transcript_id: displayTranscriptId(transcriptId),
    outcome: status,
    coverage: coverage,
    fault_domain: faultDomain,
    constitution_hash: constitutionHash,
    integrity: integrityStatus,
    generated_at: new Date().toISOString(),
    tool: '@pact/evidence-viewer',
  };
  if (integrityStatus === 'INDETERMINATE') {
    metadata.integrity_note = packData.integrityResult ? INDETERMINATE_TOOLTIP : INDETERMINATE_VERIFY_VIA_CLI;
  }
  if (faultDomain === 'INDETERMINATE') {
    metadata.fault_domain_note = INDETERMINATE_TOOLTIP;
  }

  return JSON.stringify(metadata, null, 2);
}

/**
 * Generate a claims intake package ZIP.
 * This packages verified artifacts into an insurer-ready submission format.
 * jsPDF and JSZip are loaded on demand to keep the initial bundle smaller.
 */
export async function generateClaimsIntakePackage(packData: AuditorPackData): Promise<Blob> {
  if (!packData.zipFile) {
    throw new Error('Original auditor pack ZIP is required');
  }

  if (!packData.insurerSummary) {
    throw new Error('Insurer summary is required');
  }

  const [{ default: JSZip }, { default: jsPDF }] = await Promise.all([import('jszip'), import('jspdf')]);
  const zip = new JSZip();

  // 00_README.txt
  zip.file('00_README.txt', generateREADME(packData));

  // 01_VERIFY_COMMAND.txt
  zip.file('01_VERIFY_COMMAND.txt', generateVerifyCommand());

  // 02_UNDERWRITING_SUMMARY.pdf
  // Generate the insurer PDF and add it to the ZIP
  const insurerPDFBlob = await generateInsurerPDFBlob(packData, jsPDF as JSPDFConstructor);
  const insurerPDFArrayBuffer = await insurerPDFBlob.arrayBuffer();
  zip.file('02_UNDERWRITING_SUMMARY.pdf', insurerPDFArrayBuffer);

  // 03_GC_SUMMARY.pdf
  const gcPDFBytes = generateGCSummaryPDF(packData, jsPDF as JSPDFConstructor);
  zip.file('03_GC_SUMMARY.pdf', gcPDFBytes);

  // 04_AUDITOR_PACK.zip
  // Add the original auditor pack ZIP as-is (unmodified)
  const originalPackBlob = await packData.zipFile.arrayBuffer();
  zip.file('04_AUDITOR_PACK.zip', originalPackBlob);

  // 05_METADATA.json
  zip.file('05_METADATA.json', generateMetadata(packData));

  // Generate the ZIP blob
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Generate insurer summary PDF as a blob (for inclusion in ZIP).
 * This is a modified version of exportInsurerSummaryPDF that returns a blob instead of saving.
 */
async function generateInsurerPDFBlob(packData: AuditorPackData, JSPDFClass: JSPDFConstructor): Promise<Blob> {
  const doc = new JSPDFClass();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let yPos = margin;

  // Helper to add a new page
  const addPage = () => {
    doc.addPage();
    yPos = margin;
    addFooter();
  };

  // Helper to add footer on every page
  const addFooter = () => {
    const footerY = pageHeight - 15;
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(
      'Generated locally by Pact Evidence Viewer — Underwriting View',
      pageWidth / 2,
      footerY,
      { align: 'center' }
    );
  };

  // Helper to add a section title
  const addSectionTitle = (title: string, fontSize: number = 14) => {
    if (yPos > pageHeight - 40) {
      addPage();
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    doc.setTextColor(0, 0, 0);
    doc.text(title, margin, yPos);
    yPos += fontSize + 5;
  };

  // Helper to add a label-value pair in table format
  const addTableRow = (label: string, value: string, monospace: boolean = false) => {
    if (yPos > pageHeight - 30) {
      addPage();
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    
    // Draw table row
    const rowY = yPos - 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, rowY, pageWidth - margin, rowY);
    
    // Label (left column)
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin + 2, yPos);
    
    // Value (right column)
    if (monospace) {
      doc.setFont('courier', 'normal');
    } else {
      doc.setFont('helvetica', 'normal');
    }
    const valueX = margin + 80;
    const valueLines = doc.splitTextToSize(value, contentWidth - 80);
    doc.text(valueLines, valueX, yPos);
    yPos += Math.max(7, valueLines.length * 5) + 2;
  };

  // Helper to add a banner
  const addBanner = (text: string, isSevere: boolean = false) => {
    if (yPos > pageHeight - 30) {
      addPage();
    }
    const bannerHeight = 15;
    const bannerY = yPos;
    if (isSevere) {
      doc.setFillColor(255, 240, 240);
      doc.setDrawColor(200, 0, 0);
      doc.setLineWidth(0.5);
      doc.rect(margin, bannerY - 8, contentWidth, bannerHeight, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(200, 0, 0);
    } else {
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.rect(margin, bannerY - 8, contentWidth, bannerHeight, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
    }
    doc.text(text, pageWidth / 2, bannerY + 2, { align: 'center' });
    yPos += bannerHeight + 5;
  };

  // Helper to add a boxed note
  const addBoxedNote = (text: string) => {
    if (yPos > pageHeight - 40) {
      addPage();
    }
    const boxHeight = 20;
    const boxY = yPos;
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(250, 250, 250);
    doc.rect(margin, boxY - 10, contentWidth, boxHeight, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const lines = doc.splitTextToSize(text, contentWidth - 10);
    doc.text(lines, margin + 5, boxY + 2);
    yPos += boxHeight + 5;
  };

  // Get data
  const { manifest, gcView, judgment, insurerSummary, transcriptId } = packData;
  const status = gcView.executive_summary.status;
  const coverage = insurerSummary.coverage;
  const confidence = judgment.confidence;
  const constitutionHash = manifest.constitution_hash;
  const integrityStatusRaw = getIntegrityStatusForPack(packData);
  const integrityStatus = displayIntegrityOrFault(integrityStatusRaw);
  const wa = getWarningsAndExceptions(
    packData.packVerifyResult,
    gcView,
    insurerSummary,
    !!packData.merkleDigest,
    !!packData.replayVerifyResult,
    packData.integrityResult
  );
  const faultDomainRaw = gcView.responsibility.judgment?.fault_domain || judgment.dblDetermination || '—';
  const faultDomain = displayIntegrityOrFault(faultDomainRaw);
  const riskFactors = insurerSummary.risk_factors || [];
  const surcharges = insurerSummary.surcharges || [];
  const constitutionWarning = insurerSummary.constitution_warning;
  const hasNonStandardRules = riskFactors.includes('NON_STANDARD_RULES') || 
                               surcharges.includes('NON_STANDARD_CONSTITUTION') ||
                               !!constitutionWarning;
  const verifyCommand = `pact-verifier auditor-pack-verify --zip <auditor_pack.zip>`;

  // ===== PAGE 1: Underwriting Decision =====
  addSectionTitle('PACT INSURER VIEW — UNDERWRITING DECISION', 16);
  yPos += 5;

  // Verdict Summary (one line at top)
  const verdictLine = getVerdictSummaryLine(packData);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Verdict Summary', margin, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  const verdictLines = doc.splitTextToSize(verdictLine, contentWidth);
  doc.text(verdictLines, margin, yPos);
  yPos += verdictLines.length * 6 + 8;
  doc.setFont('helvetica', 'normal');

  if (coverage === 'EXCLUDED') {
    addBanner('NOT INSURABLE', true);
  }

  if (hasNonStandardRules) {
    addBanner('NON-STANDARD RULES — UNDERWRITER REVIEW REQUIRED', true);
  }

  addBoxedNote('This document is a derived underwriting view. Verification requires the auditor pack.');
  yPos += 5;

  addTableRow('Transcript ID', displayTranscriptId(transcriptId), true);
  addTableRow('Outcome', status);
  addTableRow('Coverage', coverage);
  addTableRow('Confidence Score', formatConfidence(confidence));
  addTableRow('Constitution Hash', constitutionHash.substring(0, 16) + '...', true);
  addTableRow('Integrity (pack verification)', integrityStatus);
  if (integrityStatus === 'INDETERMINATE') {
    if (yPos > pageHeight - 25) addPage();
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const indeterminateNote = packData.integrityResult ? INDETERMINATE_TOOLTIP : INDETERMINATE_VERIFY_VIA_CLI;
    doc.text(indeterminateNote, margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    yPos += 7;
  }

  addFooter();

  // ===== PAGE 2: Risk Factors =====
  addPage();
  addSectionTitle('RISK FACTORS', 14);
  yPos += 5;

  addTableRow('Fault Domain', faultDomain);
  if (faultDomain === 'INDETERMINATE') {
    if (yPos > pageHeight - 25) addPage();
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(INDETERMINATE_TOOLTIP, margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    yPos += 7;
  }

  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Risk Factors:', margin, yPos);
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (riskFactors.length > 0) {
    riskFactors.forEach((factor) => {
      if (yPos > pageHeight - 20) {
        addPage();
      }
      doc.text(`• ${factor}`, margin, yPos);
      yPos += 6;
    });
  } else {
    doc.text('None', margin, yPos);
    yPos += 6;
  }

  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Surcharges:', margin, yPos);
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (surcharges.length > 0) {
    surcharges.forEach((surcharge) => {
      if (yPos > pageHeight - 20) {
        addPage();
      }
      doc.text(`• ${surcharge}`, margin, yPos);
      yPos += 6;
    });
  } else {
    doc.text('None', margin, yPos);
    yPos += 6;
  }

  if (insurerSummary.buyer || insurerSummary.provider) {
    if (yPos > pageHeight - 50) {
      addPage();
    }
    yPos += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Passport Tiers:', margin, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (insurerSummary.buyer) {
      doc.text(`Buyer: Tier ${insurerSummary.buyer.tier} (Score: ${insurerSummary.buyer.passport_score})`, margin, yPos);
      yPos += 6;
    }
    if (insurerSummary.provider) {
      doc.text(`Provider: Tier ${insurerSummary.provider.tier} (Score: ${insurerSummary.provider.passport_score})`, margin, yPos);
      yPos += 6;
    }
  }

  addFooter();

  // ===== PAGE 3: Exclusions & Warnings =====
  addPage();
  addSectionTitle('EXCLUSIONS & WARNINGS', 14);
  yPos += 5;

  if (constitutionWarning) {
    if (yPos > pageHeight - 50) {
      addPage();
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(200, 0, 0);
    doc.text('Constitution Warning:', margin, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const warningLines = doc.splitTextToSize(constitutionWarning, contentWidth);
    doc.text(warningLines, margin, yPos);
    yPos += warningLines.length * 5 + 5;
  }

  if (hasNonStandardRules) {
    if (yPos > pageHeight - 50) {
      addPage();
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(200, 0, 0);
    doc.text('Non-Standard Rules Flag:', margin, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text('Transaction executed under non-standard constitution rules. Underwriter review required.', margin, yPos);
    yPos += 10;
  }

  // Warnings & Exceptions (do not affect Integrity verdict; claimed vs computed mismatch here, not tamper)
  const hasWa = wa.packIntegrityWarnings.length > 0 || wa.hashMismatches.length > 0 || wa.nonstandardConstitution.length > 0 || wa.missingOptionalArtifacts.length > 0;
  if (hasWa) {
    if (yPos > pageHeight - 50) {
      addPage();
    }
    yPos += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Warnings & Exceptions', margin, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Warnings are informational only. They do not affect the Integrity verdict.', margin, yPos);
    yPos += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const addWaGroup = (label: string, items: string[]) => {
      if (items.length === 0) return;
      if (yPos > pageHeight - 30) {
        addPage();
      }
      doc.setFont('helvetica', 'bold');
      doc.text(`Warnings: ${label}`, margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      items.forEach((w) => {
        if (yPos > pageHeight - 20) {
          addPage();
        }
        const lines = doc.splitTextToSize(`• ${w}`, contentWidth);
        doc.text(lines, margin, yPos);
        yPos += lines.length * 5 + 2;
      });
      yPos += 4;
    };
    addWaGroup('Pack integrity', wa.packIntegrityWarnings);
    addWaGroup('Claimed vs computed transcript hash', wa.hashMismatches);
    addWaGroup('Nonstandard constitution', wa.nonstandardConstitution);
    addWaGroup('Missing optional artifacts', wa.missingOptionalArtifacts);
  }

  if (coverage === 'EXCLUDED') {
    if (yPos > pageHeight - 50) {
      addPage();
    }
    yPos += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(200, 0, 0);
    doc.text('Reason for Exclusion:', margin, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    
    const exclusionReasons: string[] = [];
    if (hasNonStandardRules) {
      exclusionReasons.push('Non-standard constitution rules detected.');
    }
    if (riskFactors.length > 0) {
      exclusionReasons.push(`Risk factors: ${riskFactors.join(', ')}`);
    }
    if (constitutionWarning) {
      exclusionReasons.push(constitutionWarning);
    }
    if (exclusionReasons.length === 0) {
      exclusionReasons.push('Coverage excluded based on underwriting assessment.');
    }
    
    const reasonText = exclusionReasons.join(' ');
    const reasonLines = doc.splitTextToSize(reasonText, contentWidth);
    doc.text(reasonLines, margin, yPos);
    yPos += reasonLines.length * 5;
  }

  addFooter();

  // ===== PAGE 4: Verification & Claims Instructions =====
  addPage();
  addSectionTitle('VERIFICATION & CLAIMS INSTRUCTIONS', 14);
  yPos += 5;

  if (yPos > pageHeight - 50) {
    addPage();
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Verification Command:', margin, yPos);
  yPos += 10;
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const boxY = yPos - 5;
  doc.setDrawColor(150, 150, 150);
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, boxY, contentWidth, 15, 'FD');
  doc.text(verifyCommand, margin + 5, yPos + 5);
  yPos += 20;

  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Required Artifacts for Claims:', margin, yPos);
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('• Auditor pack ZIP file', margin, yPos);
  yPos += 6;
  doc.text(`• Transcript ID: ${displayTranscriptId(transcriptId)}`, margin, yPos);
  yPos += 6;

  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 10;
  addBoxedNote('This document is a derived underwriting view. Verification requires the auditor pack.');

  addFooter();

  // Return as blob
  const pdfOutput = doc.output('blob');
  return pdfOutput as Blob;
}
