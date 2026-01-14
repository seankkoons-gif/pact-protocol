import { describe, it, expect } from "vitest";
import { getAssetMeta } from "../registry";
import type { AssetId } from "../types";

describe("getAssetMeta", () => {
  it("should return USDC metadata by default", () => {
    const meta = getAssetMeta();
    expect(meta.asset_id).toBe("USDC");
    expect(meta.decimals).toBe(6);
    expect(meta.chain_id).toBe("solana");
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
    expect(meta.chain_id).toBe("solana");
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

