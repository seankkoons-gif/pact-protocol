/**
 * Tests for wallet proof verification utilities (v2 Phase 2+)
 */

import { describe, it, expect } from "vitest";
import { generateWalletProof, verifyWalletProof, extractAgentIdFromProof } from "../proof";
import { TestWalletAdapter } from "./test-adapter";
import { EthersWalletAdapter } from "../ethers";
import { SolanaWalletAdapter } from "../solana";

describe("generateWalletProof", () => {
  it("should generate a wallet proof with correct message format", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    
    const proof = await generateWalletProof(adapter, agentId);
    
    expect(proof.message).toContain("Pact Identity Binding");
    expect(proof.message).toContain(agentId);
    expect(proof.message).toMatch(/@ \d+$/);
    expect(proof.signer).toBe("test-address");
    expect(proof.chain).toBe("evm");
    expect(proof.scheme).toBe("eip191");
    expect(proof.signature).toBeInstanceOf(Uint8Array);
    expect(proof.signature.length).toBeGreaterThan(0);
  });

  it("should include timestamp in proof message", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    const timestamp = 1234567890;
    
    const proof = await generateWalletProof(adapter, agentId, timestamp);
    
    expect(proof.message).toBe(`Pact Identity Binding: ${agentId} @ ${timestamp}`);
  });

  it("should use ed25519 scheme for Solana wallets", async () => {
    const adapter = new TestWalletAdapter("solana-address", "solana");
    const agentId = "agent-456";
    
    const proof = await generateWalletProof(adapter, agentId);
    
    expect(proof.scheme).toBe("ed25519");
    expect(proof.chain).toBe("solana");
  });

  it("should generate proof with real EthersWalletAdapter", async () => {
    const FIXED_PRIVATE_KEY = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
    const adapter = new EthersWalletAdapter({ privateKey: FIXED_PRIVATE_KEY });
    await adapter.connect();
    const agentId = "agent-ethers-123";
    
    const proof = await generateWalletProof(adapter, agentId);
    
    expect(proof.message).toContain("Pact Identity Binding");
    expect(proof.message).toContain(agentId);
    expect(proof.message).toMatch(/@ \d+$/);
    expect(proof.chain).toBe("evm");
    expect(proof.scheme).toBe("eip191");
    expect(proof.signature).toBeInstanceOf(Uint8Array);
    expect(proof.signature.length).toBeGreaterThan(0);
    // Verify address is a valid hex address
    expect(proof.signer).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("should generate proof with real SolanaWalletAdapter", async () => {
    const FIXED_SEED = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]);
    const adapter = new SolanaWalletAdapter({ secretKey: FIXED_SEED });
    await adapter.connect();
    const agentId = "agent-solana-456";
    
    const proof = await generateWalletProof(adapter, agentId);
    
    expect(proof.message).toContain("Pact Identity Binding");
    expect(proof.message).toContain(agentId);
    expect(proof.message).toMatch(/@ \d+$/);
    expect(proof.chain).toBe("solana");
    expect(proof.scheme).toBe("ed25519");
    expect(proof.signature).toBeInstanceOf(Uint8Array);
    expect(proof.signature.length).toBeGreaterThan(0);
    // Verify address is a valid base58 string (Solana public key)
    expect(proof.signer).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe("verifyWalletProof", () => {
  it("should verify a valid wallet proof", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    
    const proof = await generateWalletProof(adapter, agentId);
    const isValid = await verifyWalletProof(proof, agentId, adapter);
    
    expect(isValid).toBe(true);
  });

  it("should reject proof with wrong agent_id", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    const wrongAgentId = "agent-456";
    
    const proof = await generateWalletProof(adapter, agentId);
    const isValid = await verifyWalletProof(proof, wrongAgentId, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should verify proof without adapter (basic validation)", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    
    const proof = await generateWalletProof(adapter, agentId);
    const isValid = await verifyWalletProof(proof, agentId);
    
    // Should pass basic validation (signature exists and message contains agent_id)
    expect(isValid).toBe(true);
  });

  it("should reject proof with invalid message format", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    
    const proof = await generateWalletProof(adapter, agentId);
    // Corrupt the message
    const invalidProof = { ...proof, message: "invalid message format" };
    
    const isValid = await verifyWalletProof(invalidProof, agentId, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should verify proof with real EthersWalletAdapter", async () => {
    const FIXED_PRIVATE_KEY = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
    const adapter = new EthersWalletAdapter({ privateKey: FIXED_PRIVATE_KEY });
    await adapter.connect();
    const agentId = "agent-ethers-verify";
    
    const proof = await generateWalletProof(adapter, agentId);
    const isValid = await verifyWalletProof(proof, agentId, adapter);
    
    expect(isValid).toBe(true);
  });

  it("should verify proof with real SolanaWalletAdapter", async () => {
    const FIXED_SEED = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]);
    const adapter = new SolanaWalletAdapter({ secretKey: FIXED_SEED });
    await adapter.connect();
    const agentId = "agent-solana-verify";
    
    const proof = await generateWalletProof(adapter, agentId);
    const isValid = await verifyWalletProof(proof, agentId, adapter);
    
    expect(isValid).toBe(true);
  });

  it("should reject proof with corrupted signature (EVM)", async () => {
    const FIXED_PRIVATE_KEY = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
    const adapter = new EthersWalletAdapter({ privateKey: FIXED_PRIVATE_KEY });
    await adapter.connect();
    const agentId = "agent-ethers-corrupt";
    
    const proof = await generateWalletProof(adapter, agentId);
    // Corrupt the signature by flipping bits
    const corruptedSignature = new Uint8Array(proof.signature);
    corruptedSignature[0] = corruptedSignature[0] ^ 0xFF; // Flip all bits in first byte
    const corruptedProof = { ...proof, signature: corruptedSignature };
    
    const isValid = await verifyWalletProof(corruptedProof, agentId, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should reject proof with corrupted signature (Solana)", async () => {
    const FIXED_SEED = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]);
    const adapter = new SolanaWalletAdapter({ secretKey: FIXED_SEED });
    await adapter.connect();
    const agentId = "agent-solana-corrupt";
    
    const proof = await generateWalletProof(adapter, agentId);
    // Corrupt the signature by flipping bits
    const corruptedSignature = new Uint8Array(proof.signature);
    corruptedSignature[0] = corruptedSignature[0] ^ 0xFF; // Flip all bits in first byte
    const corruptedProof = { ...proof, signature: corruptedSignature };
    
    const isValid = await verifyWalletProof(corruptedProof, agentId, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should reject proof with wrong signer address (EVM)", async () => {
    const FIXED_PRIVATE_KEY = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
    const adapter = new EthersWalletAdapter({ privateKey: FIXED_PRIVATE_KEY });
    await adapter.connect();
    const agentId = "agent-ethers-signer";
    
    const proof = await generateWalletProof(adapter, agentId);
    // Change the signer address to a different address
    const invalidProof = { ...proof, signer: "0x0000000000000000000000000000000000000000" };
    
    const isValid = await verifyWalletProof(invalidProof, agentId, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should reject proof with wrong signer address (Solana)", async () => {
    const FIXED_SEED = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]);
    const adapter = new SolanaWalletAdapter({ secretKey: FIXED_SEED });
    await adapter.connect();
    const agentId = "agent-solana-signer";
    
    const proof = await generateWalletProof(adapter, agentId);
    // Change the signer address to a different base58 address
    const invalidProof = { ...proof, signer: "11111111111111111111111111111111" };
    
    const isValid = await verifyWalletProof(invalidProof, agentId, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should reject proof with signature from different message (EVM)", async () => {
    const FIXED_PRIVATE_KEY = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
    const adapter = new EthersWalletAdapter({ privateKey: FIXED_PRIVATE_KEY });
    await adapter.connect();
    const agentId1 = "agent-ethers-msg1";
    const agentId2 = "agent-ethers-msg2";
    
    // Generate proof for agentId1
    const proof1 = await generateWalletProof(adapter, agentId1);
    // Try to verify with agentId2 but using proof1's signature
    const invalidProof = { ...proof1, message: proof1.message.replace(agentId1, agentId2) };
    
    const isValid = await verifyWalletProof(invalidProof, agentId2, adapter);
    
    expect(isValid).toBe(false);
  });

  it("should reject proof with signature from different message (Solana)", async () => {
    const FIXED_SEED = new Uint8Array([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
    ]);
    const adapter = new SolanaWalletAdapter({ secretKey: FIXED_SEED });
    await adapter.connect();
    const agentId1 = "agent-solana-msg1";
    const agentId2 = "agent-solana-msg2";
    
    // Generate proof for agentId1
    const proof1 = await generateWalletProof(adapter, agentId1);
    // Try to verify with agentId2 but using proof1's signature
    const invalidProof = { ...proof1, message: proof1.message.replace(agentId1, agentId2) };
    
    const isValid = await verifyWalletProof(invalidProof, agentId2, adapter);
    
    expect(isValid).toBe(false);
  });
});

describe("extractAgentIdFromProof", () => {
  it("should extract agent_id from proof message", async () => {
    const adapter = new TestWalletAdapter("test-address", "evm");
    const agentId = "agent-123";
    
    const proof = await generateWalletProof(adapter, agentId);
    const extracted = extractAgentIdFromProof(proof);
    
    expect(extracted).toBe(agentId);
  });

  it("should return undefined for invalid message format", () => {
    const invalidProof = {
      signature: new Uint8Array([1, 2, 3]),
      message: "invalid message format",
      scheme: "eip191",
      signer: "test-address",
      chain: "evm",
    };
    
    const extracted = extractAgentIdFromProof(invalidProof);
    
    expect(extracted).toBeUndefined();
  });
});

