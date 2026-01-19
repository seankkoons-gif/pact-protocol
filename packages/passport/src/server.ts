/**
 * Passport HTTP Server
 * 
 * Optional HTTP server for querying Passport scores.
 */

import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { queryPassport, requirePassport, type PassportQueryResponse } from "./query";
import type { PassportStorage } from "./storage";

export interface PassportServerOptions {
  port?: number; // 0 for random port
  storage: PassportStorage;
}

export interface PassportServer {
  url: string;
  port: number;
  close(): void;
}

/**
 * Start Passport HTTP server.
 */
export function startPassportServer(opts: PassportServerOptions): Promise<PassportServer> {
  const { port = 0, storage } = opts;

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "passport" }));
      return;
    }

    // GET /passport/:agent_id
    const match = req.url?.match(/^\/passport\/([^\/]+)$/);
    if (req.method === "GET" && match && req.url) {
      const agentId = match[1];
      const host = req.headers.host || "localhost";
      const url = new URL(req.url, `http://${host}`);

      // Parse optional as_of query parameter
      const asOfParam = url.searchParams.get("as_of");
      const asOf = asOfParam ? parseInt(asOfParam, 10) : undefined;

      if (isNaN(asOf || 0) && asOfParam) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid as_of parameter (must be timestamp)" }));
        return;
      }

      try {
        const result = queryPassport(storage, agentId, asOf);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message || "Internal server error" }));
      }
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise<PassportServer>((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://localhost:${actualPort}`;

      resolve({
        url,
        port: actualPort,
        close() {
          server.close();
        },
      });
    });
  });
}
