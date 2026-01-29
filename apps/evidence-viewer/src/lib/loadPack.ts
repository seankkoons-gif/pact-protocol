import type { AuditorPackData } from '../types';

export async function loadPackFromFile(file: File): Promise<AuditorPackData> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  
  // Read manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('manifest.json not found in auditor pack');
  }
  const manifest = JSON.parse(await manifestFile.async('string'));

  // Read derived/gc_view.json
  const gcViewFile = zip.file('derived/gc_view.json');
  if (!gcViewFile) {
    throw new Error('derived/gc_view.json not found in auditor pack');
  }
  const gcView = JSON.parse(await gcViewFile.async('string'));

  // Read derived/judgment.json
  const judgmentFile = zip.file('derived/judgment.json');
  if (!judgmentFile) {
    throw new Error('derived/judgment.json not found in auditor pack');
  }
  const judgment = JSON.parse(await judgmentFile.async('string'));

  // Read derived/insurer_summary.json
  const insurerSummaryFile = zip.file('derived/insurer_summary.json');
  if (!insurerSummaryFile) {
    throw new Error('derived/insurer_summary.json not found in auditor pack');
  }
  const insurerSummary = JSON.parse(await insurerSummaryFile.async('string'));

  // Read checksums.sha256
  const checksumsFile = zip.file('checksums.sha256');
  if (!checksumsFile) {
    throw new Error('checksums.sha256 not found in auditor pack');
  }
  const checksums = await checksumsFile.async('string');

  // Read constitution/CONSTITUTION_v1.md
  const constitutionFile = zip.file('constitution/CONSTITUTION_v1.md');
  if (!constitutionFile) {
    throw new Error('constitution/CONSTITUTION_v1.md not found in auditor pack');
  }
  const constitution = await constitutionFile.async('string');

  // Optionally read input/transcript.json
  let transcript: string | undefined;
  let transcriptId: string = '';
  const transcriptFile = zip.file('input/transcript.json');
  if (transcriptFile) {
    transcript = await transcriptFile.async('string');
    try {
      const transcriptJson = JSON.parse(transcript);
      transcriptId = transcriptJson.transcript_id || '';
    } catch {
      transcriptId = '';
    }
  }

  // Extract transcript ID with fallbacks:
  // 1. From input/transcript.json (primary)
  // 2. From manifest.json (fallback)
  // 3. From gc_view.subject.transcript_id_or_hash (fallback)
  if (!transcriptId) {
    transcriptId = manifest.transcript_id || '';
  }
  if (!transcriptId && gcView.subject?.transcript_id_or_hash) {
    transcriptId = gcView.subject.transcript_id_or_hash;
  }
  if (!transcriptId) {
    transcriptId = 'UNKNOWN';
  }

  // Optional: derived/merkle_digest.json (additive evidence only)
  let merkleDigest: AuditorPackData['merkleDigest'];
  const merkleFile = zip.file('derived/merkle_digest.json');
  if (merkleFile) {
    try {
      merkleDigest = JSON.parse(await merkleFile.async('string'));
    } catch {
      merkleDigest = undefined;
    }
  }

  return {
    manifest,
    gcView,
    judgment,
    insurerSummary,
    checksums,
    constitution,
    transcript,
    transcriptId,
    zipFile: file,
    merkleDigest,
  };
}

export async function loadPackFromUrl(url: string): Promise<AuditorPackData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pack: ${response.statusText}`);
  }
  const blob = await response.blob();
  const fileName = url.split('/').pop() || 'pack.zip';
  const file = new File([blob], fileName, { type: 'application/zip' });
  return loadPackFromFile(file);
}

export function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

export function truncateHash(hash: string, length: number = 16): string {
  if (hash.length <= length) return hash;
  return hash.substring(0, length) + '...';
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
