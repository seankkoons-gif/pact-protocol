/**
 * Asset Registry
 * 
 * Static registry of asset metadata. Default asset is USDC.
 */

import type { AssetId, AssetMeta } from "./types";

const ASSET_REGISTRY: Record<AssetId, AssetMeta> = {
  USDC: {
    asset_id: "USDC",
    decimals: 6,
    chain_id: "solana",
    symbol: "USDC",
  },
  USDT: {
    asset_id: "USDT",
    decimals: 6,
    chain_id: "solana",
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

