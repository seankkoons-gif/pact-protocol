/**
 * Assets Module (v2 Phase 2B)
 * 
 * Provides asset abstraction for multi-asset pricing and settlement.
 * Canonical source of truth for supported assets.
 */

export * from "./types";
export { getAssetMeta, resolveAssetFromSymbol, SUPPORTED_ASSETS, isSupportedAsset, normalizeAsset, inferChainForAsset } from "./registry";

