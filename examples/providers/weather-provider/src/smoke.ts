#!/usr/bin/env tsx
/**
 * Smoke Test for Weather Provider
 * 
 * Starts server, sends one Pact request, verifies transcript exists.
 */

import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { getProviderDebugDir } from "./repoRoot.js";

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;
const POLL_INTERVAL_MS = 200;
const MAX_WAIT_MS = 10000;

// Capture server output for debugging
let serverStdout = "";
let serverStderr = "";

async function waitForServer(maxWait = MAX_WAIT_MS): Promise<boolean> {
  const start = Date.now();
  let lastError: Error | null = null;
  
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`${SERVER_URL}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ok === true) {
          return true;
        }
      }
    } catch (error: any) {
      lastError = error;
      // Server not ready yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  
  // Log last error for debugging
  if (lastError) {
    console.error(`  Last health check error: ${lastError.message}`);
  }
  
  return false;
}

async function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(port, () => {
      server.close(() => resolve(false));
    });
    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

function waitForProcessExit(process: ChildProcess, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.killed || process.exitCode !== null) {
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      reject(new Error("Process did not exit within timeout"));
    }, timeout);

    process.once("exit", () => {
      clearTimeout(timeoutId);
      resolve();
    });

    process.once("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function sendPactRequest() {
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

  const response = await fetch(`${SERVER_URL}/pact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intentMessage),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return await response.json();
}

async function verifyTranscript(): Promise<boolean> {
  const providerDebugDir = getProviderDebugDir();

  if (!fs.existsSync(providerDebugDir)) {
    return false;
  }

  const files = fs.readdirSync(providerDebugDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  if (jsonFiles.length === 0) {
    return false;
  }

  const debugFile = path.join(providerDebugDir, jsonFiles[0]);
  const content = fs.readFileSync(debugFile, "utf-8");
  const parsed = JSON.parse(content);

  return !!(parsed.message_type || parsed.intent_id);
}

async function main() {
  console.log("🧪 Weather Provider Smoke Test\n");

  // Check if port is already in use
  const portInUse = await checkPortInUse(PORT);
  if (portInUse) {
    console.error(`❌ Port ${PORT} is already in use`);
    console.error(`   Please stop any process using port ${PORT} and try again`);
    process.exit(1);
  }

  // Start server with explicit PORT env var
  console.log(`  Starting server on port ${PORT}...`);
  const serverProcess = spawn("tsx", ["src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture stdout and stderr
  serverProcess.stdout?.on("data", (data) => {
    const text = data.toString();
    serverStdout += text;
    // Optionally log server output (uncomment for debugging)
    // process.stdout.write(`[SERVER] ${text}`);
  });

  serverProcess.stderr?.on("data", (data) => {
    const text = data.toString();
    serverStderr += text;
    // Optionally log server errors (uncomment for debugging)
    // process.stderr.write(`[SERVER ERR] ${text}`);
  });

  let serverStarted = false;

  try {
    // Wait for server to start
    const ready = await waitForServer(MAX_WAIT_MS);
    if (!ready) {
      console.error(`  ❌ Server failed to start within ${MAX_WAIT_MS / 1000}s`);
      console.error(`\n  Server stdout (last 500 chars):`);
      console.error(`  ${serverStdout.slice(-500).split("\n").join("\n  ")}`);
      console.error(`\n  Server stderr (last 500 chars):`);
      console.error(`  ${serverStderr.slice(-500).split("\n").join("\n  ")}`);
      throw new Error(`Server failed to start within ${MAX_WAIT_MS / 1000} seconds`);
    }

    serverStarted = true;
    console.log(`  ✅ Server started\n`);

    // Send Pact request
    console.log("  Sending Pact request...");
    const response = await sendPactRequest();
    console.log(`  ✅ Pact request successful\n`);

    // Wait a bit for provider debug log to be written
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify provider debug output in repo root .pact/provider_debug
    console.log("  Verifying provider debug output...");
    const debugExists = await verifyTranscript();
    if (!debugExists) {
      throw new Error("Provider debug log not found or invalid");
    }
    console.log(`  ✅ Provider debug verified\n`);

    console.log("✅ Smoke test passed!");
  } catch (error: any) {
    console.error(`\n❌ Smoke test failed: ${error.message}`);
    
    if (serverStarted) {
      console.error(`\n  Server was running. Last output:`);
      if (serverStdout) {
        console.error(`  stdout: ${serverStdout.slice(-300)}`);
      }
      if (serverStderr) {
        console.error(`  stderr: ${serverStderr.slice(-300)}`);
      }
    } else {
      console.error(`\n  Server failed to start. Output:`);
      if (serverStdout) {
        console.error(`  stdout:\n${serverStdout.split("\n").map((l) => `    ${l}`).join("\n")}`);
      }
      if (serverStderr) {
        console.error(`  stderr:\n${serverStderr.split("\n").map((l) => `    ${l}`).join("\n")}`);
      }
    }
    
    process.exit(1);
  } finally {
    // Clean up server
    if (serverProcess && !serverProcess.killed) {
      console.log(`  Shutting down server...`);
      serverProcess.kill("SIGTERM");
      
      try {
        await waitForProcessExit(serverProcess, 5000);
        console.log(`  ✅ Server stopped`);
      } catch (error: any) {
        console.error(`  ⚠️  Server did not exit gracefully: ${error.message}`);
        console.log(`  Force killing server...`);
        serverProcess.kill("SIGKILL");
        await waitForProcessExit(serverProcess, 2000).catch(() => {
          // Ignore errors on force kill
        });
      }
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
