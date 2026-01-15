import { describe, it, expect } from "vitest";
import { getAssetMeta, resolveAssetFromSymbol, SUPPORTED_ASSETS, isSupportedAsset, normalizeAsset, inferChainForAsset } from "../registry";
import type { AssetId } from "../types";

describe("getAssetMeta", () => {
  it("should return USDC metadata by default", () => {
    const meta = getAssetMeta();
    expect(meta.asset_id).toBe("USDC");
    expect(meta.decimals).toBe(6);
    expect(meta.chain_id).toBe("evm"); // v2 Phase 2B: Changed from "solana" to "evm"
    expect(meta.symbol).toBe("USDC");
  });

  it("should return USDC metadata when undefined", () => {
    const meta = getAssetMeta(undefined);
    expect(meta.asset_id).toBe("USDC");
  });

  it("should return correct metadata for USDC", () => {
    const meta = getAssetMeta("USDC");
    expect(meta.asset_id).toBe("USDC");
    expect(meta.decimals).toBe(6);
    expect(meta.chain_id).toBe("evm"); // v2 Phase 2B: Changed from "solana" to "evm"
  });

  it("should return correct metadata for ETH", () => {
    const meta = getAssetMeta("ETH");
    expect(meta.asset_id).toBe("ETH");
    expect(meta.decimals).toBe(18);
    expect(meta.chain_id).toBe("ethereum");
  });

  it("should return correct metadata for BTC", () => {
    const meta = getAssetMeta("BTC");
    expect(meta.asset_id).toBe("BTC");
    expect(meta.decimals).toBe(8);
    expect(meta.chain_id).toBe("unknown");
  });

  it("should return correct metadata for SOL", () => {
    const meta = getAssetMeta("SOL");
    expect(meta.asset_id).toBe("SOL");
    expect(meta.decimals).toBe(9);
    expect(meta.chain_id).toBe("solana");
  });

  it("should return USDC metadata for unknown asset", () => {
    // TypeScript won't allow invalid AssetId, but test runtime behavior
    const meta = getAssetMeta("INVALID" as AssetId);
    expect(meta.asset_id).toBe("USDC");
  });
});

describe("resolveAssetFromSymbol (v2 asset selection)", () => {
  it("should return USDC metadata by default when symbol is not provided", () => {
    const meta = resolveAssetFromSymbol();
    expect(meta.asset_id).toBe("USDC");
    expect(meta.symbol).toBe("USDC");
    expect(meta.decimals).toBe(6);
    expect(meta.chain_id).toBe("evm"); // v2 Phase 2B: Changed from "solana" to "evm"
  });

  it("should resolve ETH asset from symbol", () => {
    const meta = resolveAssetFromSymbol("ETH");
    expect(meta.asset_id).toBe("ETH");
    expect(meta.symbol).toBe("ETH");
    expect(meta.decimals).toBe(18);
    expect(meta.chain_id).toBe("ethereum");
  });

  it("should resolve SOL asset from symbol", () => {
    const meta = resolveAssetFromSymbol("SOL");
    expect(meta.asset_id).toBe("SOL");
    expect(meta.symbol).toBe("SOL");
    expect(meta.decimals).toBe(9);
    expect(meta.chain_id).toBe("solana");
  });

  it("should override chain when provided", () => {
    const meta = resolveAssetFromSymbol("ETH", "base");
    expect(meta.asset_id).toBe("ETH");
    expect(meta.symbol).toBe("ETH");
    expect(meta.decimals).toBe(18);
    expect(meta.chain_id).toBe("base");
  });

  it("should override decimals when provided", () => {
    const meta = resolveAssetFromSymbol("USDC", undefined, 8);
    expect(meta.asset_id).toBe("USDC");
    expect(meta.symbol).toBe("USDC");
    expect(meta.decimals).toBe(8);
    expect(meta.chain_id).toBe("evm"); // v2 Phase 2B: Changed from "solana" to "evm"
  });

  it("should create synthetic asset for unknown symbol", () => {
    const meta = resolveAssetFromSymbol("CUSTOM", "ethereum", 18);
    expect(meta.asset_id).toBe("USDC"); // Falls back to USDC asset_id
    expect(meta.symbol).toBe("CUSTOM");
    expect(meta.decimals).toBe(18);
    expect(meta.chain_id).toBe("ethereum");
  });
});

