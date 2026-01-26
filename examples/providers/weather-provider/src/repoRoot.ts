/**
 * Resolve repository root for consistent .pact paths.
 * Walks up from startDir looking for pnpm-workspace.yaml / .git + package.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const hasPackageJson = fs.existsSync(path.join(current, "package.json"));
    const hasGit = fs.existsSync(path.join(current, ".git"));
    const hasPnpmWorkspace = fs.existsSync(path.join(current, "pnpm-workspace.yaml"));

    if (hasPackageJson && (hasGit || hasPnpmWorkspace)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return startDir;
}

/** Always use repo root .pact/provider_debug for provider debug output. */
export function getProviderDebugDir(): string {
  return path.join(findRepoRoot(), ".pact", "provider_debug");
}
