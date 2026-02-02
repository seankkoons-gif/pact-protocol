/**
 * Load transcript from file path (Node only).
 * Used by resolveBlameV1 when called with a path string from CLI.
 * Do not import this from browser code; blame_resolver_v1 dynamic-imports it only when path is string.
 */

import { readFileSync } from "node:fs";
import type { TranscriptV4 } from "../util/transcript_types.js";

export function loadTranscriptFromPath(path: string): TranscriptV4 {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content) as TranscriptV4;
}
