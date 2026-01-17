#!/usr/bin/env node
/**
 * Scaffold Smoke Test
 * 
 * Tests create-pact-provider CLI end-to-end by:
 * 1. Building the CLI (if needed)
 * 2. Running CLI in non-interactive mode for each template combo
 * 3. Installing dependencies
 * 4. Starting the server on a random port
 * 5. Sending a Pact request
 * 6. Verifying transcript exists
 * 7. Cleaning up processes and temp files
 */

import { mkdir, rm, readdir, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const tmpDir = join(repoRoot, ".tmp");

// Test configurations: template combos (at minimum boundary/none for CI speed)
const TEST_CONFIGS = [
  { template: "express", settlement: "boundary", kya: "none" },
  { template: "worker", settlement: "boundary", kya: "none" },
  { template: "nextjs", settlement: "boundary", kya: "none" },
];

const TIMEOUT_MS = 60000; // 60 seconds per test
const SERVER_START_TIMEOUT = 10000; // 10 seconds for server to start

/**
 * Find an available port
 */
async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, () => {
      const port = server.address()?.port;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not find available port"));
      });
    });
    server.on("error", reject);
  });
}

/**
 * Wait for server to be ready (health check)
 */
async function waitForServer(url, maxWait = SERVER_START_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Build CLI if needed
 */
async function ensureCliBuilt() {
  const cliPath = join(repoRoot, "packages", "create-pact-provider", "dist", "cli.js");
  
  try {
    await stat(cliPath);
    console.log("✅ CLI already built");
    return cliPath;
  } catch {
    console.log("📦 Building CLI...");
    try {
      execSync("pnpm -C packages/create-pact-provider build", {
        cwd: repoRoot,
        stdio: "inherit",
      });
      await stat(cliPath);
      console.log("✅ CLI built successfully");
      return cliPath;
    } catch (error) {
      console.error("❌ Failed to build CLI:", error.message);
      throw error;
    }
  }
}

/**
 * Run CLI in non-interactive mode
 */
async function runCli(projectName, config, cliPath) {
  const args = [
    cliPath,
    projectName,
    "--template", config.template,
    "--settlement", config.settlement,
    "--kya", config.kya,
    "--no-install", // Don't install in smoke test - we'll do it separately
  ];

  console.log(`  Running: ${args.join(" ")}`);

  try {
    execSync(`node ${args.join(" ")}`, {
      cwd: tmpDir,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "development" },
    });
    return join(tmpDir, projectName);
  } catch (error) {
    throw new Error(`CLI failed: ${error.message}`);
  }
}

/**
 * Install dependencies in project
 */
async function installDependencies(projectPath) {
  // Detect package manager (prefer pnpm, fallback to npm)
  let pmCmd = "npm";
  try {
    execSync("pnpm --version", { stdio: "ignore" });
    pmCmd = "pnpm";
  } catch {
    // pnpm not available, use npm
  }

  console.log(`  Installing dependencies with ${pmCmd}...`);

  try {
    execSync(`${pmCmd} install`, {
      cwd: projectPath,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "development" },
    });
    return pmCmd;
  } catch (error) {
    throw new Error(`Dependency installation failed: ${error.message}`);
  }
}

/**
 * Start server based on template type
 */
async function startServer(projectPath, template, pmCmd, port) {
  let serverProcess;
  let devCmd;
  let baseUrl;

  if (template === "express") {
    // Express: set PORT env var
    devCmd = `${pmCmd} run dev`;
    baseUrl = `http://localhost:${port}`;
    serverProcess = spawn(pmCmd, ["run", "dev"], {
      cwd: projectPath,
      env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
      stdio: "pipe",
    });
  } else if (template === "worker") {
    // Worker: wrangler dev with --port
    devCmd = `${pmCmd} run dev -- --port ${port}`;
    baseUrl = `http://localhost:${port}`;
    serverProcess = spawn("wrangler", ["dev", "--port", String(port)], {
      cwd: projectPath,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: "pipe",
    });
  } else if (template === "nextjs") {
    // Next.js: next dev with -p port
    devCmd = `${pmCmd} run dev -- -p ${port}`;
    baseUrl = `http://localhost:${port}`;
    serverProcess = spawn(pmCmd, ["run", "dev", "--", "-p", String(port)], {
      cwd: projectPath,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: "pipe",
    });
  } else {
    throw new Error(`Unknown template: ${template}`);
  }

  // Capture stderr for debugging
  let serverError = "";
  serverProcess.stderr?.on("data", (data) => {
    serverError += data.toString();
  });

  // Wait for server to start
  const ready = await waitForServer(baseUrl, SERVER_START_TIMEOUT);
  if (!ready) {
    serverProcess.kill();
    throw new Error(`Server failed to start. Error: ${serverError}`);
  }

  console.log(`  ✅ Server started on ${baseUrl}`);

  return { process: serverProcess, url: baseUrl };
}

