import type { AuditorPackData } from '../types';
import { formatDate, formatConfidence } from './loadPack';
import {
  getIntegrityStatusForPack,
  getWarningsAndExceptions,
  displayIntegrityOrFault,
  displayTranscriptId,
  getVerdictSummaryLine,
  INTEGRITY_VALID_SUBTEXT,
  INTEGRITY_TAMPERED_SUBTEXT,
  INDETERMINATE_TOOLTIP,
  INDETERMINATE_VERIFY_VIA_CLI,
  WARNINGS_VALID_SUBTEXT,
} from './integrity';

/**
 * Export GC View as a legal PDF document.
 * This is a presentation layer - verification requires the original auditor pack.
 * jsPDF is loaded on demand to keep the initial bundle smaller.
 */
export async function exportGCViewPDF(packData: AuditorPackData): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF();
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
      'Generated locally by Pact Evidence Viewer — Verifiable via auditor pack',
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

  // Helper to add a label-value pair
  const addLabelValue = (label: string, value: string, monospace: boolean = false) => {
    if (yPos > pageHeight - 30) {
      addPage();
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(label + ':', margin, yPos);
    
    if (monospace) {
      doc.setFont('courier', 'normal');
    }
    doc.text(value, margin + 60, yPos);
    if (monospace) {
      doc.setFont('helvetica', 'normal');
    }
    yPos += 7;
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

  // Helper to format money moved (no "UNKNOWN" in UI/PDF)
  const formatMoneyMoved = (moved: boolean | undefined): string => {
    if (moved === true) return 'YES';
    if (moved === false) return 'NO';
    return '—';
  };

  // Get data
  const { manifest, gcView, judgment, insurerSummary, transcriptId, transcript } = packData;
  const status = gcView.executive_summary.status;
  const approvalRisk = gcView.gc_takeaways?.approval_risk || '—';
  const faultDomainRaw = gcView.responsibility.judgment?.fault_domain || judgment.dblDetermination || '—';
  const faultDomain = displayIntegrityOrFault(faultDomainRaw);
  const requiredAction = gcView.responsibility.judgment?.required_action || judgment.requiredAction || 'NONE';
  const requiredNextActor = gcView.responsibility.judgment?.required_next_actor || judgment.requiredNextActor || 'NONE';
  const moneyMoved = formatMoneyMoved(gcView.executive_summary.money_moved);
  const confidence = judgment.confidence;
  const integrityStatusRaw = getIntegrityStatusForPack(packData);
  const integrityStatus = displayIntegrityOrFault(integrityStatusRaw);
  const judgmentDisplay = displayIntegrityOrFault(judgment.dblDetermination || '');
  const hashChainStatus = gcView.integrity.hash_chain;
  const signaturesVerified = `${gcView.integrity.signatures_verified.verified}/${gcView.integrity.signatures_verified.total}`;
  const wa = getWarningsAndExceptions(
    packData.packVerifyResult,
    gcView,
    packData.insurerSummary,
    !!packData.merkleDigest,
    !!packData.replayVerifyResult,
    packData.integrityResult
  );
  const verifyCommand = `pact-verifier auditor-pack-verify --zip <auditor_pack.zip>`;
  
  // Extract timestamp from transcript if available, otherwise use manifest
  let timestamp = '—';
  if (transcript) {
    try {
      const transcriptJson = JSON.parse(transcript);
      if (transcriptJson.created_at_ms) {
        timestamp = formatDate(transcriptJson.created_at_ms);
      }
    } catch {
      // Fall through to manifest timestamp
    }
  }
  if (timestamp === '—' && manifest.created_at_ms) {
    timestamp = formatDate(manifest.created_at_ms);
  }

  // ===== PAGE 1: Executive Summary =====
  addSectionTitle('PACT GC VIEW — EXECUTIVE SUMMARY', 16);
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

  addBoxedNote('This document is a presentation layer. Verification requires the original auditor pack.');
  yPos += 5;

  addLabelValue('Transcript ID', displayTranscriptId(transcriptId), true);
  addLabelValue('Status', status);
  addLabelValue('Approval Risk', approvalRisk);
  addLabelValue('Fault Domain', faultDomain);
  addLabelValue('Required Action', requiredAction);
  addLabelValue('Constitution Hash', manifest.constitution_hash.substring(0, 16) + '...', true);
  addLabelValue('Timestamp', timestamp);

  // Add "What Happened" summary
  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('What Happened:', margin, yPos);
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const whatHappenedLines = doc.splitTextToSize(gcView.executive_summary.what_happened, contentWidth);
  doc.text(whatHappenedLines, margin, yPos);
  yPos += whatHappenedLines.length * 5 + 5;

  addFooter();

  // ===== PAGE 2: Responsibility & Outcome =====
  addPage();
  addSectionTitle('RESPONSIBILITY & OUTCOME', 14);
  yPos += 5;

  addLabelValue('Judgment Summary', judgmentDisplay || 'N/A');
  if (judgmentDisplay === 'INDETERMINATE') {
    if (yPos > pageHeight - 25) addPage();
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(INDETERMINATE_TOOLTIP, margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    yPos += 7;
  }
  addLabelValue('Fault Attribution', faultDomain);
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
  addLabelValue('Required Next Actor', requiredNextActor);
  addLabelValue('Money Moved', moneyMoved);
  addLabelValue('Confidence Score', formatConfidence(confidence));

  // Add blame explanation
  if (yPos > pageHeight - 60) {
    addPage();
  }
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Blame Explanation:', margin, yPos);
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const blameLines = doc.splitTextToSize(gcView.responsibility.blame_explanation, contentWidth);
  doc.text(blameLines, margin, yPos);
  yPos += blameLines.length * 5 + 5;

  // Add final outcome
  if (yPos > pageHeight - 40) {
    addPage();
  }
  yPos += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Final Outcome:', margin, yPos);
  yPos += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const outcomeLines = doc.splitTextToSize(gcView.executive_summary.final_outcome, contentWidth);
  doc.text(outcomeLines, margin, yPos);

  addFooter();

  // ===== PAGE 3: Integrity & Verification =====
  addPage();
  addSectionTitle('INTEGRITY & VERIFICATION', 14);
  yPos += 5;

  addLabelValue('Integrity (pack verification)', integrityStatus);
  if (integrityStatus === 'VALID' || integrityStatus === 'TAMPERED' || integrityStatus === 'INDETERMINATE') {
    if (yPos > pageHeight - 25) addPage();
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const subtext =
      integrityStatus === 'VALID'
        ? INTEGRITY_VALID_SUBTEXT
        : integrityStatus === 'TAMPERED'
          ? INTEGRITY_TAMPERED_SUBTEXT
          : packData.integrityResult ? INDETERMINATE_TOOLTIP : INDETERMINATE_VERIFY_VIA_CLI;
    doc.text(subtext, margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    yPos += 7;
  }
  addLabelValue('Hash Chain Status', hashChainStatus);
  addLabelValue('Signature Verification', signaturesVerified);

  // Add verify command in monospace box
  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 10;
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

  // Warnings & Exceptions (warnings never flip VALID → TAMPERED)
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
    doc.text(integrityStatus === 'VALID' ? WARNINGS_VALID_SUBTEXT : 'Warnings are informational only. They do not affect the Integrity verdict.', margin, yPos);
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

  addFooter();

  // ===== PAGE 4: Insurer View =====
  addPage();
  addSectionTitle('INSURER VIEW', 14);
  yPos += 5;

  addLabelValue('Coverage', insurerSummary.coverage);
  
  // Risk factors
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
  if (insurerSummary.risk_factors && insurerSummary.risk_factors.length > 0) {
    insurerSummary.risk_factors.forEach((factor) => {
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

  // Surcharges
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
  if (insurerSummary.surcharges && insurerSummary.surcharges.length > 0) {
    insurerSummary.surcharges.forEach((surcharge) => {
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

  // Constitution warning
  if (insurerSummary.constitution_warning) {
    if (yPos > pageHeight - 40) {
      addPage();
    }
    yPos += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(200, 0, 0);
    doc.text('Constitution Warning:', margin, yPos);
    yPos += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const warningLines = doc.splitTextToSize(insurerSummary.constitution_warning, contentWidth);
    doc.text(warningLines, margin, yPos);
    yPos += warningLines.length * 5;
  }

  // Passport tiers if present
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

  // Generate filename and download
  // Sanitize transcript ID for filename (remove invalid chars, limit length)
  const safeTranscriptId = !transcriptId || transcriptId === 'UNKNOWN' || transcriptId === '—'
    ? 'pack'
    : transcriptId.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
  const filename = `PACT_GC_VIEW_${safeTranscriptId}.pdf`;
  doc.save(filename);
}

/**
 * Export Insurer Summary as an underwriting-grade PDF document.
 * This is a derived underwriting view - verification requires the original auditor pack.
 * jsPDF is loaded on demand to keep the initial bundle smaller.
 */
export async function exportInsurerSummaryPDF(packData: AuditorPackData): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF();
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

  // Helper to add a banner (for EXCLUDED or NON-STANDARD warnings)
  const addBanner = (text: string, isSevere: boolean = false) => {
    if (yPos > pageHeight - 30) {
      addPage();
    }
    const bannerHeight = 15;
    const bannerY = yPos;
    // Severe banners: light red background with dark red text
    // Normal banners: light gray background with black text
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

  // Add EXCLUDED banner if applicable
  if (coverage === 'EXCLUDED') {
    addBanner('NOT INSURABLE', true);
  }

  // Add NON-STANDARD RULES banner if applicable
  if (hasNonStandardRules) {
    addBanner('NON-STANDARD RULES — UNDERWRITER REVIEW REQUIRED', true);
  }

  // Add disclaimer
  addBoxedNote('This document is a derived underwriting view. Verification requires the auditor pack.');
  yPos += 5;

  // Table format for underwriting decision
  addTableRow('Transcript ID', displayTranscriptId(transcriptId), true);
  addTableRow('Outcome', status);
  addTableRow('Coverage', coverage);
  addTableRow('Confidence Score', formatConfidence(confidence));
  addTableRow('Constitution Hash', constitutionHash.substring(0, 16) + '...', true);
  addTableRow('Integrity (pack verification)', integrityStatus);
  if (integrityStatus === 'VALID' || integrityStatus === 'TAMPERED' || integrityStatus === 'INDETERMINATE') {
    if (yPos > pageHeight - 25) addPage();
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    const subtext =
      integrityStatus === 'VALID'
        ? INTEGRITY_VALID_SUBTEXT
        : integrityStatus === 'TAMPERED'
          ? INTEGRITY_TAMPERED_SUBTEXT
          : packData.integrityResult ? INDETERMINATE_TOOLTIP : INDETERMINATE_VERIFY_VIA_CLI;
    doc.text(subtext, margin, yPos);
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

  // Risk factors list
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

  // Surcharges list
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

  // Passport tiers
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

  // Constitution warning
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

  // Non-standard rules flag
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

  // Warnings & Exceptions (warnings never flip VALID → TAMPERED)
  const hasWaInsurer = wa.packIntegrityWarnings.length > 0 || wa.hashMismatches.length > 0 || wa.nonstandardConstitution.length > 0 || wa.missingOptionalArtifacts.length > 0;
  if (hasWaInsurer) {
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
    doc.text(integrityStatus === 'VALID' ? WARNINGS_VALID_SUBTEXT : 'Warnings are informational only. They do not affect the Integrity verdict.', margin, yPos);
    yPos += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const addWaGroupInsurer = (label: string, items: string[]) => {
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
    addWaGroupInsurer('Pack integrity', wa.packIntegrityWarnings);
    addWaGroupInsurer('Claimed vs computed transcript hash', wa.hashMismatches);
    addWaGroupInsurer('Nonstandard constitution', wa.nonstandardConstitution);
    addWaGroupInsurer('Missing optional artifacts', wa.missingOptionalArtifacts);
  }

  // Reason for exclusion (if EXCLUDED)
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
    
    // Build exclusion reason from risk factors and warnings
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

  // Verify command
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

  // Required artifacts for claims
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

  // Determinism disclaimer
  if (yPos > pageHeight - 50) {
    addPage();
  }
  yPos += 10;
  addBoxedNote('This document is a derived underwriting view. Verification requires the auditor pack.');

  addFooter();

  // Generate filename and download (never "UNKNOWN" in filename)
  const safeTranscriptId = !transcriptId || transcriptId === 'UNKNOWN' || transcriptId === '—'
    ? 'pack'
    : transcriptId.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
  const filename = `PACT_INSURER_VIEW_${safeTranscriptId}.pdf`;
  doc.save(filename);
}
