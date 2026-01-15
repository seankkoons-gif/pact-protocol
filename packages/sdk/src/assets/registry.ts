/**
 * Asset Registry (v2 Phase 2B)
 * 
 * Static registry of asset metadata. Default asset is USDC.
 * Canonical source of truth for supported assets in Phase 2.
 */

import type { AssetId, AssetMeta, ChainId } from "./types";

/**
 * Canonical list of supported assets for Phase 2
 */
export const SUPPORTED_ASSETS: readonly string[] = ["USDC", "USDT", "BTC", "ETH", "SOL"] as const;

/**
 * Check if an asset is supported (v2 Phase 2B)
 * 
 * @param asset - Asset symbol (case-insensitive)
 * @returns true if asset is supported
 */
export function isSupportedAsset(asset: string): boolean {
  if (!asset) return false;
  const normalized = asset.toUpperCase().trim();
  return SUPPORTED_ASSETS.includes(normalized as any);
}

/**
 * Normalize asset symbol to canonical form (v2 Phase 2B)
 * 
 * @param asset - Asset symbol (case-insensitive, may have whitespace)
 * @returns Canonical asset symbol or original if not supported
 */
export function normalizeAsset(asset: string): string {
  if (!asset) return "USDC"; // Default
  const normalized = asset.toUpperCase().trim();
  if (SUPPORTED_ASSETS.includes(normalized as any)) {
    return normalized;
  }
  // Return uppercase trimmed version even if not supported (for consistency)
  return normalized || "USDC";
}

/**
 * Infer chain for an asset (v2 Phase 2B)
 * 
 * @param asset - Asset symbol
 * @returns Chain identifier or "unknown"
 */
export function inferChainForAsset(asset: string): "evm" | "solana" | "bitcoin" | "unknown" {
  const normalized = normalizeAsset(asset);
  
  // EVM assets
  if (normalized === "ETH" || normalized === "USDC" || normalized === "USDT") {
    return "evm";
  }
  
  // Solana assets
  if (normalized === "SOL") {
    return "solana";
  }
  
  // Bitcoin
  if (normalized === "BTC") {
    return "bitcoin";
  }
  
  // Unknown
  return "unknown";
}

const ASSET_REGISTRY: Record<AssetId, AssetMeta> = {
  USDC: {
    asset_id: "USDC",
    decimals: 6,
    chain_id: "evm", // v2 Phase 2B: Changed from "solana" to "evm" to match inferChainForAsset
    symbol: "USDC",
  },
  USDT: {
    asset_id: "USDT",
    decimals: 6,
    chain_id: "evm", // v2 Phase 2B: Changed from "solana" to "evm" to match inferChainForAsset
    symbol: "USDT",
  },
  BTC: {
    asset_id: "BTC",
    decimals: 8,
    chain_id: "unknown",
    symbol: "BTC",
  },
  ETH: {
    asset_id: "ETH",
    decimals: 18,
    chain_id: "ethereum",
    symbol: "ETH",
  },
  SOL: {
    asset_id: "SOL",
    decimals: 9,
    chain_id: "solana",
    symbol: "SOL",
  },
  HYPE: {
    asset_id: "HYPE",
    decimals: 6,
    chain_id: "solana",
    symbol: "HYPE",
  },
  XRP: {
    asset_id: "XRP",
    decimals: 6,
    chain_id: "unknown",
    symbol: "XRP",
  },
};

const DEFAULT_ASSET_ID: AssetId = "USDC";

/**
 * Get asset metadata by asset ID.
 * Returns USDC metadata if asset_id is not provided or not found.
 * 
 * @param asset_id - Asset ID (defaults to "USDC")
 * @returns Asset metadata
 */
export function getAssetMeta(asset_id?: AssetId): AssetMeta {
  if (!asset_id) {
    return ASSET_REGISTRY[DEFAULT_ASSET_ID];
  }
  
  const meta = ASSET_REGISTRY[asset_id];
  if (!meta) {
    // Fallback to USDC if asset not found
    return ASSET_REGISTRY[DEFAULT_ASSET_ID];
  }
  
  return meta;
}

/**
 * Resolve asset metadata from symbol and optional chain.
 * Returns default USDC metadata if symbol not found or not provided.
 * 
 * @param symbol - Asset symbol (e.g., "USDC", "ETH", "SOL")
 * @param chain - Optional chain identifier (e.g., "ethereum", "solana")
 * @param decimals - Optional decimals override
 * @returns Asset metadata
 */
export function resolveAssetFromSymbol(symbol?: string, chain?: string, decimals?: number): AssetMeta {
  // Default to USDC if no symbol provided
  if (!symbol) {
    return ASSET_REGISTRY[DEFAULT_ASSET_ID];
  }
  
  // Try to find asset by symbol (case-insensitive)
  const symbolUpper = symbol.toUpperCase();
  const assetId = symbolUpper as AssetId;
  
  if (ASSET_REGISTRY[assetId]) {
    const meta = { ...ASSET_REGISTRY[assetId] };
    
    // Override chain if provided
    if (chain) {
      meta.chain_id = chain as ChainId;
    }
    
    // Override decimals if provided
    if (decimals !== undefined) {
      meta.decimals = decimals;
    }
    
    return meta;
  }
  
  // If symbol not found, create a synthetic asset metadata
  // This allows custom assets while maintaining backward compatibility
  const syntheticMeta: AssetMeta = {
    asset_id: DEFAULT_ASSET_ID, // Use USDC as fallback asset_id
    symbol: symbolUpper,
    decimals: decimals ?? 6, // Default to 6 decimals (USDC-like)
    chain_id: (chain as ChainId) || "unknown",
  };
  
  return syntheticMeta;
}

