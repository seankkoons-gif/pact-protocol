import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as fs from "fs";
import { acquire } from "../acquire";
import { createDefaultPolicy } from "../../policy/defaultPolicy";
import { MockSettlementProvider } from "../../settlement/mock";
import { ReceiptStore } from "../../reputation/store";
import { InMemoryProviderDirectory } from "../../directory/registry";
import { startProviderServer } from "@pact/provider-adapter";

describe("acquire with negotiation strategy switching", () => {
  // Helper to create keypairs
  function createKeyPair() {
    const keyPair = nacl.sign.keyPair();
    const id = bs58.encode(Buffer.from(keyPair.publicKey));
    return { keyPair, id };
  }

  // Helper to create deterministic clock
  function createClock() {
    let now = 1000;
    return () => {
      const current = now;
      now += 1000;
      return current;
    };
  }

  it("should use banded_concession and aggressive_if_urgent strategies correctly", async () => {
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

      // Run A: banded_concession
      const resultA = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          negotiation: {
            strategy: "banded_concession",
            params: {
              band_pct: 0.1,
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
      expect(resultA.ok).toBe(true);
      if (!resultA.ok) {
        throw new Error(`Acquisition A failed: ${resultA.code} - ${resultA.reason}`);
      }

      // Run B: aggressive_if_urgent + urgent=true
      const resultB = await acquire({
        input: {
          intentType: intentType,
          scope: "NYC",
          constraints: { latency_ms: 50, freshness_sec: 10 },
          maxPrice: 0.0002,
          saveTranscript: true,
          urgent: true,
          negotiation: {
            strategy: "aggressive_if_urgent",
            params: {
              band_pct: 0.1,
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
      expect(resultB.ok).toBe(true);
      if (!resultB.ok) {
        throw new Error(`Acquisition B failed: ${resultB.code} - ${resultB.reason}`);
      }

      // Verify transcripts record strategy
      expect(resultA.transcriptPath).toBeDefined();
      const transcriptA = JSON.parse(fs.readFileSync(resultA.transcriptPath!, "utf-8"));
      expect(transcriptA.negotiation?.strategy).toBe("banded_concession");
      
      if (transcriptA.negotiation_rounds && transcriptA.negotiation_rounds.length > 0) {
        // Verify strategy_id is recorded
        const firstRound = transcriptA.negotiation_rounds[0];
        expect(firstRound.strategy_id).toBe("banded_concession");
      }

      expect(resultB.transcriptPath).toBeDefined();
      const transcriptB = JSON.parse(fs.readFileSync(resultB.transcriptPath!, "utf-8"));
      expect(transcriptB.negotiation?.strategy).toBe("aggressive_if_urgent");
      
      if (transcriptB.negotiation_rounds && transcriptB.negotiation_rounds.length > 0) {
        // Verify strategy_id is recorded
        const firstRound = transcriptB.negotiation_rounds[0];
        expect(firstRound.strategy_id).toBe("aggressive_if_urgent");
        
        // Verify aggressive settles in <= rounds than banded (or has higher counter early)
        if (transcriptA.negotiation_rounds && transcriptA.negotiation_rounds.length > 0) {
          const aggressiveRounds = transcriptB.negotiation_rounds.length;
          const bandedRounds = transcriptA.negotiation_rounds.length;
          
          // Aggressive should settle in <= rounds, or have higher counter in early rounds
          if (aggressiveRounds <= bandedRounds) {
            // Settled faster or same speed
            expect(aggressiveRounds).toBeLessThanOrEqual(bandedRounds);
          } else {
            // If it took more rounds, check that early rounds had higher counters
            const aggressiveRound1 = transcriptB.negotiation_rounds[0];
            const bandedRound1 = transcriptA.negotiation_rounds[0];
            if (aggressiveRound1 && bandedRound1) {
              expect(aggressiveRound1.counter_price).toBeGreaterThanOrEqual(bandedRound1.counter_price);
            }
          }
        }
      }
    } finally {
      server.close();
    }
  });
});