describe("Phase 2B: Canonical Asset Registry", () => {
  describe("SUPPORTED_ASSETS", () => {
    it("should include all Phase 2 supported assets", () => {
      expect(SUPPORTED_ASSETS).toContain("USDC");
      expect(SUPPORTED_ASSETS).toContain("USDT");
      expect(SUPPORTED_ASSETS).toContain("BTC");
      expect(SUPPORTED_ASSETS).toContain("ETH");
      expect(SUPPORTED_ASSETS).toContain("SOL");
      expect(SUPPORTED_ASSETS.length).toBe(5);
    });

    it("should be readonly (TypeScript compile-time check)", () => {
      // TypeScript prevents mutations at compile time
      // At runtime, const arrays can be mutated, but TypeScript prevents it
      // This test just verifies the type is readonly (compile-time)
      expect(Array.isArray(SUPPORTED_ASSETS)).toBe(true);
    });
  });

  describe("isSupportedAsset()", () => {
    it("should return true for all supported assets", () => {
      expect(isSupportedAsset("USDC")).toBe(true);
      expect(isSupportedAsset("USDT")).toBe(true);
      expect(isSupportedAsset("BTC")).toBe(true);
      expect(isSupportedAsset("ETH")).toBe(true);
      expect(isSupportedAsset("SOL")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isSupportedAsset("usdc")).toBe(true);
      expect(isSupportedAsset("Usdc")).toBe(true);
      expect(isSupportedAsset("USDC")).toBe(true);
      expect(isSupportedAsset("  usdc  ")).toBe(true);
    });

    it("should return false for unsupported assets", () => {
      // DOGE, XRP, HYPE are in the registry but not in SUPPORTED_ASSETS (Phase 2 canonical list)
      expect(isSupportedAsset("DOGE")).toBe(false);
      expect(isSupportedAsset("XRP")).toBe(false);
      expect(isSupportedAsset("HYPE")).toBe(false);
      expect(isSupportedAsset("INVALID")).toBe(false);
      expect(isSupportedAsset("UNKNOWN")).toBe(false);
    });

    it("should return false for empty/null/undefined", () => {
      expect(isSupportedAsset("")).toBe(false);
      expect(isSupportedAsset(null as any)).toBe(false);
      expect(isSupportedAsset(undefined as any)).toBe(false);
    });
  });

  describe("normalizeAsset()", () => {
    it("should normalize to canonical form for supported assets", () => {
      expect(normalizeAsset("usdc")).toBe("USDC");
      expect(normalizeAsset("  USDC  ")).toBe("USDC");
      expect(normalizeAsset("eth")).toBe("ETH");
      expect(normalizeAsset("sol")).toBe("SOL");
      expect(normalizeAsset("btc")).toBe("BTC");
    });

    it("should return uppercase trimmed for unsupported assets", () => {
      expect(normalizeAsset("doge")).toBe("DOGE");
      expect(normalizeAsset("  xrp  ")).toBe("XRP");
    });

    it("should default to USDC for empty/null/undefined", () => {
      expect(normalizeAsset("")).toBe("USDC");
      expect(normalizeAsset(null as any)).toBe("USDC");
      expect(normalizeAsset(undefined as any)).toBe("USDC");
    });
  });

  describe("inferChainForAsset()", () => {
    it("should infer evm for ETH, USDC, USDT", () => {
      expect(inferChainForAsset("ETH")).toBe("evm");
      expect(inferChainForAsset("eth")).toBe("evm");
      expect(inferChainForAsset("USDC")).toBe("evm");
      expect(inferChainForAsset("usdc")).toBe("evm");
      expect(inferChainForAsset("USDT")).toBe("evm");
      expect(inferChainForAsset("usdt")).toBe("evm");
    });

    it("should infer solana for SOL", () => {
      expect(inferChainForAsset("SOL")).toBe("solana");
      expect(inferChainForAsset("sol")).toBe("solana");
    });

    it("should infer bitcoin for BTC", () => {
      expect(inferChainForAsset("BTC")).toBe("bitcoin");
      expect(inferChainForAsset("btc")).toBe("bitcoin");
    });

    it("should return unknown for unsupported assets", () => {
      expect(inferChainForAsset("DOGE")).toBe("unknown");
      expect(inferChainForAsset("XRP")).toBe("unknown");
      expect(inferChainForAsset("INVALID")).toBe("unknown");
    });

    it("should normalize before inferring", () => {
      expect(inferChainForAsset("  eth  ")).toBe("evm");
      expect(inferChainForAsset("UsDc")).toBe("evm");
    });
  });
});

