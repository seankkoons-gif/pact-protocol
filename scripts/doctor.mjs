#!/usr/bin/env node
/**
 * H2: PACT Doctor Command
 * 
 * Checks local environment and common misconfigurations.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import http from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

const results = {
  pass: [],
  warn: [],
  fail: [],
};

function check(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      results.pass.push(name);
      console.log(`✅ PASS: ${name}`);
    } else if (result === false) {
      results.fail.push(name);
      console.log(`❌ FAIL: ${name}`);
    } else if (typeof result === "string") {
      results.warn.push(name);
      console.log(`⚠️  WARN: ${name} - ${result}`);
    }
  } catch (error) {
    results.fail.push(name);
    console.log(`❌ FAIL: ${name} - ${error.message}`);
  }
}

// Check Node version
check("Node version >= 20", () => {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0]);
  if (major < 20) {
    return `Node ${nodeVersion} detected, recommend >= 20.0.0`;
  }
  return true;
});

// Check pnpm version
check("pnpm version >= 9", () => {
  try {
    const pnpmVersion = execSync("pnpm --version", { encoding: "utf-8", cwd: REPO_ROOT }).trim();
    const major = parseInt(pnpmVersion.split(".")[0]);
    if (major < 9) {
      return `pnpm ${pnpmVersion} detected, recommend >= 9.0.0`;
    }
    return true;
  } catch (error) {
    return "pnpm not found in PATH";
  }
});

// Check repo root
check("Repo root (pnpm-workspace.yaml exists)", () => {
  const workspaceFile = join(REPO_ROOT, "pnpm-workspace.yaml");
  if (!existsSync(workspaceFile)) {
    return false;
  }
  return true;
});

// Check workspace install
check("Workspace install (node_modules exists)", () => {
  const nodeModules = join(REPO_ROOT, "node_modules");
  if (!existsSync(nodeModules)) {
    return "node_modules not found, run 'pnpm install'";
  }
  return true;
});

// Check providers.jsonl
check("providers.jsonl exists at repo root", () => {
  const providersFile = join(REPO_ROOT, "providers.jsonl");
  if (!existsSync(providersFile)) {
    return "providers.jsonl not found, register a provider with 'pnpm provider:register'";
  }
  return true;
});

// Check provider endpoint reachable (async, handled separately)
async function checkProviderEndpoint() {
  const providersFile = join(REPO_ROOT, "providers.jsonl");
  if (!existsSync(providersFile)) {
    results.warn.push("Provider endpoint reachable");
    console.log(`⚠️  WARN: Provider endpoint reachable - providers.jsonl not found, skipping endpoint check`);
    return;
  }
  
  try {
    const content = readFileSync(providersFile, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.trim());
    
    if (lines.length === 0) {
      results.warn.push("Provider endpoint reachable");
      console.log(`⚠️  WARN: Provider endpoint reachable - providers.jsonl is empty, skipping endpoint check`);
      return;
    }
    
    // Parse first provider entry
    const firstProvider = JSON.parse(lines[0]);
    const endpoint = firstProvider.endpoint;
    
    if (!endpoint || (!endpoint.startsWith("http://127.0.0.1:") && !endpoint.startsWith("http://localhost:"))) {
      results.warn.push("Provider endpoint reachable");
      console.log(`⚠️  WARN: Provider endpoint reachable - No localhost endpoint found in providers.jsonl, skipping check`);
      return;
    }
    
    // Try to reach /health or /
    const healthUrl = new URL("/health", endpoint);
    
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        results.warn.push("Provider endpoint reachable");
        console.log(`⚠️  WARN: Provider endpoint reachable - Timeout (500ms)`);
        resolve(null);
      }, 500);
      
      const req = http.get(healthUrl, (res) => {
        clearTimeout(timeout);
        if (res.statusCode === 200) {
          results.pass.push("Provider endpoint reachable");
          console.log(`✅ PASS: Provider endpoint reachable`);
        } else {
          // Try root endpoint as fallback
          const rootUrl = new URL("/", endpoint);
          const req2 = http.get(rootUrl, (res2) => {
            if (res2.statusCode === 200 || res2.statusCode === 404) {
              results.pass.push("Provider endpoint reachable");
              console.log(`✅ PASS: Provider endpoint reachable`);
            } else {
              results.warn.push("Provider endpoint reachable");
              console.log(`⚠️  WARN: Provider endpoint reachable - Returned ${res2.statusCode}`);
            }
            resolve(null);
          });
          req2.on("error", () => {
            results.warn.push("Provider endpoint reachable");
            console.log(`⚠️  WARN: Provider endpoint reachable - Unreachable`);
            resolve(null);
          });
          req2.setTimeout(500, () => {
            req2.destroy();
            results.warn.push("Provider endpoint reachable");
            console.log(`⚠️  WARN: Provider endpoint reachable - Timeout (500ms)`);
            resolve(null);
          });
        }
        resolve(null);
      });
      
      req.on("error", () => {
        clearTimeout(timeout);
        // Try root endpoint as fallback
        const rootUrl = new URL("/", endpoint);
        const req2 = http.get(rootUrl, (res2) => {
          if (res2.statusCode === 200 || res2.statusCode === 404) {
            results.pass.push("Provider endpoint reachable");
            console.log(`✅ PASS: Provider endpoint reachable`);
          } else {
            results.warn.push("Provider endpoint reachable");
            console.log(`⚠️  WARN: Provider endpoint reachable - Unreachable`);
          }
          resolve(null);
        });
        req2.on("error", () => {
          results.warn.push("Provider endpoint reachable");
          console.log(`⚠️  WARN: Provider endpoint reachable - Unreachable`);
          resolve(null);
        });
        req2.setTimeout(500, () => {
          req2.destroy();
          results.warn.push("Provider endpoint reachable");
          console.log(`⚠️  WARN: Provider endpoint reachable - Timeout (500ms)`);
          resolve(null);
        });
      });
      
      req.setTimeout(500, () => {
        req.destroy();
        clearTimeout(timeout);
        results.warn.push("Provider endpoint reachable");
        console.log(`⚠️  WARN: Provider endpoint reachable - Timeout (500ms)`);
        resolve(null);
      });
    });
  } catch (error) {
    results.warn.push("Provider endpoint reachable");
    console.log(`⚠️  WARN: Provider endpoint reachable - ${error.message}`);
  }
}

// Check deterministic seed guidance
check("Deterministic seed guidance", () => {
  if (!process.env.PACT_DEV_IDENTITY_SEED) {
    return "PACT_DEV_IDENTITY_SEED not set. For deterministic demos, set:\n  export PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1";
  }
  return true;
});

// Run async provider endpoint check and then summary
(async () => {
  await checkProviderEndpoint();
  
  console.log("\n=== Summary ===");
  console.log(`✅ Passed: ${results.pass.length}`);
  console.log(`⚠️  Warnings: ${results.warn.length}`);
  console.log(`❌ Failed: ${results.fail.length}`);
  
  if (results.fail.length > 0) {
    process.exit(1);
  } else {
    process.exit(0); // Warnings don't fail
  }
})();

