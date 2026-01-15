/**
 * Wallets Module
 * 
 * Provides chain-agnostic wallet adapter interface for future integrations with
 * MetaMask, Coinbase Wallet, Solana wallets, and other wallet providers.
 */

// Shared wallet types
export * from "./types";

// EthersWallet (EVM)
export { EthersWalletAdapter as EthersWallet, WALLET_CONNECT_FAILED, WALLET_SIGN_FAILED, WALLET_VERIFY_FAILED, ETHERS_WALLET_KIND, EVM_CHAIN } from "./ethers";
export type { EthersWalletOptions } from "./ethers";

// SolanaWallet
export { SolanaWalletAdapter as SolanaWallet, SOLANA_WALLET_KIND, SOLANA_CHAIN, WALLET_CONNECT_FAILED as SOLANA_WALLET_CONNECT_FAILED, WALLET_SIGN_FAILED as SOLANA_WALLET_SIGN_FAILED, WALLET_VERIFY_FAILED as SOLANA_WALLET_VERIFY_FAILED } from "./solana";
export type { SolanaWalletOptions } from "./solana";

// MetaMask Wallet (v2 Phase 2A)
export { MetaMaskWalletAdapter as MetaMaskWallet, METAMASK_WALLET_KIND, WALLET_CONNECT_FAILED as METAMASK_WALLET_CONNECT_FAILED, WALLET_CAPABILITY_MISSING as METAMASK_WALLET_CAPABILITY_MISSING } from "./metamask";
export type { MetaMaskWalletOptions } from "./metamask";

// Coinbase Wallet (v2 Phase 2A)
export { CoinbaseWalletAdapter as CoinbaseWallet, COINBASE_WALLET_KIND, WALLET_CONNECT_FAILED as COINBASE_WALLET_CONNECT_FAILED, WALLET_CAPABILITY_MISSING as COINBASE_WALLET_CAPABILITY_MISSING } from "./coinbase_wallet";
export type { CoinbaseWalletOptions } from "./coinbase_wallet";

// Wallet proof utilities (v2 Phase 2+)
export { generateWalletProof, verifyWalletProof, extractAgentIdFromProof } from "./proof";
export type { WalletProof } from "./proof";

