/**
 * LLM Verifier Provider Server
 * 
 * A Pact provider offering llm.verify product with deterministic pricing.
 */

import express from "express";
import { handlePactRequest, ensureTranscriptDir } from "./pactHandler.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Middleware
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "llm-verifier-provider",
    version: "0.1.0",
    product: "llm.verify",
  });
});

// Pact protocol endpoint
app.post("/pact", async (req, res) => {
  try {
    // Ensure transcript directory exists
    ensureTranscriptDir();

    const request = req.body;
    const response = await handlePactRequest(request);

    res.json(response);
  } catch (error: any) {
    console.error("[Server] Error handling Pact request:", error.message);
    res.status(400).json({
      error: error.message || "Bad request",
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 LLM Verifier Provider Server`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Pact:   http://localhost:${PORT}/pact\n`);
});
