/**
 * Cloudflare Worker - Stateless Pact Provider
 * 
 * This is a STATELESS provider: each request is independent and doesn't maintain
 * negotiation state between requests. In production, negotiation state would be
 * stored externally (Cloudflare KV, Durable Objects, or external database).
 */

import { handlePactRequest } from "./pactHandler.js";

export interface Env {
  // Cloudflare Worker environment bindings
  // Example: KV namespace for storing negotiation state
  // NEGOTIATIONS: KVNamespace;
}

/**
 * Standard fetch handler for Cloudflare Workers
 * 
 * Compatible with Web Standards - no Node.js APIs used.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle OPTIONS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "pact-cloudflare-worker" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pact protocol endpoint
    if (request.method === "POST" && new URL(request.url).pathname === "/pact") {
      try {
        const envelope = await request.json();
        const response = await handlePactRequest(envelope, env);
        
        return new Response(
          JSON.stringify(response),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("[Worker] Error:", error.message);
        return new Response(
          JSON.stringify({ error: error.message || "Bad request" }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400
          }
        );
      }
    }

    // 404 for other routes
    return new Response(
      JSON.stringify({ error: "Not found" }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404
      }
    );
  },
};
