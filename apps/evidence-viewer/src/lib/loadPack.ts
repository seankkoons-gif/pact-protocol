import JSZip from "jszip";
import { verifyAuditorPackFromBytes } from "@pact/verifier/core";
import { STANDARD_CONSTITUTION } from "./standard_constitution";
import type { AuditorPackData, IntegrityResult, Manifest, GCView, Judgment, InsurerSummary } from "../types";

/** Canonical paths (preferred). */
const CANONICAL = {
  transcript: "input/transcript.json",
  judgment: "derived/judgment.json",
  gcView: "derived/gc_view.json",
  insurerSummary: "derived/insurer_summary.json",
  manifest: "manifest.json",
  checksums: "checksums.sha256",
} as const;

/** Fallback patterns for future compatibility. Matched against normalized paths. */
const FALLBACK_PATTERNS = {
  transcript: /(^|\/)transcript[^/]*\.json$/i,
  judgment: /(^|\/)judg[^/]*\.json$/i,
  gcView: /(^|\/)gc_view[^/]*\.json$/i,
  insurerSummary: /(^|\/)insurer[^/]*\.json$/i,
  manifest: /^manifest\.json$/i,
  checksums: /(^|\/)checksums[^/]*\.sha256$/i,
} as const;

const CONSTITUTION_PATHS = [
  "constitution/CONSTITUTION_v1.md",
  "CONSTITUTION_v1.md",
  "don/constitution/PACT_CONSTITUTION_V1.md",
];

const CONSTITUTION_PATTERN = /(^|\/)CONSTITUTION[^/]*\.md$/i;

function normalize(name: string): string {
  let n = name.replace(/\\/g, "/");
  n = n.replace(/^\.\/+/, "");
  return n;
}

function buildMap(zip: JSZip): Map<string, JSZip.JSZipObject> {
  const map = new Map<string, JSZip.JSZipObject>();
  zip.forEach((path, file) => {
    if (file.dir) return;
    map.set(normalize(path), file);
  });
  return map;
}

function getFile(map: Map<string, JSZip.JSZipObject>, path: string): JSZip.JSZipObject | undefined {
  return map.get(normalize(path));
}

function findByPattern(
  map: Map<string, JSZip.JSZipObject>,
  pattern: RegExp
): { path: string; file: JSZip.JSZipObject } | undefined {
  for (const [path, file] of map.entries()) {
    if (pattern.test(path)) return { path, file };
  }
  return undefined;
}

function resolveFile(
  map: Map<string, JSZip.JSZipObject>,
  key: keyof typeof CANONICAL
): { path: string; file: JSZip.JSZipObject } | undefined {
  const canonical = CANONICAL[key];
  const file = getFile(map, canonical);
  if (file) return { path: canonical, file };
  const pattern = FALLBACK_PATTERNS[key];
  return findByPattern(map, pattern);
}

function getConstitution(map: Map<string, JSZip.JSZipObject>): { path: string; file: JSZip.JSZipObject } | undefined {
  for (const p of CONSTITUTION_PATHS) {
    const f = map.get(normalize(p));
    if (f) return { path: p, file: f };
  }
  return findByPattern(map, CONSTITUTION_PATTERN);
}

export class PackLoadError extends Error {
  constructor(
    message: string,
    public readonly missing: string[],
    public readonly foundPaths: string[]
  ) {
    super(message);
    this.name = "PackLoadError";
  }
}

