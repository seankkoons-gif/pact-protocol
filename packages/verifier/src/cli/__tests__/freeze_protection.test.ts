/**
 * Freeze Protection Regression Suite
 *
 * Guarantees Pact v4 frozen semantics do not drift when adding tier metadata / merkle digest.
 * - Existing canonical fixtures must produce identical (or identical canonical hashes) for:
 *   gc_view, insurer_summary, judge_v4, auditor_pack_verify.
 * - Tier/Merkle are allowed ONLY when explicitly present, and must be additive.
 * - No changes to "default" verification results for existing packs.
 *
 * Run with FREEZE_RECORD=1 to print expected hashes (then paste into FROZEN_BASELINE_HASHES).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import JSZip from "jszip";
import type { TranscriptV4 } from "../../util/transcript_types.js";
import { renderGCView } from "../../gc_view/renderer.js";
import { resolveBlameV1 } from "../../dbl/blame_resolver_v1.js";
import { generateInsurerSummary } from "../auditor_pack_verify.js";
import { stableCanonicalize } from "../../util/canonical.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

/** Paths we strip before hashing baseline (additive-only fields). */
const ALLOWED_ADDITIVE_PATHS = [
  "policy.audit",
  "audit_tier",
  "audit_sla",
  "derived.merkle_digest",
  "gc_view.audit",
  "insurer_summary.audit",
] as const;

/**
 * Strip allowed additive paths from an object (for baseline hash comparison).
 * Paths are dot-separated; we only strip top-level or one-level nested keys.
 */
function stripAdditivePaths<T extends Record<string, unknown>>(obj: T, artifactKind: "gc_view" | "insurer_summary" | "judgment"): T {
  const out = JSON.parse(JSON.stringify(obj)) as T;
  if (artifactKind === "gc_view") {
    delete (out as Record<string, unknown>).audit;
    if (out.policy && typeof out.policy === "object" && out.policy !== null) {
      delete (out.policy as Record<string, unknown>).audit;
    }
  }
  if (artifactKind === "insurer_summary") {
    delete (out as Record<string, unknown>).audit_tier;
    delete (out as Record<string, unknown>).audit_sla;
  }
  return out;
}

