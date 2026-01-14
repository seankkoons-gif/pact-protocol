/**
 * Asset Types
 * 
 * Types for asset abstraction (USDC, ETH, etc.) to support multi-asset pricing
 * and settlement without breaking existing behavior.
 */

export type AssetId = "USDC" | "USDT" | "BTC" | "ETH" | "SOL" | "HYPE" | "XRP";

export type ChainId = "solana" | "ethereum" | "base" | "polygon" | "arbitrum" | "unknown";

export interface AssetMeta {
  asset_id: AssetId;
  decimals: number;
  chain_id?: ChainId;
  symbol: string;
}

