/**
 * Tests for Coinbase Wallet Adapter
 */

import { describe, it, expect } from "vitest";
import { CoinbaseWalletAdapter, WALLET_CONNECT_FAILED, WALLET_CAPABILITY_MISSING } from "../coinbase_wallet";

describe("CoinbaseWalletAdapter", () => {
  describe("connect()", () => {
    it("should fail to connect in Node environment without injected provider", async () => {
      const adapter = new CoinbaseWalletAdapter();
      
      await expect(adapter.connect()).rejects.toThrow();
      const error = await adapter.connect().catch(e => e);
      expect((error as any).code).toBe(WALLET_CONNECT_FAILED);
      expect((error as any).reason).toBe("Browser wallet not available");
    });

    it("should connect successfully with injected provider", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          chain: "evm",
        },
      });
      
      await adapter.connect();
      const address = await adapter.getAddress();
      expect(address.value).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
      expect(address.chain).toBe("evm");
    });

    it("should use default address if not provided in injected provider", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      await adapter.connect();
      const address = await adapter.getAddress();
      expect(address.value).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    });
  });

  describe("getAddress()", () => {
    it("should throw if not connected", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      await expect(adapter.getAddress()).rejects.toThrow();
      const error = await adapter.getAddress().catch(e => e);
      expect((error as any).code).toBe(WALLET_CONNECT_FAILED);
    });

    it("should return address after successful connect", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          address: "0x1234567890123456789012345678901234567890",
        },
      });
      
      await adapter.connect();
      const address = await adapter.getAddress();
      expect(address.value).toBe("0x1234567890123456789012345678901234567890");
      expect(address.chain).toBe("evm");
    });
  });

  describe("capabilities()", () => {
    it("should return no capabilities when no injected provider", () => {
      const adapter = new CoinbaseWalletAdapter();
      const caps = adapter.capabilities();
      
      expect(caps.can_sign).toBe(false);
      expect(caps.chains).toEqual([]);
      expect(caps.assets).toEqual([]);
    });

    it("should return default capabilities with injected provider", () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      const caps = adapter.capabilities();
      
      expect(caps.can_sign).toBe(true); // Default can_sign_message is true
      expect(caps.chains).toContain("evm");
      expect(caps.assets).toEqual(["ETH", "USDC", "USDT"]);
    });

    it("should respect injected supported_assets", () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          supported_assets: ["ETH", "BTC"],
        },
      });
      const caps = adapter.capabilities();
      
      expect(caps.assets).toEqual(["ETH", "BTC"]);
    });

    it("should respect injected can_sign_message", () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          can_sign_message: false,
        },
      });
      const caps = adapter.capabilities();
      
      expect(caps.can_sign).toBe(false);
    });
  });

  describe("signMessage()", () => {
    it("should throw if not connected", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      const message = new TextEncoder().encode("test message");
      await expect(adapter.signMessage(message)).rejects.toThrow();
      const error = await adapter.signMessage(message).catch(e => e);
      expect((error as any).code).toBe(WALLET_CONNECT_FAILED);
    });

    it("should throw if capability missing", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          can_sign_message: false,
        },
      });
      
      await adapter.connect();
      const message = new TextEncoder().encode("test message");
      await expect(adapter.signMessage(message)).rejects.toThrow();
      const error = await adapter.signMessage(message).catch(e => e);
      expect((error as any).code).toBe(WALLET_CAPABILITY_MISSING);
    });

    it("should sign message with injected implementation", async () => {
      let capturedMessage = "";
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          signMessageImpl: async (msg: string) => {
            capturedMessage = msg;
            return { signature: "0x" + "cb".repeat(65), scheme: "eip191" };
          },
        },
      });
      
      await adapter.connect();
      const message = new TextEncoder().encode("test message");
      const signature = await adapter.signMessage(message);
      
      expect(capturedMessage).toBe("test message");
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(65);
    });

    it("should return deterministic signature if no injected impl", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      await adapter.connect();
      const message = new TextEncoder().encode("test message");
      const signature = await adapter.signMessage(message);
      
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(65);
      
      // Same message should produce same signature
      const signature2 = await adapter.signMessage(message);
      expect(signature).toEqual(signature2);
    });

    it("should produce different signature than MetaMask (differentiation test)", async () => {
      // Import MetaMask for comparison
      const { MetaMaskWalletAdapter } = await import("../metamask");
      const metamaskAdapter = new MetaMaskWalletAdapter({
        injected: {
          kind: "metamask",
        },
      });
      
      const coinbaseAdapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      await metamaskAdapter.connect();
      await coinbaseAdapter.connect();
      
      const message = new TextEncoder().encode("same message");
      const mmSig = await metamaskAdapter.signMessage(message);
      const cbSig = await coinbaseAdapter.signMessage(message);
      
      // Should be different (Coinbase uses XOR with 0xcb pattern)
      expect(mmSig).not.toEqual(cbSig);
    });
  });

  describe("signTransaction()", () => {
    it("should throw if capability missing", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          can_sign_tx: false, // Default is false
        },
      });
      
      await adapter.connect();
      const txBytes = new Uint8Array([1, 2, 3]);
      await expect(adapter.signTransaction(txBytes)).rejects.toThrow();
      const error = await adapter.signTransaction(txBytes).catch(e => e);
      expect((error as any).code).toBe(WALLET_CAPABILITY_MISSING);
    });

    it("should sign transaction when capability enabled", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          can_sign_tx: true,
        },
      });
      
      await adapter.connect();
      const txBytes = new Uint8Array([1, 2, 3]);
      const signature = await adapter.signTransaction(txBytes);
      
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(65);
    });
  });

  describe("getBalance()", () => {
    it("should return 0 if not connected", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      const balance = await adapter.getBalance("ETH");
      expect(balance).toBe(0);
    });

    it("should return injected balance if available", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          balances: {
            ETH: 2000,
            USDC: 10000,
          },
        },
      });
      
      await adapter.connect();
      const ethBalance = await adapter.getBalance("ETH");
      const usdcBalance = await adapter.getBalance("USDC");
      const btcBalance = await adapter.getBalance("BTC");
      
      expect(ethBalance).toBe(2000);
      expect(usdcBalance).toBe(10000);
      expect(btcBalance).toBe(0); // Not in balances map
    });
  });

  describe("sign()", () => {
    it("should sign wallet action", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      await adapter.connect();
      const action = {
        action: "authorize" as const,
        asset_symbol: "ETH",
        amount: 100,
        from: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        to: "0x1234567890123456789012345678901234567890",
      };
      
      const signature = await adapter.sign(action);
      
      expect(signature.chain).toBe("evm");
      expect(signature.signer).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
      expect(signature.signature).toBeInstanceOf(Uint8Array);
      expect(signature.signature.length).toBe(65);
      expect(signature.payload_hash).toMatch(/^0x[a-f0-9]{64}$/);
      expect(signature.scheme).toBe("eip191");
    });

    it("should throw if not connected", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      const action = {
        action: "authorize" as const,
        asset_symbol: "ETH",
        amount: 100,
        from: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        to: "0x1234567890123456789012345678901234567890",
      };
      
      await expect(adapter.sign(action)).rejects.toThrow();
    });

    it("should throw if capability missing", async () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          can_sign_message: false,
        },
      });
      
      await adapter.connect();
      const action = {
        action: "authorize" as const,
        asset_symbol: "ETH",
        amount: 100,
        from: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        to: "0x1234567890123456789012345678901234567890",
      };
      
      await expect(adapter.sign(action)).rejects.toThrow();
      const error = await adapter.sign(action).catch(e => e);
      expect((error as any).code).toBe(WALLET_CAPABILITY_MISSING);
    });
  });

  describe("getChain()", () => {
    it("should return chain from injected provider", () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
          chain: "base",
        },
      });
      
      expect(adapter.getChain()).toBe("base");
    });

    it("should default to evm if no chain specified", () => {
      const adapter = new CoinbaseWalletAdapter({
        injected: {
          kind: "coinbase_wallet",
        },
      });
      
      expect(adapter.getChain()).toBe("evm");
    });
  });
});


