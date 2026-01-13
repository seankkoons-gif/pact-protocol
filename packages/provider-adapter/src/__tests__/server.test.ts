import { describe, it, expect, afterEach } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { startProviderServer } from "../server";
import { verifyEnvelope } from "@pact/sdk";
import type { ProviderQuoteRequest, CommitRequest, RevealRequest, StreamChunkRequest } from "../types";

describe("Provider Server", () => {
  let server: { url: string; close(): void } | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("should start server on random port", () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    expect(server.url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  });

  it("should handle GET /health", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Test mode field
    });
    
    const response = await fetch(`${server.url}/health`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.sellerId).toBe(sellerId);
    expect(data.seller_pubkey_b58).toBe(sellerId);
    expect(data.mode).toBe("ephemeral"); // H2: Verify mode field
  });

  it("should handle POST /quote and return signed ASK envelope", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const quoteReq: ProviderQuoteRequest = {
      intent_id: "test-intent-1",
      intent_type: "weather.data",
      max_price: 0.0001,
      constraints: {
        latency_ms: 50,
        freshness_sec: 10,
      },
      urgent: false,
    };
    
    const response = await fetch(`${server.url}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quoteReq),
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope).toBeDefined();
    expect(data.envelope.envelope_version).toBe("pact-envelope/1.0");
    expect(data.envelope.message.type).toBe("ASK");
    expect(data.envelope.signer_public_key_b58).toBe(sellerId);
    
    // Verify envelope signature
    const isValid = verifyEnvelope(data.envelope);
    expect(isValid).toBe(true);
    
    // Check ASK message content
    expect(data.envelope.message.price).toBeLessThanOrEqual(quoteReq.max_price);
    expect(data.envelope.message.valid_for_ms).toBe(20000);
    expect(data.envelope.message.unit).toBe("request");
  });

  it("should handle POST /quote with urgent premium", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const quoteReq: ProviderQuoteRequest = {
      intent_id: "test-intent-2",
      intent_type: "weather.data",
      max_price: 0.0001,
      constraints: {
        latency_ms: 50,
        freshness_sec: 10,
      },
      urgent: true,
    };
    
    const response = await fetch(`${server.url}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quoteReq),
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope).toBeDefined();
    expect(verifyEnvelope(data.envelope)).toBe(true);
    // Urgent should add 10% premium
    expect(data.envelope.message.price).toBeGreaterThan(0.00008);
    expect(data.envelope.message.price).toBeLessThanOrEqual(quoteReq.max_price);
  });

  it("should handle POST /commit and return signed COMMIT envelope", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    
    const commitReq: CommitRequest = {
      intent_id: "test-intent-3",
      payload_b64: payloadB64,
      nonce_b64: nonceB64,
    };
    
    const response = await fetch(`${server.url}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitReq),
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope).toBeDefined();
    expect(data.envelope.envelope_version).toBe("pact-envelope/1.0");
    expect(data.envelope.message.type).toBe("COMMIT");
    expect(data.envelope.signer_public_key_b58).toBe(sellerId);
    expect(data.envelope.message.commit_hash_hex).toBeDefined();
    expect(data.envelope.message.commit_hash_hex.length).toBe(64); // SHA256 hex length
    
    // Verify envelope signature
    const isValid = verifyEnvelope(data.envelope);
    expect(isValid).toBe(true);
  });

  it("should handle POST /reveal with matching hash (ok: true)", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    
    // First get commit envelope
    const commitReq: CommitRequest = {
      intent_id: "test-intent-4",
      payload_b64: payloadB64,
      nonce_b64: nonceB64,
    };
    
    const commitResponse = await fetch(`${server.url}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitReq),
    });
    const commitData = await commitResponse.json();
    
    // Now reveal with matching hash
    const revealReq: RevealRequest = {
      intent_id: "test-intent-4",
      payload_b64: payloadB64,
      nonce_b64: nonceB64,
      commit_hash_hex: commitData.envelope.message.commit_hash_hex,
    };
    
    const revealResponse = await fetch(`${server.url}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(revealReq),
    });
    
    expect(revealResponse.ok).toBe(true);
    const revealData = await revealResponse.json();
    expect(revealData.envelope).toBeDefined();
    expect(revealData.envelope.message.type).toBe("REVEAL");
    expect(revealData.envelope.signer_public_key_b58).toBe(sellerId);
    expect(verifyEnvelope(revealData.envelope)).toBe(true);
    expect(revealData.ok).toBe(true);
  });

  it("should handle POST /reveal with wrong payload (FAILED_PROOF) and still return signed envelope", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    const wrongPayloadB64 = Buffer.from("wrong payload").toString("base64");
    
    // Get commit envelope for correct payload
    const commitReq: CommitRequest = {
      intent_id: "test-intent-5",
      payload_b64: payloadB64,
      nonce_b64: nonceB64,
    };
    
    const commitResponse = await fetch(`${server.url}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitReq),
    });
    const commitData = await commitResponse.json();
    
    // Reveal with wrong payload
    const revealReq: RevealRequest = {
      intent_id: "test-intent-5",
      payload_b64: wrongPayloadB64, // Wrong payload
      nonce_b64: nonceB64,
      commit_hash_hex: commitData.envelope.message.commit_hash_hex,
    };
    
    const revealResponse = await fetch(`${server.url}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(revealReq),
    });
    
    expect(revealResponse.ok).toBe(true);
    const revealData = await revealResponse.json();
    expect(revealData.envelope).toBeDefined();
    expect(revealData.envelope.message.type).toBe("REVEAL");
    expect(revealData.envelope.signer_public_key_b58).toBe(sellerId);
    // Envelope should still verify (it's properly signed)
    expect(verifyEnvelope(revealData.envelope)).toBe(true);
    // But ok should be false due to hash mismatch
    expect(revealData.ok).toBe(false);
    expect(revealData.code).toBe("FAILED_PROOF");
  });

  it("should handle POST /stream/chunk and return signed STREAM_CHUNK envelope", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const chunkReq: StreamChunkRequest = {
      intent_id: "test-intent-6",
      seq: 0,
    };
    
    const response = await fetch(`${server.url}/stream/chunk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunkReq),
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope).toBeDefined();
    expect(data.envelope.envelope_version).toBe("pact-envelope/1.0");
    expect(data.envelope.message.type).toBe("STREAM_CHUNK");
    expect(data.envelope.message.intent_id).toBe(chunkReq.intent_id);
    expect(data.envelope.message.seq).toBe(0);
    expect(data.envelope.signer_public_key_b58).toBe(sellerId);
    
    // Verify envelope signature
    expect(verifyEnvelope(data.envelope)).toBe(true);
  });

  it("should handle GET /credential and return signed credential envelope", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const response = await fetch(`${server.url}/credential?intent=weather.data`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope).toBeDefined();
    expect(data.envelope.envelope_version).toBe("pact-envelope/1.0");
    expect(data.envelope.signer_public_key_b58).toBe(sellerId);
    
    // Verify envelope signature
    const isValid = verifyEnvelope(data.envelope);
    expect(isValid).toBe(true);
    
    // Verify credential message structure
    const credentialMsg = data.envelope.message;
    expect(credentialMsg.protocol_version).toBe("pact/1.0");
    expect(credentialMsg.credential_version).toBe("1");
    expect(credentialMsg.provider_pubkey_b58).toBe(sellerId);
    expect(credentialMsg.capabilities).toBeDefined();
    expect(Array.isArray(credentialMsg.capabilities)).toBe(true);
    
    // Verify capability for weather.data
    const weatherCapability = credentialMsg.capabilities.find((cap: any) => cap.intentType === "weather.data");
    expect(weatherCapability).toBeDefined();
    expect(weatherCapability.modes).toContain("hash_reveal");
    expect(weatherCapability.modes).toContain("streaming");
  });

  it("should handle GET /credential and return signed credential envelope", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const response = await fetch(`${server.url}/credential?intent=weather.data`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope).toBeDefined();
    expect(data.envelope.envelope_version).toBe("pact-envelope/1.0");
    expect(data.envelope.signer_public_key_b58).toBe(sellerId);
    
    // Verify envelope signature
    const isValid = verifyEnvelope(data.envelope);
    expect(isValid).toBe(true);
    
    // Verify credential message structure
    const credentialMsg = data.envelope.message;
    expect(credentialMsg.protocol_version).toBe("pact/1.0");
    expect(credentialMsg.credential_version).toBe("1");
    expect(credentialMsg.provider_pubkey_b58).toBe(sellerId);
    expect(credentialMsg.capabilities).toBeDefined();
    expect(Array.isArray(credentialMsg.capabilities)).toBe(true);
    
    // Verify capability for weather.data
    const weatherCapability = credentialMsg.capabilities.find((cap: any) => cap.intentType === "weather.data");
    expect(weatherCapability).toBeDefined();
    expect(weatherCapability.modes).toContain("hash_reveal");
    expect(weatherCapability.modes).toContain("streaming");
  });

  it("should handle POST /stream/chunk with seq=1 and return deterministic chunk", async () => {
    const keyPair = nacl.sign.keyPair();
    const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));
    
    server = startProviderServer({
      port: 0,
      sellerKeyPair: keyPair,
      sellerId,
      mode: "ephemeral", // H2: Add mode for consistency
    });
    
    const chunkReq: StreamChunkRequest = {
      intent_id: "test-intent-7",
      seq: 1,
    };
    
    const response = await fetch(`${server.url}/stream/chunk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunkReq),
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.envelope.message.type).toBe("STREAM_CHUNK");
    expect(data.envelope.message.seq).toBe(1);
    expect(data.envelope.message.chunk_b64).toBeDefined();
    expect(verifyEnvelope(data.envelope)).toBe(true);
  });
});

