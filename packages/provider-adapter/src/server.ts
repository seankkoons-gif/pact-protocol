/**
 * Provider Server
 * 
 * Identity Loading:
 * - Supports loading keypairs from env vars (PACT_PROVIDER_SECRET_KEY_B58),
 *   keypair files (PACT_PROVIDER_KEYPAIR_FILE), or explicit dev seed
 *   (PACT_DEV_IDENTITY_SEED).
 * - Falls back to ephemeral keypairs if no identity is configured.
 * - Only prints DEV-ONLY warning when deterministic dev seed is used.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Keypair } from "@pact/sdk";
import { handleQuote, handleCommit, handleReveal, handleStreamChunk } from "./handlers";
import type {
  ProviderQuoteRequest,
  CommitRequest,
  RevealRequest,
  StreamChunkRequest,
} from "./types";

export interface ProviderServerOptions {
  port?: number; // 0 for random port
  sellerKeyPair: Keypair;
  sellerId: string; // pubkey b58
  baseline_latency_ms?: number;
  mode?: "env-secret-key" | "keypair-file" | "dev-seed" | "ephemeral"; // H2: Identity mode
}

export interface ProviderServer {
  url: string;
  close(): void;
}

export function startProviderServer(
  opts: ProviderServerOptions
): ProviderServer {
  const { port = 0, sellerId, sellerKeyPair, mode } = opts;
  
  // Create deterministic clock function
  let now = 1000;
  const nowMs = () => {
    const current = now;
    now += 1000;
    return current;
  };

  const server = http.createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // Health check (H2)
      if (req.method === "GET" && req.url === "/health") {
        const sellerPubkeyB58 = sellerId; // sellerId is already pubkey b58
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          ok: true, 
          sellerId, 
          seller_pubkey_b58: sellerPubkeyB58,
          mode: mode || "ephemeral" // H2: Include identity mode
        }));
        return;
      }

      // Credential endpoint (GET)
      if (req.method === "GET" && req.url?.startsWith("/credential")) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const intent = url.searchParams.get("intent") || undefined;
        
        // Default capabilities (can be extended via env/config)
        const capabilities = [
          {
            intentType: "weather.data",
            modes: ["hash_reveal", "streaming"] as ("hash_reveal" | "streaming")[],
            region: "us-east",
            credentials: ["sla_verified"],
          },
        ];
        
        const credentialReq = { intent };
        const { handleCredential } = await import("./handlers");
        const response = await handleCredential(credentialReq, sellerKeyPair, sellerId, nowMs, capabilities);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
        return;
      }

      // All other routes require POST
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          if (req.url === "/quote") {
            const quoteReq: ProviderQuoteRequest = JSON.parse(body);
            const response = await handleQuote(quoteReq, sellerKeyPair, nowMs);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } else if (req.url === "/commit") {
            const commitReq: CommitRequest = JSON.parse(body);
            const response = await handleCommit(commitReq, sellerKeyPair, nowMs);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } else if (req.url === "/reveal") {
            const revealReq: RevealRequest = JSON.parse(body);
            const response = await handleReveal(revealReq, sellerKeyPair, nowMs);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } else if (req.url === "/stream/chunk") {
            const chunkReq: StreamChunkRequest = JSON.parse(body);
            const response = await handleStreamChunk(chunkReq, sellerKeyPair, nowMs);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
          }
        } catch (error: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: error.message || "Bad request",
            })
          );
        }
      });
    }
  );

  server.listen(port, () => {
    // Server started
  });

  // Use the port we know directly - this avoids the timing issue
  // Only fall back to address() if port was 0 (random port)
  const actualPort = port !== 0 ? port : (server.address() as { port: number } | null)?.port;

  if (actualPort === undefined) {
    throw new Error("Failed to get server port. If using random port (0), ensure server has started.");
  }

  const url = `http://127.0.0.1:${actualPort}`;

  return {
    url,
    close() {
      server.close();
    },
  };
}

// Main entry point when run directly
if (process.argv[1]?.includes("server.ts")) {
  const minimist = await import("minimist");
  const { loadProviderKeypair } = await import("./keypair");
  
  const raw = process.argv.slice(2).filter((x) => x !== "--");
  const args = minimist.default(raw, {
    alias: { p: "port" },
  });

  const port = typeof args.port === "number" ? args.port : (args.port ? parseInt(String(args.port), 10) : 7777);
  
  // Load keypair using precedence: env secret > keypair file > dev seed (opt-in) > ephemeral
  const { keypair, sellerId, mode, warning } = await loadProviderKeypair();

  const server = startProviderServer({
    port,
    sellerKeyPair: keypair,
    sellerId,
    mode, // H2: Pass identity mode
  });

  const url = server.url;
  console.log(`[Provider Server] sellerId: ${sellerId}`);
  console.log(`[Provider Server] Started on ${url}`);
  console.log(`[Provider Server] Identity mode: ${mode}`);
  if (warning) {
    console.log(`[Provider Server] ${warning}`);
  }
  console.log(`[Provider Server] Press Ctrl+C to stop`);
}

