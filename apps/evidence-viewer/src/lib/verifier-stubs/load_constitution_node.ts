/**
 * Browser stub for @pact/verifier load_constitution_node.
 * Evidence-viewer always passes constitutionContent + sha256Async to renderGCView, so this is never called.
 * Exists only so Vite can resolve the dynamic import without pulling in node:fs/path/url.
 */

export function getConstitutionPath(_constitutionPath?: string): never {
  throw new Error('Node-only: getConstitutionPath not available in browser');
}

export function getConstitutionContent(_constitutionPath?: string): never {
  throw new Error('Node-only: getConstitutionContent not available in browser');
}

export function loadConstitution(_constitutionPath?: string): never {
  throw new Error('Node-only: loadConstitution not available in browser');
}
