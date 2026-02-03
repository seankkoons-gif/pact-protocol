/**
 * Browser stub for @pact/verifier load_transcript_node.
 * Evidence-viewer always passes transcript object to resolveBlameV1, so this is never called.
 * Exists only so Vite can resolve the dynamic import without pulling in node:fs.
 */

export function loadTranscriptFromPath(_path: string): never {
  throw new Error('Node-only: loadTranscriptFromPath not available in browser');
}
