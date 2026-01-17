/**
 * Express Provider Server
 * 
 * Minimal Express server demonstrating a Pact-compatible provider service.
 * Shows how easy it is to expose a provider endpoint using @pact/sdk.
 */

import express from "express";
import { handlePactRequest } from "./pactHandler.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Middleware
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    ok: true, 
    service: "pact-express-provider",
    version: "1.0.0"
  });
});

// Pact protocol endpoint
app.post("/pact", async (req, res) => {
  try {
    const request = req.body;
    const response = await handlePactRequest(request);
    res.json(response);
  } catch (error: any) {
    console.error("[Server] Error handling Pact request:", error.message);
    res.status(400).json({ 
      error: error.message || "Bad request" 
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Pact Provider Server`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Pact:   http://localhost:${PORT}/pact\n`);
});
