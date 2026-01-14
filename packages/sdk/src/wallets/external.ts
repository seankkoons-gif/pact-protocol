/**
 * External Wallet Adapter
 * 
 * Placeholder adapter for external wallet providers.
 * Throws unless properly configured with a real wallet implementation.
 */

import type { WalletAdapter, Chain, Address, WalletConnectResult, WalletCapabilities, WalletAction, WalletSignature, WalletCapabilitiesResponse, AddressInfo } from "./types";

export class ExternalWalletAdapter implements WalletAdapter {
  private params?: Record<string, unknown>;
  public readonly kind = "external";
  public readonly chain: Chain;
  private address?: Address;

  constructor(params?: Record<string, unknown>) {
    this.params = params;
    // Default to ethereum chain if not specified
    this.chain = (params?.chain as Chain) || "ethereum";
  }

  getChain(): Chain {
    return this.chain;
  }

  async getAddress(): Promise<AddressInfo> {
    if (!this.address) {
      throw new Error("Wallet not connected. Call connect() first.");
    }
    // Convert Address (Uint8Array) to hex string
    const addressHex = "0x" + Array.from(this.address)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    return {
      chain: this.chain,
      value: addressHex,
    };
  }

  /**
   * Connect to the wallet (v2 Phase 2 Execution Layer).
   * 
   * @returns Promise resolving to void (throws on failure)
   */
  async connect(): Promise<void> {
    // External wallet adapter requires configuration
    // In a real implementation, this would connect to MetaMask, Coinbase Wallet, etc.
    if (!this.params || !this.params.provider) {
      throw new Error("External wallet adapter not configured. Provide 'provider' in params.");
    }

    // Placeholder: would connect to actual wallet provider
    throw new Error(
      `External wallet adapter not implemented. Provider: ${this.params.provider}`
    );
  }

  /**
   * Connect to the wallet (legacy method for backward compatibility).
   * 
   * @returns Promise resolving to connection result with address and chain
   * @deprecated Use connect() instead (v2 Phase 2 Execution Layer)
   */
  async connectLegacy(): Promise<WalletConnectResult> {
    // External wallet adapter requires configuration
    // In a real implementation, this would connect to MetaMask, Coinbase Wallet, etc.
    if (!this.params || !this.params.provider) {
      return {
        ok: false,
        error: "External wallet adapter not configured. Provide 'provider' in params.",
      };
    }

    // Placeholder: would connect to actual wallet provider
    throw new Error(
      `External wallet adapter not implemented. Provider: ${this.params.provider}`
    );
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    throw new Error(
      "External wallet adapter not implemented. Cannot sign message."
    );
  }

  async getBalance(asset_id: string): Promise<number> {
    // Stub implementation - returns 0
    return 0;
  }

  /**
   * Get wallet capabilities (v2 Phase 2+).
   * ExternalWalletAdapter is a placeholder - no capabilities by default.
   * 
   * @returns Wallet capabilities (unknown chain, no signing capabilities)
   * @deprecated Use capabilities() instead (v2 Phase 2 Execution Layer)
   */
  getCapabilities(): WalletCapabilities {
    return {
      chain: "unknown",
      can_sign_message: false,
      can_sign_transaction: false,
    };
  }

  /**
   * Get wallet capabilities (v2 Phase 2 Execution Layer).
   * 
   * @returns Wallet capabilities including supported chains and assets
   */
  capabilities(): WalletCapabilitiesResponse {
    return {
      can_sign: false,
      chains: [],
      assets: [],
    };
  }
}

