#!/usr/bin/env tsx
/**
 * Smoke Test for LLM Verifier Provider
 * 
 * Starts server, sends one Pact request, verifies transcript exists.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = 3002;
const SERVER_URL = `http://localhost:${PORT}`;

async function waitForServer(maxWait = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`${SERVER_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
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

async function sendPactRequest() {
  const intentMessage = {
    envelope_version: "pact-envelope/1.0",
    message: {
      protocol_version: "pact/1.0",
      type: "INTENT",
      intent_id: `smoke-test-${Date.now()}`,
      intent: "llm.verify",
      scope: { statement: "The sky is blue.", method: "quick" },
      constraints: { latency_ms: 200 },
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
  const transcriptDir = path.join(process.cwd(), ".pact", "transcripts");

  if (!fs.existsSync(transcriptDir)) {
    return false;
  }

  const files = fs.readdirSync(transcriptDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  if (jsonFiles.length === 0) {
    return false;
  }

  // Verify at least one transcript is valid JSON
  const transcriptFile = path.join(transcriptDir, jsonFiles[0]);
  const content = fs.readFileSync(transcriptFile, "utf-8");
  const parsed = JSON.parse(content);

  return !!(parsed.message_type || parsed.intent_id);
}

async function main() {
  console.log("🧪 LLM Verifier Provider Smoke Test\n");

  // Start server
  const serverProcess = spawn("tsx", ["src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  try {
    console.log(`  Starting server on port ${PORT}...`);

    // Wait for server to start
    const ready = await waitForServer(10000);
    if (!ready) {
      throw new Error("Server failed to start within 10 seconds");
    }

    console.log(`  ✅ Server started\n`);

    // Send Pact request
    console.log("  Sending Pact request...");
    const response = await sendPactRequest();
    console.log(`  ✅ Pact request successful\n`);

    // Wait a bit for transcript to be written
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify transcript
    console.log("  Verifying transcript...");
    const transcriptExists = await verifyTranscript();
    if (!transcriptExists) {
      throw new Error("Transcript not found or invalid");
    }
    console.log(`  ✅ Transcript verified\n`);

    console.log("✅ Smoke test passed!");
  } catch (error: any) {
    console.error(`❌ Smoke test failed: ${error.message}`);
    process.exit(1);
  } finally {
    // Clean up server
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
