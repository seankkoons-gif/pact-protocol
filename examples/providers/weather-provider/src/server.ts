/**
 * Weather Provider Server
 * 
 * A Pact provider offering weather.data product with deterministic pricing.
 */

import express from "express";
import { handlePactRequest, ensureTranscriptDir } from "./pactHandler.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "weather-provider",
    version: "0.1.0",
    product: "weather.data",
  });
});

// Pact protocol endpoint
app.post("/pact", async (req, res) => {
  try {
    // Ensure transcript directory exists
    ensureTranscriptDir();

    const raw = req.body;
    
    // Normalize request body into canonical envelope object
    // Accept both shapes:
    // 1. Nested: {envelope: {envelope_version: "...", message: {...}}}
    // 2. Flat: {envelope_version: "...", message: {...}}
    let env: any = null;
    if (raw?.envelope?.envelope_version) {
      // Nested shape: extract envelope object
      env = raw.envelope;
    } else if (raw?.envelope_version) {
      // Flat shape: use raw as envelope
      env = {
        envelope_version: raw.envelope_version,
        message: raw.message,
        // Include other envelope fields if present
        message_hash_hex: raw.message_hash_hex,
        envelope_hash_hex: raw.envelope_hash_hex,
        signer_public_key_b58: raw.signer_public_key_b58,
        signature_b58: raw.signature_b58,
        signed_at_ms: raw.signed_at_ms,
      };
    }

    // Validate normalized envelope structure
    if (!env) {
      res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        missing: ["envelope.envelope_version", "envelope.message"],
        message: "Missing required field(s): envelope.envelope_version, envelope.message",
      });
      return;
    }

    if (!env.envelope_version) {
      res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        missing: ["envelope.envelope_version"],
        message: "Missing required field: envelope.envelope_version",
      });
      return;
    }

    if (!env.message) {
      res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        missing: ["envelope.message"],
        message: "Missing required field: envelope.message",
      });
      return;
    }

    // Pass canonical envelope to handler
    const response = await handlePactRequest(env);

    // Check if response is an error object
    if (response && typeof response === "object" && "ok" in response && response.ok === false) {
      const errorResponse = response as { ok: false; error: string; missing?: string[]; message: string; detail?: string };
      
      // INTERNAL_ERROR should return 500, BAD_REQUEST should return 400
      if (errorResponse.error === "INTERNAL_ERROR") {
        res.status(500).json({
          ok: false,
          error: errorResponse.error,
          message: errorResponse.message,
          detail: errorResponse.detail,
        });
      } else {
        res.status(400).json({
          ok: false,
          error: errorResponse.error,
          missing: errorResponse.missing ?? [], // Use ?? to ensure array even if undefined
          message: errorResponse.message,
          ...(errorResponse.detail ? { detail: errorResponse.detail } : {}),
        });
      }
      return;
    }

    // Success response (SignedEnvelope)
    res.json(response);
  } catch (error: any) {
    // Catch any unhandled exceptions (shouldn't happen if handlePactRequest is properly wrapped)
    console.error("[Server] Unhandled error handling Pact request:", error.message);
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack || "";
    
    // Check if this is a property access error
    if (errorMessage.includes("Cannot read properties") || errorMessage.includes("reading")) {
      res.status(500).json({
        ok: false,
        error: "INTERNAL_ERROR",
        message: "Provider threw unhandled error",
        detail: errorMessage, // Stack stripped - only message
      });
    } else {
      res.status(500).json({
        ok: false,
        error: "INTERNAL_ERROR",
        message: "Provider threw unhandled error",
        detail: errorMessage, // Stack stripped - only message
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Weather Provider Server`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Pact:   http://localhost:${PORT}/pact\n`);
});
