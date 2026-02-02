import type { AuditorPackData, Judgment, InsurerSummary, Manifest, GCView } from '../types';
import { verifyAuditorPackFromBytes } from '@pact/verifier/core';
import { verifierReportToIntegrityResult } from './verifierToIntegrity';
import { computeSignatureCounts, type TranscriptLike } from './transcriptSignatures';

// Standard constitution for pack verification (same as pact-verifier; bundled for offline).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - Vite ?raw import
import STANDARD_CONSTITUTION_CONTENT from '../../../../packages/verifier/resources/CONSTITUTION_v1.md?raw';

type ZipInstance = Awaited<ReturnType<Awaited<typeof import('jszip')>['loadAsync']>>;

/** Get all relative paths in the zip (no leading slashes, normalized). */
function getAllPaths(zip: ZipInstance): string[] {
  const paths: string[] = [];
  zip.forEach((relativePath, file) => {
    if (!file.dir) {
      paths.push(relativePath.replace(/^\/+/, ''));
    }
  });
  return paths.sort();
}

/**
 * Find one file in the zip: try exact path first, then first path matching any pattern.
 * Patterns are tested on the full path (e.g. "transcript", "manifest.json").
 */
function findPath(
  paths: string[],
  exactFirst: string | null,
  ...patterns: Array<string | RegExp>
): string | null {
  if (exactFirst && paths.includes(exactFirst)) return exactFirst;
  for (const p of patterns) {
    const match = paths.find((path) =>
      typeof p === 'string' ? path.includes(p) : p.test(path)
    );
    if (match) return match;
  }
  return null;
}

/** Read JSON from zip entry by path. */
async function readJson(zip: ZipInstance, path: string): Promise<unknown> {
  const file = zip.file(path);
  if (!file) throw new Error(`File not found: ${path}`);
  const raw = await file.async('string');
  return JSON.parse(raw) as unknown;
}

/** Read text from zip entry by path. */
async function readText(zip: ZipInstance, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`File not found: ${path}`);
  return await file.async('string');
}

function buildMissingError(required: string[], found: string[]): string {
  const foundList = found.length ? found.join(', ') : '(none)';
  return `Required file(s) missing: ${required.join(', ')}. Files in pack: ${foundList}`;
}