function sha256Hex(str: string): string {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

function baselineHash(obj: unknown, artifactKind: "gc_view" | "insurer_summary" | "judgment"): string {
  const stripped = typeof obj === "object" && obj !== null && !Array.isArray(obj)
    ? stripAdditivePaths(obj as Record<string, unknown>, artifactKind)
    : obj;
  const canonical = stableCanonicalize(stripped);
  return sha256Hex(canonical);
}

function loadTranscript(path: string): TranscriptV4 {
  const fullPath = resolve(repoRoot, path);
  if (!existsSync(fullPath)) throw new Error(`Fixture not found: ${fullPath}`);
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}

/** Frozen baseline hashes: fixture key -> { gc_view, insurer_summary, judgment }. Update via FREEZE_RECORD=1. */
const FROZEN_BASELINE_HASHES: Record<string, { gc_view: string; insurer_summary: string; judgment: string }> = {
  "SUCCESS-001-simple": {
    gc_view: "088f4fb34f0884d1a66cafb354b0614704b3e5869e2de67ca80fb9f36774cb34",
    insurer_summary: "7702ebae816f446c072d3b6962e9cf87c05d63afd90af79b306fd20344f137bd",
    judgment: "3011a4232a6392018ed4929edc1398e74639c518fc38db0ee0d15d6c70dc110b",
  },
  "PACT-101-policy-violation": {
    gc_view: "31593d5dc3e3f0ccdca61d93c682436779e8f85b3190790a539764820a86eff2",
    insurer_summary: "401139c98914e9d0f665f461c9bb77a9ee3c54f01d36bb4372bd1530c219aad8",
    judgment: "652431d0b19b73720df2598f481bd24900aa8b21368207d850c13709e86c106f",
  },
  "PACT-420-provider-unreachable": {
    gc_view: "9d13d70352c075e50069c6d3dd9288e497154dc50912b8ccb440a8d77e9641be",
    insurer_summary: "e442f8b54000babd3428904cde8763cdfb6b50fdd90e17a484c1336d97748196",
    judgment: "f64acef2f168768a26d6324de30f4c7d708b2740dd3616089a04b3cb844c5a6b",
  },
  "PACT-421-provider-api-mismatch": {
    gc_view: "f2987b88374c0854a79c56fa4dd0c14b28e80c5da2f1dc481bd7b1dc8cc02839",
    insurer_summary: "2f5e47f487378b67c611369fe97fece4c8ca5ac8182a645bd0391837c33f0042",
    judgment: "0d464e9a070f9ff2f3440c131d14363858c8e8b726449b618aa121ef341f35fd",
  },
};

const TRANSCRIPT_FIXTURES: Array<[string, string]> = [
  ["SUCCESS-001-simple", "fixtures/success/SUCCESS-001-simple.json"],
  ["PACT-101-policy-violation", "fixtures/failures/PACT-101-policy-violation.json"],
  ["PACT-420-provider-unreachable", "fixtures/failures/PACT-420-provider-unreachable.json"],
  ["PACT-421-provider-api-mismatch", "fixtures/failures/PACT-421-provider-api-mismatch.json"],
];

describe("Freeze Protection", () => {
  it("record mode: prints FROZEN_BASELINE_HASHES when FREEZE_RECORD=1", async () => {
    if (process.env.FREEZE_RECORD !== "1") return;
    const hashes: Record<string, { gc_view: string; insurer_summary: string; judgment: string }> = {};
    for (const [key, relPath] of TRANSCRIPT_FIXTURES) {
      try {
        const transcript = loadTranscript(relPath);
        const gcView = await renderGCView(transcript);
        const judgment = await resolveBlameV1(transcript);
        const insurerSummary = await generateInsurerSummary(transcript, gcView, judgment);
        hashes[key] = {
          gc_view: baselineHash(gcView, "gc_view"),
          insurer_summary: baselineHash(insurerSummary, "insurer_summary"),
          judgment: baselineHash(judgment, "judgment"),
        };
      } catch (e) {
        console.error(`Fixture ${key}:`, e);
      }
    }
    console.log("// Paste into FROZEN_BASELINE_HASHES:\n" + JSON.stringify(hashes, null, 2));
  });

  describe("Transcript fixtures: gc_view, insurer_summary, judgment", () => {
    for (const [key, relPath] of TRANSCRIPT_FIXTURES) {
      it(`${key}: baseline hashes match frozen semantics`, async () => {
        const transcript = loadTranscript(relPath);
        const gcView = await renderGCView(transcript);
        const judgment = await resolveBlameV1(transcript);
        const insurerSummary = await generateInsurerSummary(transcript, gcView, judgment);

        const gcViewHash = baselineHash(gcView, "gc_view");
        const insurerHash = baselineHash(insurerSummary, "insurer_summary");
        const judgmentHash = baselineHash(judgment, "judgment");

        if (process.env.FREEZE_RECORD === "1") return;

        const expected = FROZEN_BASELINE_HASHES[key];
        expect(expected, `Missing FROZEN_BASELINE_HASHES for ${key}. Run with FREEZE_RECORD=1 to generate.`).toBeDefined();
        expect(gcViewHash).toBe(expected!.gc_view);
        expect(insurerHash).toBe(expected!.insurer_summary);
        expect(judgmentHash).toBe(expected!.judgment);
      });
    }
  });

  describe("Auditor packs: auditor-pack-verify", () => {
    /** Standard packs that must verify ok=true */
    const STANDARD_PACKS: Array<[string, string]> = [
      ["auditor_pack_success", "design_partner_bundle/packs/auditor_pack_success.zip"],
      ["auditor_pack_101", "design_partner_bundle/packs/auditor_pack_101.zip"],
      ["auditor_pack_420", "design_partner_bundle/packs/auditor_pack_420.zip"],
    ];

    for (const [name, relPath] of STANDARD_PACKS) {
      it(`${name}: verify ok=true`, async () => {
        const zipPath = resolve(repoRoot, relPath);
        if (!existsSync(zipPath)) {
          console.warn(`Skip: pack not found ${relPath}`);
          return;
        }
        const { main } = await import("../auditor_pack_verify.js");
        const origArgv = process.argv;
        const origExit = process.exit;
        const logs: string[] = [];
        const captureLog = (...args: unknown[]) => logs.push(args.map(String).join(" "));
        process.argv = ["node", "auditor_pack_verify.js", "--zip", zipPath];
        (process as NodeJS.Process).exit = ((code?: number) => {
          throw new Error(`exit(${code ?? 0})`);
        }) as never;
        let stdout = "";
        const origConsoleLog = console.log;
        console.log = (...args: unknown[]) => {
          const s = args.map(String).join(" ");
          if (s.includes('"ok":') && s.includes("auditor_pack_verify")) stdout = s;
          origConsoleLog(...args);
        };
        try {
          await main();
        } catch (e) {
          if (!(e instanceof Error) || !e.message.startsWith("exit(")) throw e;
        } finally {
          process.argv = origArgv;
          (process as NodeJS.Process).exit = origExit;
          console.log = origConsoleLog;
        }
        const report = JSON.parse(stdout) as { ok: boolean };
        expect(report.ok).toBe(true);
      });
    }

    it("tamper pack: verify ok=false", async () => {
      const tamperPath = resolve(repoRoot, "demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip");
      if (!existsSync(tamperPath)) {
        console.warn("Skip: tamper pack not found (run demo/h5-golden first)");
        return;
      }
      const { main } = await import("../auditor_pack_verify.js");
      const origArgv = process.argv;
      const origExit = process.exit;
      let stdout = "";
      const origConsoleLog = console.log;
      console.log = (...args: unknown[]) => {
        const s = args.map(String).join(" ");
        if (s.includes('"ok":') && s.includes("auditor_pack_verify")) stdout = s;
        origConsoleLog(...args);
      };
      process.argv = ["node", "auditor_pack_verify.js", "--zip", tamperPath];
      (process as NodeJS.Process).exit = ((code?: number) => { throw new Error(`exit(${code ?? 0})`); }) as never;
      try {
        await main();
      } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith("exit(")) throw e;
      } finally {
        process.argv = origArgv;
        (process as NodeJS.Process).exit = origExit;
        console.log = origConsoleLog;
      }
      const report = JSON.parse(stdout) as { ok: boolean };
      expect(report.ok).toBe(false);
    });

    it("tampered constitution pack: verify fails", async () => {
      const successPackPath = resolve(repoRoot, "design_partner_bundle/packs/auditor_pack_success.zip");
      if (!existsSync(successPackPath)) {
        console.warn("Skip: success pack not found");
        return;
      }
      const zipBuffer = readFileSync(successPackPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      const constitutionFile = zip.file("constitution/CONSTITUTION_v1.md");
      if (!constitutionFile) throw new Error("No constitution in pack");
      let constitutionContent = await constitutionFile.async("string");
      constitutionContent = constitutionContent.replace("constitution/1.0", "constitution/1.0_TAMPERED");
      zip.file("constitution/CONSTITUTION_v1.md", constitutionContent);
      const checksumsFile = zip.file("checksums.sha256");
      if (checksumsFile) {
        const lines = (await checksumsFile.async("string")).trim().split("\n");
        const newLines: string[] = [];
        for (const line of lines) {
          const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
          if (match) {
            const [, , path] = match;
            if (path === "constitution/CONSTITUTION_v1.md") {
              const newHash = sha256Hex(constitutionContent);
              newLines.push(`${newHash}  ${path}`);
            } else {
              newLines.push(line);
            }
          } else {
            newLines.push(line);
          }
        }
        zip.file("checksums.sha256", newLines.join("\n") + "\n");
      }
      const tempDir = mkdtempSync(join(tmpdir(), "freeze-tamper-"));
      try {
        const outPath = join(tempDir, "tampered_constitution.zip");
        const outBuffer = await zip.generateAsync({ type: "nodebuffer" });
        writeFileSync(outPath, outBuffer);
        const { main } = await import("../auditor_pack_verify.js");
        let stdout = "";
        const origConsoleLog = console.log;
        console.log = (...args: unknown[]) => {
          const s = args.map(String).join(" ");
          if (s.includes('"ok":') && s.includes("auditor_pack_verify")) stdout = s;
          origConsoleLog(...args);
        };
        process.argv = ["node", "auditor_pack_verify.js", "--zip", outPath];
        (process as NodeJS.Process).exit = ((code?: number) => { throw new Error(`exit(${code ?? 0})`); }) as never;
        const origArgv = process.argv;
        const origExit = process.exit;
        try {
          await main();
        } catch (e) {
          if (!(e instanceof Error) || !e.message.startsWith("exit(")) throw e;
        } finally {
          process.argv = origArgv;
          (process as NodeJS.Process).exit = origExit;
          console.log = origConsoleLog;
        }
        const report = JSON.parse(stdout) as { ok: boolean; mismatches: string[] };
        expect(report.ok).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Additive only: tier/merkle absent => baseline unchanged", () => {
    it("fixtures without tier/merkle produce same baseline hash as frozen", async () => {
      for (const [key, relPath] of TRANSCRIPT_FIXTURES) {
        const transcript = loadTranscript(relPath);
        const gcView = await renderGCView(transcript);
        const judgment = await resolveBlameV1(transcript);
        const insurerSummary = await generateInsurerSummary(transcript, gcView, judgment);
        const expected = FROZEN_BASELINE_HASHES[key];
        if (!expected || !expected.gc_view) continue;
        expect(baselineHash(gcView, "gc_view")).toBe(expected.gc_view);
        expect(baselineHash(insurerSummary, "insurer_summary")).toBe(expected.insurer_summary);
        expect(baselineHash(judgment, "judgment")).toBe(expected.judgment);
      }
    });
  });
});