export async function loadPackFromFile(
  file: File,
  options?: { verifyPath?: string; source?: "demo_public" | "drag_drop" }
): Promise<AuditorPackData> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const map = buildMap(zip);
  const allPaths = Array.from(map.keys()).sort();

  const transcriptRes = resolveFile(map, "transcript");
  const judgmentRes = resolveFile(map, "judgment");
  const gcViewRes = resolveFile(map, "gcView");
  const insurerSummaryRes = resolveFile(map, "insurerSummary");
  const manifestRes = resolveFile(map, "manifest");
  const checksumsRes = resolveFile(map, "checksums");
  const constitutionRes = getConstitution(map);

  const required = [
    { key: "input/transcript.json", res: transcriptRes },
    { key: "derived/judgment.json", res: judgmentRes },
    { key: "derived/gc_view.json", res: gcViewRes },
    { key: "derived/insurer_summary.json", res: insurerSummaryRes },
    { key: "manifest.json", res: manifestRes },
    { key: "checksums.sha256", res: checksumsRes },
    { key: "constitution", res: constitutionRes },
  ];

  const missing = required.filter((r) => !r.res).map((r) => r.key);
  if (missing.length > 0) {
    throw new PackLoadError(
      `Invalid auditor pack: missing required files.`,
      missing,
      allPaths
    );
  }

  const manifestFile = manifestRes!.file;
  const gcViewFile = gcViewRes!.file;
  const judgmentFile = judgmentRes!.file;
  const insurerSummaryFile = insurerSummaryRes!.file;
  const checksumsFile = checksumsRes!.file;
  const constitutionFile = constitutionRes!.file;
  const transcriptFile = transcriptRes!.file;

  const [manifestContent, gcViewContent, judgmentContent, insurerSummaryContent, checksumsContent, constitutionContent, transcriptContent] = await Promise.all([
    manifestFile.async("string"),
    gcViewFile.async("string"),
    judgmentFile.async("string"),
    insurerSummaryFile.async("string"),
    checksumsFile.async("string"),
    constitutionFile.async("string"),
    transcriptFile.async("string"),
  ]);

  const manifest = JSON.parse(manifestContent) as Manifest;
  const gcView = JSON.parse(gcViewContent) as GCView;
  const judgment = JSON.parse(judgmentContent) as Judgment;
  const insurerSummary = JSON.parse(insurerSummaryContent) as InsurerSummary;

  let transcriptId = manifest.transcript_id;
  try {
    const transcriptJson = JSON.parse(transcriptContent);
    if (transcriptJson?.transcript_id) transcriptId = transcriptJson.transcript_id;
  } catch {
    // use manifest.transcript_id
  }

  const source = options?.source ?? 'drag_drop';
  const demoPublicPath = options?.verifyPath;

  const zipBytes = new Uint8Array(buf);
  const sha256Async = async (data: string | Uint8Array): Promise<string> => {
    const bytes: Uint8Array =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
    const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  let packVerifyResult: { ok?: boolean; checksums_ok?: boolean; recompute_ok?: boolean; mismatches?: string[]; tool_version?: string };
  try {
    packVerifyResult = await verifyAuditorPackFromBytes(zipBytes, {
      sha256Async,
      standardConstitutionContent: STANDARD_CONSTITUTION,
      allowNonstandard: false,
    });
  } catch (err) {
    packVerifyResult = {
      ok: false,
      recompute_ok: false,
      mismatches: [err instanceof Error ? err.message : String(err)],
    };
  }

  const int = gcView.integrity;
  const recomputeOk = packVerifyResult.recompute_ok;
  const status: IntegrityResult["status"] =
    recomputeOk === true ? "VALID" : recomputeOk === false ? "TAMPERED" : "INDETERMINATE";

  const checksumFailures = (packVerifyResult.mismatches ?? []).filter(
    (m) => /checksum|file in checksums not found/i.test(m)
  );

  const integrityResult: IntegrityResult = {
    status,
    checksums: {
      status:
        packVerifyResult.checksums_ok === true
          ? "VALID"
          : packVerifyResult.checksums_ok === false
          ? "INVALID"
          : "UNAVAILABLE",
      checkedCount: packVerifyResult.checksums_ok === true ? 1 : 0,
      totalCount: 1,
      failures: checksumFailures,
    },
    hashChain: {
      status: int?.hash_chain === "VALID" ? "VALID" : int?.hash_chain === "INVALID" ? "INVALID" : "INVALID",
      details: int?.notes?.find((n) => /hash|chain/i.test(n)),
    },
    signatures: {
      status:
        int?.signatures_verified?.verified === int?.signatures_verified?.total
          ? "VALID"
          : int?.signatures_verified?.total != null
          ? "INVALID"
          : "UNAVAILABLE",
      verifiedCount: int?.signatures_verified?.verified ?? 0,
      totalCount: int?.signatures_verified?.total ?? 0,
      failures: [],
    },
    warnings: packVerifyResult.mismatches ?? [],
  };

  return {
    manifest,
    gcView,
    judgment,
    insurerSummary,
    checksums: checksumsContent,
    constitution: constitutionContent,
    transcript: transcriptContent,
    transcriptId,
    zipFile: file,
    source,
    demoPublicPath,
    packVerifyResult,
    integrityResult,
  };
}