/**
 * Send Pact request to server
 */
async function sendPactRequest(url, template) {
  const intentMessage = {
    envelope_version: "pact-envelope/1.0",
    message: {
      protocol_version: "pact/1.0",
      type: "INTENT",
      intent_id: `smoke-test-${Date.now()}`,
      intent: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      max_price: 0.0002,
      settlement_mode: "hash_reveal",
      sent_at_ms: Date.now(),
      expires_at_ms: Date.now() + 60000,
    },
    message_hash_hex: "test",
    signer_public_key_b58: "test",
    signature_b58: "test",
    signed_at_ms: Date.now(),
  };

  const endpoint = template === "nextjs" ? `${url}/api/pact` : `${url}/pact`;

  console.log(`  Sending Pact request to ${endpoint}...`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intentMessage),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const result = await response.json();
    console.log(`  ✅ Pact request successful`);
    return result;
  } catch (error) {
    throw new Error(`Pact request failed: ${error.message}`);
  }
}

/**
 * Verify transcript was created
 */
async function verifyTranscript(projectPath) {
  const transcriptDir = join(projectPath, ".pact", "transcripts");

  try {
    const files = await readdir(transcriptDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) {
      return { ok: false, reason: "No transcript JSON files found" };
    }

    // Verify at least one transcript is valid JSON
    const transcriptFile = join(transcriptDir, jsonFiles[0]);
    const content = await readFile(transcriptFile, "utf-8");
    const parsed = JSON.parse(content);

    // Check for basic transcript structure
    if (!parsed.message_type && !parsed.intent_type) {
      return { ok: false, reason: "Transcript missing required fields" };
    }

    return { ok: true, transcript_path: transcriptFile };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * Test a single template configuration
 */
async function testConfig(config, index) {
  const projectName = `smoke-${config.template}-${config.settlement}-${config.kya}-${index}`;
  const projectPath = join(tmpDir, projectName);
  let serverProcess = null;

  try {
    console.log(`\n🧪 Testing: ${config.template}/${config.settlement}/${config.kya}`);

    // 1. Ensure CLI is built
    const cliPath = await ensureCliBuilt();

    // 2. Run CLI to create project
    await runCli(projectName, config, cliPath);

    // 3. Install dependencies
    const pmCmd = await installDependencies(projectPath);

    // 4. Find available port
    const port = await findAvailablePort();
    console.log(`  Using port: ${port}`);

    // 5. Start server
    const { process: server, url } = await startServer(projectPath, config.template, pmCmd, port);
    serverProcess = server;

    // 6. Send Pact request
    await sendPactRequest(url, config.template);

    // 7. Wait a bit for transcript to be written
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 8. Verify transcript
    const verification = await verifyTranscript(projectPath);
    if (!verification.ok) {
      throw new Error(`Transcript verification failed: ${verification.reason}`);
    }

    console.log(`  ✅ Transcript created: ${verification.transcript_path}`);
    return { ok: true };
  } catch (error) {
    console.error(`  ❌ Test failed: ${error.message}`);
    return { ok: false, error: error.message };
  } finally {
    // 9. Clean up server process
    if (serverProcess) {
      try {
        serverProcess.kill("SIGTERM");
        // Wait a bit for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!serverProcess.killed) {
          serverProcess.kill("SIGKILL");
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Main smoke test
 */
async function main() {
  console.log("🧪 Scaffold Smoke Test\n");
  console.log("Testing create-pact-provider CLI end-to-end...\n");

  // Clean up previous test runs
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }

  await mkdir(tmpDir, { recursive: true });

  const results = [];

  // Test each configuration
  for (let i = 0; i < TEST_CONFIGS.length; i++) {
    const config = TEST_CONFIGS[i];
    const result = await Promise.race([
      testConfig(config, i),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Test timeout")), TIMEOUT_MS)
      ),
    ]).catch((error) => ({ ok: false, error: error.message }));

    results.push({ config, ...result });
  }

  // Summary
  console.log("\n📊 Test Results:");
  let allPassed = true;
  for (const result of results) {
    const status = result.ok ? "✅" : "❌";
    const configStr = `${result.config.template}/${result.config.settlement}/${result.config.kya}`;
    console.log(`  ${status} ${configStr}`);
    if (!result.ok) {
      console.log(`     Error: ${result.error || "Unknown error"}`);
      allPassed = false;
    }
  }

  // Cleanup on success, keep on failure for debugging
  if (allPassed) {
    try {
      await rm(tmpDir, { recursive: true, force: true });
      console.log("\n✅ All smoke tests passed! (temp files cleaned up)");
    } catch {
      // Ignore cleanup errors
      console.log("\n✅ All smoke tests passed! (temp files may remain)");
    }
  } else {
    console.log(`\n❌ Some tests failed. Temp files kept in: ${tmpDir}`);
    console.log("   Inspect .tmp/ directory for debugging");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
