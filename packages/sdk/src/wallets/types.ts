/**
 * Wallet Adapter Types
 * 
 * Chain-agnostic interface for wallet adapters to enable future integrations with
 * MetaMask, Coinbase Wallet, Solana wallets, etc. This is a seam for wallet connectivity.
 */

/**
 * Chain identifier (e.g., "ethereum", "solana", "base", "polygon")
 */
export type Chain = string;

/**
 * Wallet address as a byte array (chain-agnostic representation)
 */
export type Address = Uint8Array;

/**
 * Address information with chain and value
 * Used by all wallet adapters to return address information
 */
export interface AddressInfo {
  chain: string;
  value: string; // Address value (hex for EVM, base58 for Solana, etc.)
}

/**
 * Public wallet information
 */
export interface WalletPublicInfo {
  chain: Chain;
  address: Address;
}

/**
 * Wallet connection result
 */
export interface WalletConnectResult {
  ok: boolean;
  address?: Address;
  chain?: Chain;
  error?: string;
}

/**
 * Wallet capabilities (v2 Phase 2+)
 * Describes what operations a wallet can perform
 */
export interface WalletCapabilities {
  chain: "solana" | "evm" | "unknown";
  can_sign_message: boolean;
  can_sign_transaction: boolean;
}

/**
 * Wallet action types (v2 Phase 2 Execution Layer)
 */
export type WalletActionType = "authorize" | "transfer" | "refund";

/**
 * Wallet action (v2 Phase 2 Execution Layer)
 * Normalized contract for wallet signing requests
 */
export interface WalletAction {
  action: WalletActionType;
  asset_symbol: string; // e.g., "USDC", "ETH", "SOL"
  amount: number;
  from: string; // Address (hex or base58)
  to: string; // Address (hex or base58)
  memo?: string; // Optional memo/note
  idempotency_key?: string; // Optional idempotency key for deduplication
}

/**
 * Wallet signature (v2 Phase 2 Execution Layer)
 * Result of signing a wallet action
 */
export interface WalletSignature {
  chain: string; // Chain identifier
  signer: string; // Public key/address of signer (hex or base58)
  signature: Uint8Array; // Raw signature bytes
  payload_hash: string; // Hash of the action payload (hex)
  scheme: string; // Signature scheme (e.g., "ed25519", "secp256k1", "eip191")
}

/**
 * Wallet capabilities response (v2 Phase 2 Execution Layer)
 */
export interface WalletCapabilitiesResponse {
  can_sign: boolean;
  chains: string[]; // Supported chains
  assets: string[]; // Supported asset symbols
}

/**
 * Chain-agnostic wallet adapter interface
 */
export interface WalletAdapter {
  /**
   * Get the chain this wallet is associated with.
   * 
   * @returns Chain identifier
   */
  getChain(): Chain;

  /**
   * Get the wallet address (async, no network call).
   * 
   * @returns Promise resolving to address info with chain and value
   */
  getAddress(): Promise<AddressInfo>;

  /**
   * Connect to the wallet (v2 Phase 2 Execution Layer).
   * 
   * @returns Promise resolving to void (throws on failure)
   */
  connect(): Promise<void>;

  /**
   * Get wallet capabilities (v2 Phase 2 Execution Layer).
   * 
   * @returns Wallet capabilities including supported chains and assets
   */
  capabilities(): WalletCapabilitiesResponse;

  /**
   * Sign a message using the connected wallet.
   * 
   * @param message - Message to sign as Uint8Array
   * @returns Promise resolving to signature as Uint8Array
   */
  signMessage(message: Uint8Array): Promise<Uint8Array>;

  /**
   * Sign a transaction (optional).
   * 
   * @param txBytes - Transaction bytes as Uint8Array
   * @returns Promise resolving to signed transaction bytes as Uint8Array
   */
  signTransaction?(txBytes: Uint8Array): Promise<Uint8Array>;

  /**
   * Get balance for a specific asset.
   * Optional - can be a stub that returns 0.
   * 
   * @param asset_id - Asset ID (e.g., "USDC", "ETH")
   * @returns Promise resolving to balance amount
   */
  getBalance?(asset_id: string): Promise<number>;

  /**
   * Get wallet capabilities (v2 Phase 2+).
   * Optional - if not implemented, defaults to unknown chain with no capabilities.
   * 
   * @returns Wallet capabilities describing what operations are supported
   * @deprecated Use capabilities() instead (v2 Phase 2 Execution Layer)
   */
  getCapabilities?(): WalletCapabilities;

  /**
   * Sign a wallet action (v2 Phase 2 Execution Layer).
   * Only available if capabilities().can_sign is true.
   * 
   * @param action - Wallet action to sign
   * @returns Promise resolving to wallet signature
   */
  sign?(action: WalletAction): Promise<WalletSignature>;

  /**
   * Verify a wallet signature (v2 Phase 2 Execution Layer).
   * Optional - if not implemented, verification is skipped.
   * 
   * @param signature - Wallet signature to verify
   * @param action - Original wallet action
   * @returns true if signature is valid, false otherwise
   */
  verify?(signature: WalletSignature, action: WalletAction): boolean;
}

