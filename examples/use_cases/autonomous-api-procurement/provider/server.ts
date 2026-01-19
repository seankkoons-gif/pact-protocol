#!/usr/bin/env tsx
/**
 * Autonomous API Procurement Provider Server
 * 
 * Simple HTTP server for testing buyer scripts.
 */

import * as http from "node:http";
import * as url from "node:url";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3010;
const PRICE = process.env.PRICE ? parseFloat(process.env.PRICE) : 0.04;
const DELAY_MS = process.env.DELAY_MS ? parseInt(process.env.DELAY_MS, 10) : 0;
const LATENCY_MS = process.env.LATENCY_MS ? parseInt(process.env.LATENCY_MS, 10) : 45;
const FRESHNESS_SECONDS = process.env.FRESHNESS_SECONDS ? parseInt(process.env.FRESHNESS_SECONDS, 10) : 10;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url || "/", true);
  const path = parsedUrl.pathname;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (path === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Quote endpoint
  if (path === "/quote" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            price: PRICE,
            latency_ms: LATENCY_MS,
            freshness_sec: FRESHNESS_SECONDS,
          })
        );
      }, DELAY_MS);
    });
    return;
  }

  // Deliver endpoint
  if (path === "/deliver" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      setTimeout(() => {
        const now = Date.now();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            temperature: 72,
            humidity: 65,
            city: "NYC",
            timestamp: now,
            freshness_sec: FRESHNESS_SECONDS,
          })
        );
      }, DELAY_MS);
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Autonomous API Procurement Provider");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log(`  Base URL: http://localhost:${PORT}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Price: $${PRICE}`);
  console.log(`  Latency: ${LATENCY_MS}ms`);
  console.log(`  Freshness: ${FRESHNESS_SECONDS}s`);
  console.log(`  Delay: ${DELAY_MS}ms\n`);
  console.log("  Endpoints:");
  console.log(`    GET  /health  -> {"ok":true}`);
  console.log(`    POST /quote   -> {price, latency_ms, freshness_sec}`);
  console.log(`    POST /deliver -> {temperature, humidity, city, timestamp, freshness_sec}\n`);
});
