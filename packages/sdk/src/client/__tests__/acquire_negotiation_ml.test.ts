import { describe, it, expect, afterEach } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import { acquire } from "../acquire";
import { createDefaultPolicy } from "../../policy/defaultPolicy";
import { MockSettlementProvider } from "../../settlement/mock";
import { ReceiptStore } from "../../reputation/store";
import { InMemoryProviderDirectory } from "../../directory/registry";
import { startProviderServer } from "@pact/provider-adapter";

describe("acquire with ML negotiation strategy", () => {
  const transcriptDir = path.join(process.env.TMPDIR || "/tmp", "pact-test-ml-negotiation");
  
  // Helper to create keypairs
  function createKeyPair() {
    const keyPair = nacl.sign.keyPair();
    const id = bs58.encode(Buffer.from(keyPair.publicKey));
    return { keyPair, id };
  }

  // Helper to create deterministic clock
  function createClock(startTime = 1000) {
    let now = startTime;
    return () => {
      const current = now;
      now += 1000;
      return current;
    };
  }

  afterEach(() => {
    // Clean up transcript directory
    if (fs.existsSync(transcriptDir)) {
      const files = fs.readdirSync(transcriptDir);
      for (const file of files) {
        fs.unlinkSync(path.join(transcriptDir, file));
      }
      fs.rmdirSync(transcriptDir);
    }
  });

  it("should produce transcript with negotiation.rounds and negotiation.ml populated", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    const settlement = new MockSettlementProvider();
    settlement.credit(buyer.id, 1.0);
    settlement.credit(seller.id, 0.1);
    const store = new ReceiptStore();
    const directory = new InMemoryProviderDirectory();
    
    // Add receipts to trigger negotiated regime (tradeCount >= 5)
    const intentType = "weather.data";
    for (let i = 0; i < 5; i++) {
      store.ingest({
        receipt_id: `receipt-${i}`,
        intent_id: `intent-${i}`,
        intent_type: intentType,
        buyer_agent_id: buyer.id,
        seller_agent_id: seller.id,
        agreed_price: 0.0001,
        fulfilled: true,
        timestamp_ms: 1000 + i * 1000,
      });
    }
    
    // Start HTTP provider server
    const server = startProviderServer({
      port: 0,
      sellerKeyPair: seller.keyPair,
      sellerId: seller.id,
    });

    try {
      // Register provider with HTTP endpoint
      directory.registerProvider({
        provider_id: seller.id,
        intentType: intentType,
        pubkey_b58: seller.id,
        endpoint: server.url,
        credentials: [],
        baseline_latency_ms: 50,
      });

      const result = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          transcriptDir: transcriptDir,
          negotiation: {
            strategy: "ml_stub",
            params: {
              scorer: "stub",
              candidate_count: 3,
              max_rounds: 3,
            },
          },
        },
        buyerKeyPair: buyer.keyPair,
        sellerKeyPair: seller.keyPair,
        buyerId: buyer.id,
        sellerId: seller.id,
        policy,
        settlement,
        store: undefined, // Stateless run - no double-commit enforcement (determinism validation)
        directory,
        now: createClock(),
      });

      // Hard-fail if acquisition doesn't succeed
      if (!result.ok) {
        throw new Error(`Acquisition failed: ${result.code} - ${result.reason}`);
      }
      expect(result.ok).toBe(true);
      
      expect(result.transcriptPath).toBeDefined();
      const transcriptContent = fs.readFileSync(result.transcriptPath!, "utf-8");
      const transcript = JSON.parse(transcriptContent);
      
      // Verify negotiation block exists
      expect(transcript.negotiation).toBeDefined();
      expect(transcript.negotiation.strategy).toBe("ml_stub");
      
      // Verify negotiation rounds are recorded
      expect(transcript.negotiation_rounds).toBeDefined();
      expect(transcript.negotiation_rounds.length).toBeGreaterThan(0);
      
      // Verify ML metadata is populated
      expect(transcript.negotiation.ml).toBeDefined();
      expect(transcript.negotiation.ml.scorer).toBe("stub");
      expect(transcript.negotiation.ml.selected_candidate_idx).toBeDefined();
      expect(typeof transcript.negotiation.ml.selected_candidate_idx).toBe("number");
      
      // Verify top_scores are present
      expect(transcript.negotiation.ml.top_scores).toBeDefined();
      expect(Array.isArray(transcript.negotiation.ml.top_scores)).toBe(true);
      expect(transcript.negotiation.ml.top_scores.length).toBeGreaterThan(0);
      expect(transcript.negotiation.ml.top_scores.length).toBeLessThanOrEqual(3);
      
      // Verify top_scores structure
      for (const score of transcript.negotiation.ml.top_scores) {
        expect(score.idx).toBeDefined();
        expect(typeof score.idx).toBe("number");
        expect(score.score).toBeDefined();
        expect(typeof score.score).toBe("number");
        // reason is optional but if present should be a string
        if (score.reason !== undefined) {
          expect(typeof score.reason).toBe("string");
        }
      }
    } finally {
      server.close();
    }
  });

  it("should be deterministic: same input => same output", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    const settlement = new MockSettlementProvider();
    settlement.credit(buyer.id, 1.0);
    settlement.credit(seller.id, 0.1);
    const store = new ReceiptStore();
    const directory = new InMemoryProviderDirectory();
    
    // Add receipts to trigger negotiated regime
    const intentType = "weather.data";
    for (let i = 0; i < 5; i++) {
      store.ingest({
        receipt_id: `receipt-${i}`,
        intent_id: `intent-${i}`,
        intent_type: intentType,
        buyer_agent_id: buyer.id,
        seller_agent_id: seller.id,
        agreed_price: 0.0001,
        fulfilled: true,
        timestamp_ms: 1000 + i * 1000,
      });
    }
    
    // Start HTTP provider server
    const server = startProviderServer({
      port: 0,
      sellerKeyPair: seller.keyPair,
      sellerId: seller.id,
    });

    try {
      // Register provider
      directory.registerProvider({
        provider_id: seller.id,
        intentType: intentType,
        pubkey_b58: seller.id,
        endpoint: server.url,
        credentials: [],
        baseline_latency_ms: 50,
      });

      const clock1 = createClock(1000);
      const result1 = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          transcriptDir: transcriptDir,
          negotiation: {
            strategy: "ml_stub",
            params: {
              scorer: "stub",
              candidate_count: 3,
              max_rounds: 3,
            },
          },
        },
        buyerKeyPair: buyer.keyPair,
        sellerKeyPair: seller.keyPair,
        buyerId: buyer.id,
        sellerId: seller.id,
        policy,
        settlement,
        store: undefined, // Stateless run - no double-commit enforcement (determinism validation)
        directory,
        now: clock1,
      });

      expect(result1.ok).toBe(true);
      if (!result1.ok) {
        throw new Error(`First acquisition failed: ${result1.code} - ${result1.reason}`);
      }

      // Validate fingerprint stability (even without store)
      const { computeIntentFingerprint } = await import("../acquire");
      const fingerprint1 = computeIntentFingerprint({
        intent_type: intentType,
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        buyer_agent_id: buyer.id,
      });

      // Run again with same inputs
      const clock2 = createClock(1000);
      const result2 = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          transcriptDir: transcriptDir,
          negotiation: {
            strategy: "ml_stub",
            params: {
              scorer: "stub",
              candidate_count: 3,
              max_rounds: 3,
            },
          },
        },
        buyerKeyPair: buyer.keyPair,
        sellerKeyPair: seller.keyPair,
        buyerId: buyer.id,
        sellerId: seller.id,
        policy,
        settlement,
        store: undefined, // Stateless run - no double-commit enforcement (determinism validation)
        directory,
        now: clock2,
      });

      // Validate fingerprint stability - same inputs produce same fingerprint
      const fingerprint2 = computeIntentFingerprint({
        intent_type: intentType,
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        buyer_agent_id: buyer.id,
      });
      expect(fingerprint1).toBe(fingerprint2);

      expect(result2.ok).toBe(true);
      if (!result2.ok) {
        throw new Error(`Second acquisition failed: ${result2.code} - ${result2.reason}`);
      }

      // Verify determinism: final agreed_price should be identical
      expect(result1.receipt.agreed_price).toBe(result2.receipt.agreed_price);

      // Verify ML metadata is identical
      const transcript1Content = fs.readFileSync(result1.transcriptPath!, "utf-8");
      const transcript1 = JSON.parse(transcript1Content);
      const transcript2Content = fs.readFileSync(result2.transcriptPath!, "utf-8");
      const transcript2 = JSON.parse(transcript2Content);

      expect(transcript1.negotiation.ml.selected_candidate_idx).toBe(
        transcript2.negotiation.ml.selected_candidate_idx
      );

      // Verify top_scores are identical
      expect(transcript1.negotiation.ml.top_scores).toEqual(
        transcript2.negotiation.ml.top_scores
      );
    } finally {
      server.close();
    }
  });

  it("should enforce double-commit with store-backed determinism test", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    const settlement = new MockSettlementProvider();
    settlement.credit(buyer.id, 1.0);
    settlement.credit(seller.id, 0.1);
    const store = new ReceiptStore();
    const directory = new InMemoryProviderDirectory();
    
    // Same setup as the determinism test (identical inputs)
    const intentType = "weather.data";
    const server = startProviderServer({
      port: 0,
      sellerKeyPair: seller.keyPair,
      sellerId: seller.id,
    });

    try {
      directory.registerProvider({
        provider_id: seller.id,
        intentType: intentType,
        pubkey_b58: seller.id,
        endpoint: server.url,
        credentials: [],
        baseline_latency_ms: 50,
      });

      const clock1 = createClock(1000);
      const result1 = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          transcriptDir: transcriptDir,
          negotiation: {
            strategy: "ml_stub",
            params: {
              scorer: "stub",
              candidate_count: 3,
              max_rounds: 3,
            },
          },
        },
        buyerKeyPair: buyer.keyPair,
        sellerKeyPair: seller.keyPair,
        buyerId: buyer.id,
        sellerId: seller.id,
        policy,
        settlement,
        store, // Store-backed - should enforce double-commit
        directory,
        now: clock1,
      });

      expect(result1.ok).toBe(true);
      if (!result1.ok) {
        throw new Error(`First acquisition failed: ${result1.code} - ${result1.reason}`);
      }

      // Second run with identical inputs should fail with PACT-331
      const clock2 = createClock(1000);
      const result2 = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          transcriptDir: transcriptDir,
          negotiation: {
            strategy: "ml_stub",
            params: {
              scorer: "stub",
              candidate_count: 3,
              max_rounds: 3,
            },
          },
        },
        buyerKeyPair: buyer.keyPair,
        sellerKeyPair: seller.keyPair,
        buyerId: buyer.id,
        sellerId: seller.id,
        policy,
        settlement,
        store, // Same store - should enforce double-commit
        directory,
        now: clock2,
      });

      expect(result2.ok).toBe(false);
      expect(result2.code).toBe("PACT-331");
      expect(result2.reason).toContain("Double commit detected");
      expect(result2.reason).toContain("Prior transcript");
    } finally {
      server.close();
    }
  });

  it("should respect max_rounds=1 policy bound", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    const settlement = new MockSettlementProvider();
    settlement.credit(buyer.id, 1.0);
    settlement.credit(seller.id, 0.1);
    const store = new ReceiptStore();
    const directory = new InMemoryProviderDirectory();
    
    // Add receipts to trigger negotiated regime
    const intentType = "weather.data";
    for (let i = 0; i < 5; i++) {
      store.ingest({
        receipt_id: `receipt-${i}`,
        intent_id: `intent-${i}`,
        intent_type: intentType,
        buyer_agent_id: buyer.id,
        seller_agent_id: seller.id,
        agreed_price: 0.0001,
        fulfilled: true,
        timestamp_ms: 1000 + i * 1000,
      });
    }
    
    // Start HTTP provider server
    const server = startProviderServer({
      port: 0,
      sellerKeyPair: seller.keyPair,
      sellerId: seller.id,
    });

    try {
      // Register provider
      directory.registerProvider({
        provider_id: seller.id,
        intentType: intentType,
        pubkey_b58: seller.id,
        endpoint: server.url,
        credentials: [],
        baseline_latency_ms: 50,
      });

      const result = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          transcriptDir: transcriptDir,
          negotiation: {
            strategy: "ml_stub",
            params: {
              scorer: "stub",
              candidate_count: 3,
              max_rounds: 1, // Only 1 round
            },
          },
        },
        buyerKeyPair: buyer.keyPair,
        sellerKeyPair: seller.keyPair,
        buyerId: buyer.id,
        sellerId: seller.id,
        policy,
        settlement,
        store: undefined, // Stateless run - no double-commit enforcement (determinism validation)
        directory,
        now: createClock(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`Acquisition failed: ${result.code} - ${result.reason}`);
      }

      const transcriptContent = fs.readFileSync(result.transcriptPath!, "utf-8");
      const transcript = JSON.parse(transcriptContent);

      // Verify only 1 round was recorded
      expect(transcript.negotiation_rounds).toBeDefined();
      expect(transcript.negotiation_rounds.length).toBe(1);
      
      // Verify rounds_used is 1
      expect(transcript.negotiation.rounds_used).toBe(1);
    } finally {
      server.close();
    }
  });
});
