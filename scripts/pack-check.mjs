#!/usr/bin/env node
/**
 * Pack Check Script
 * 
 * Verifies that packages can be packed successfully for distribution.
 * Runs pnpm pack on @pact/sdk and @pact/provider-adapter.
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readdirSync, unlinkSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const packages = [
  { name: "@pact/sdk", path: join(repoRoot, "packages", "sdk") },
  { name: "@pact/provider-adapter", path: join(repoRoot, "packages", "provider-adapter") },
];

console.log("=== Pack Check ===\n");

let allPassed = true;

for (const pkg of packages) {
  console.log(`Checking ${pkg.name}...`);
  
  try {
    // Ensure package is built
    console.log(`  Building ${pkg.name}...`);
    execSync("pnpm build", {
      cwd: pkg.path,
      stdio: "inherit",
    });
    
    // Run pack (will create .tgz file)
    console.log(`  Packing ${pkg.name}...`);
    let packOutput = "";
    try {
      packOutput = execSync("pnpm pack", {
        cwd: pkg.path,
        encoding: "utf-8",
        stdio: "pipe",
      });
      
      // Check for warnings or errors in output
      if (packOutput.includes("WARN") || packOutput.includes("ERROR")) {
        console.error(`  ❌ ${pkg.name} has warnings or errors:`);
        console.error(packOutput);
        allPassed = false;
      } else {
        console.log(`  ✅ ${pkg.name} packed successfully`);
      }
      
      // Clean up .tgz file
      const files = readdirSync(pkg.path);
      for (const file of files) {
        if (file.endsWith(".tgz")) {
          unlinkSync(join(pkg.path, file));
        }
      }
    } catch (error) {
      console.error(`  ❌ ${pkg.name} pack failed:`);
      console.error(error.message);
      if (error.stdout) console.error(error.stdout);
      if (error.stderr) console.error(error.stderr);
      allPassed = false;
    }
    
  } catch (error) {
    console.error(`  ❌ ${pkg.name} failed:`);
    console.error(error.message);
    allPassed = false;
  }
  
  console.log();
}

if (allPassed) {
  console.log("✅ All packages passed pack check");
  process.exit(0);
} else {
  console.error("❌ Some packages failed pack check");
  process.exit(1);
}
