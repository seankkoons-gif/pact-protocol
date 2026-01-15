/**
 * Asset Types
 * 
 * Types for asset abstraction (USDC, ETH, etc.) to support multi-asset pricing
 * and settlement without breaking existing behavior.
 */

export type AssetId = "USDC" | "USDT" | "BTC" | "ETH" | "SOL" | "HYPE" | "XRP";

export type ChainId = "solana" | "ethereum" | "evm" | "bitcoin" | "base" | "polygon" | "arbitrum" | "unknown"; // v2 Phase 2B+: Added "evm" and "bitcoin" for multi-asset support

export interface AssetMeta {
  asset_id: AssetId;
  decimals: number;
  chain_id?: ChainId;
  symbol: string;
}



