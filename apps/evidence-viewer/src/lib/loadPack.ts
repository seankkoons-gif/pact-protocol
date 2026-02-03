import JSZip from "jszip";
import type { AuditorPackData, Manifest, GCView, Judgment, InsurerSummary } from "../types";

const CONSTITUTION_PATHS = [
  "constitution/CONSTITUTION_v1.md",
  "CONSTITUTION_v1.md",
  "don/constitution/PACT_CONSTITUTION_V1.md",
];

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

function getConstitution(map: Map<string, JSZip.JSZipObject>): JSZip.JSZipObject | undefined {
  for (const p of CONSTITUTION_PATHS) {
    const f = map.get(normalize(p));
    if (f) return f;
  }
  return undefined;
}

export async function loadPackFromFile(
  file: File,
  options?: { verifyPath?: string; source?: "demo_public" | "drag_drop" }
): Promise<AuditorPackData> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const map = buildMap(zip);

  const manifestFile = getFile(map, "manifest.json");
  const gcViewFile = getFile(map, "derived/gc_view.json");
  const judgmentFile = getFile(map, "derived/judgment.json");
  const insurerSummaryFile = getFile(map, "derived/insurer_summary.json");
  const checksumsFile = getFile(map, "checksums.sha256");
  const constitutionFile = getConstitution(map);
  const transcriptFile = getFile(map, "input/transcript.json");

  if (!manifestFile || !gcViewFile || !judgmentFile || !insurerSummaryFile || !checksumsFile || !constitutionFile || !transcriptFile) {
    throw new Error("Invalid auditor pack: missing required files (manifest, gc_view, judgment, insurer_summary, checksums, constitution, transcript)");
  }

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
  };
}