export async function loadPackFromFile(file: File): Promise<AuditorPackData> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const paths = getAllPaths(zip);
  const allFilesMap = new Map(paths.map((p) => [p, true]));
  // eslint-disable-next-line no-console -- temporary debug
  console.log('zip keys', [...allFilesMap.keys()].slice(0, 30));
  // eslint-disable-next-line no-console -- temporary debug
  console.log('has transcript', allFilesMap.has('input/transcript.json'));
  // eslint-disable-next-line no-console -- temporary debug
  console.log('has checksums', allFilesMap.has('checksums.sha256'));

  // --- Transcript (required): always use canonical input/transcript.json; fallback only if missing
  const canonicalTranscriptPath = 'input/transcript.json';
  const transcriptPath = paths.includes(canonicalTranscriptPath)
    ? canonicalTranscriptPath
    : findPath(paths, null, /transcript.*\.json$/i, 'transcript.json');
  if (!transcriptPath) {
    throw new Error(buildMissingError(['input/transcript.json'], paths));
  }
  const transcriptRaw = await readText(zip, transcriptPath);
  let transcriptId = '';
  let transcriptParsed: unknown;
  try {
    transcriptParsed = JSON.parse(transcriptRaw) as { transcript_id?: string };
    transcriptId = (transcriptParsed as { transcript_id?: string }).transcript_id || '';
  } catch {
    transcriptParsed = null;
    transcriptId = '';
  }

  // --- Manifest: prefer manifest.json, then manifest*.json
  const manifestPath = findPath(paths, 'manifest.json', 'manifest.json', /manifest.*\.json$/i) ?? null;
  if (!manifestPath) {
    throw new Error(buildMissingError(['manifest.json'], paths));
  }
  const manifest = (await readJson(zip, manifestPath)) as Manifest;

  // --- GC View: prefer derived/gc_view.json, then *gc*view*.json
  const gcViewPath =
    findPath(paths, 'derived/gc_view.json', 'derived/gc_view.json', /gc_view\.json$/i, /derived\/.*gc.*view/i) ?? null;
  if (!gcViewPath) {
    throw new Error(buildMissingError(['derived/gc_view.json'], paths));
  }
  const gcView = (await readJson(zip, gcViewPath)) as GCView;

  // --- Judgment (DBL): prefer derived/judgment.json, then judgment*.json
  const judgmentPath =
    findPath(paths, 'derived/judgment.json', /judgment.*\.json$/i, 'judgment.json') ?? null;
  if (!judgmentPath) {
    throw new Error(buildMissingError(['judgment (e.g. derived/judgment.json)'], paths));
  }
  const judgment = (await readJson(zip, judgmentPath)) as Judgment;

  // --- Insurer summary: prefer derived/insurer_summary.json
  const insurerSummaryPath =
    findPath(paths, 'derived/insurer_summary.json', 'insurer_summary.json', /insurer_summary.*\.json$/i) ?? null;
  if (!insurerSummaryPath) {
    throw new Error(buildMissingError(['derived/insurer_summary.json'], paths));
  }
  const insurerSummary = (await readJson(zip, insurerSummaryPath)) as InsurerSummary;

  // --- Checksums: load checksums.sha256 text if present (optional)
  const checksumsPath = findPath(paths, 'checksums.sha256', 'checksums.sha256', /checksums?\.(sha256|txt)/i) ?? null;
  const checksumsText = checksumsPath ? await readText(zip, checksumsPath) : '';

  // --- Constitution: prefer constitution/CONSTITUTION_v1.md, then constitution/*.md
  const constitutionPath =
    findPath(paths, 'constitution/CONSTITUTION_v1.md', 'constitution/CONSTITUTION_v1.md', /constitution\/.*\.md$/i) ?? null;
  if (!constitutionPath) {
    throw new Error(buildMissingError(['constitution (e.g. constitution/CONSTITUTION_v1.md)'], paths));
  }
  const constitution = await readText(zip, constitutionPath);

  // Fallbacks for transcript_id
  if (!transcriptId) transcriptId = manifest.transcript_id || '';
  if (!transcriptId && gcView.subject?.transcript_id_or_hash) transcriptId = gcView.subject.transcript_id_or_hash;
  if (!transcriptId) transcriptId = 'UNKNOWN';

  // Optional: merkle digest
  let merkleDigest: AuditorPackData['merkleDigest'];
  const merklePath = findPath(paths, 'derived/merkle_digest.json', 'merkle_digest.json');
  if (merklePath) {
    try {
      merkleDigest = (await readJson(zip, merklePath)) as AuditorPackData['merkleDigest'];
    } catch {
      merkleDigest = undefined;
    }
  } else {
    merkleDigest = undefined;
  }

  // Debug: what we found in the zip (for INDETERMINATE diagnosis).
  const integrityDebug: AuditorPackData['integrityDebug'] = {
    transcriptFound: !!transcriptPath,
    transcriptPath: transcriptPath ?? null,
    checksumsFound: !!checksumsPath,
    checksumsPath: checksumsPath ?? null,
    zipEntryCount: paths.length,
  };

  // Integrity: same code path as pact-verifier auditor-pack-verify (offline, no network).
  let integrityResult: AuditorPackData['integrityResult'];
  try {
    const zipBytes = new Uint8Array(await file.arrayBuffer());
    const sha256Async = async (data: string | Uint8Array): Promise<string> => {
      const bytes: Uint8Array =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : data instanceof Uint8Array
            ? data
            : new Uint8Array(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };
    const report = await verifyAuditorPackFromBytes(zipBytes, {
      sha256Async,
      standardConstitutionContent: STANDARD_CONSTITUTION_CONTENT,
    });
    integrityResult = verifierReportToIntegrityResult(report);
  } catch (e) {
    const caughtMessage = e instanceof Error ? e.message : 'Failed to verify pack';
    integrityResult = {
      status: 'INDETERMINATE',
      checksums: { status: 'UNAVAILABLE', checkedCount: 0, totalCount: 0, failures: [] },
      hashChain: { status: 'INVALID', details: 'Verification failed' },
      signatures: { status: 'UNAVAILABLE', verifiedCount: 0, totalCount: 0, failures: [] },
      warnings: [caughtMessage],
    };
  }

  // Signatures: from input/transcript.json only (do not use derived/judgment).
  const sigCounts = computeSignatureCounts(transcriptParsed as TranscriptLike | null);
  integrityResult = {
    ...integrityResult,
    signatures: {
      status: sigCounts.status,
      verifiedCount: sigCounts.verifiedCount,
      totalCount: sigCounts.totalCount,
      failures: sigCounts.failures,
    },
  };

  return {
    manifest,
    gcView,
    judgment,
    insurerSummary,
    checksums: checksumsText,
    constitution,
    transcript: transcriptRaw,
    transcriptId,
    zipFile: file,
    merkleDigest,
    integrityResult,
    integrityDebug,
    source: 'drag_drop',
    fileName: file.name,
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
