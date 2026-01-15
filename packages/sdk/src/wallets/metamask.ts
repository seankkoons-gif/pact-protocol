/**
 * MetaMask Wallet Adapter
 * 
 * Browser wallet adapter for MetaMask.
 * Safe-by-default: requires injected provider for testing.
 * NEVER accesses window/document directly in Node tests.
 */

import type {
  WalletAdapter,
  Chain,
  AddressInfo,
  WalletCapabilitiesResponse,
  WalletAction,
  WalletSignature,
} from "./types";

export const METAMASK_WALLET_KIND = "metamask";
export const WALLET_CONNECT_FAILED = "WALLET_CONNECT_FAILED";
export const WALLET_CAPABILITY_MISSING = "WALLET_CAPABILITY_MISSING";

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Helper to hash wallet action for payload_hash
async function hashWalletAction(action: WalletAction): Promise<string> {
  const payload = JSON.stringify({
    action: action.action,
    asset_symbol: action.asset_symbol,
    amount: action.amount,
    from: action.from.toLowerCase(),
    to: action.to.toLowerCase(),
    memo: action.memo || "",
    idempotency_key: action.idempotency_key || "",
  });
  
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "0x" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface MetaMaskWalletOptions {
  /** Injected provider for testing (required in Node, optional in browser) */
  injected?: {
    kind: "metamask";
    address?: string; // Default: "0x1234567890123456789012345678901234567890"
    chain?: string; // Default: "evm"
    supported_assets?: string[]; // Default: ["ETH", "USDC", "USDT"]
    can_sign_message?: boolean; // Default: true
    can_sign_tx?: boolean; // Default: false
    balances?: Record<string, number>; // asset -> balance map
    signMessageImpl?: (msg: string) => Promise<{ signature: string; scheme: string }>;
    signTxImpl?: (bytes: Uint8Array) => Promise<{ signature: string; scheme: string }>;
  };
}

export class MetaMaskWalletAdapter implements WalletAdapter {
  private injected?: MetaMaskWalletOptions["injected"];
  private address?: string;
  private connected = false;
  public readonly kind = METAMASK_WALLET_KIND;
  private readonly chain: Chain;

  constructor(options: MetaMaskWalletOptions = {}) {
    this.injected = options.injected;
    
    // Set chain from injected or default to "evm"
    this.chain = (this.injected?.chain as Chain) || "evm";
  }

  getChain(): Chain {
    return this.chain;
  }

  async getAddress(): Promise<AddressInfo> {
    if (!this.connected || !this.address) {
      const error = new Error("Wallet not connected. Call connect() first.");
      (error as any).code = WALLET_CONNECT_FAILED;
      throw error;
    }

    return {
      chain: this.chain,
      value: this.address,
    };
  }

  async connect(): Promise<void> {
    // In Node/browser without injected provider, require injected for testing
    if (!this.injected) {
      // Check if we're in a browser environment (safe check without accessing window directly)
      // We use a try-catch to safely check for window without direct access
      let isBrowser = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isBrowser = typeof (globalThis as any).window !== "undefined";
      } catch {
        isBrowser = false;
      }

      if (!isBrowser) {
        const error = new Error("Browser wallet not available");
        (error as any).code = WALLET_CONNECT_FAILED;
        (error as any).reason = "Browser wallet not available";
        throw error;
      }

      // In browser, try to access window.ethereum (but this is for future real implementation)
      // For Phase 2A, we still require injected provider
      const error = new Error("Browser wallet not available");
      (error as any).code = WALLET_CONNECT_FAILED;
      (error as any).reason = "Browser wallet not available";
      throw error;
    }

    // Use injected provider
    this.address = this.injected.address || "0x1234567890123456789012345678901234567890";
    this.connected = true;
  }

  capabilities(): WalletCapabilitiesResponse {
    if (!this.injected) {
      return {
        can_sign: false,
        chains: [],
        assets: [],
      };
    }

    return {
      can_sign: this.injected.can_sign_message ?? true,
      chains: [this.chain, "evm", "ethereum", "base", "polygon", "arbitrum"],
      assets: this.injected.supported_assets || ["ETH", "USDC", "USDT"],
    };
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.connected) {
      const error = new Error("Wallet not connected. Call connect() first.");
      (error as any).code = WALLET_CONNECT_FAILED;
      throw error;
    }

    const caps = this.capabilities();
    if (!caps.can_sign || !(this.injected?.can_sign_message ?? true)) {
      const error = new Error("Wallet does not support message signing");
      (error as any).code = WALLET_CAPABILITY_MISSING;
      throw error;
    }

    // Use injected implementation if provided, otherwise generate deterministic signature
    if (this.injected?.signMessageImpl) {
      const messageStr = new TextDecoder().decode(message);
      const result = await this.injected.signMessageImpl(messageStr);
      return hexToBytes(result.signature);
    }

    // Fallback: return deterministic signature based on message hash
    // In real implementation, this would call window.ethereum.request({ method: "personal_sign", ... })
    const hashBuffer = await crypto.subtle.digest("SHA-256", message);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Return 65 bytes (standard ECDSA signature length)
    const sig = new Uint8Array(65);
    for (let i = 0; i < Math.min(32, hashArray.length); i++) {
      sig[i] = hashArray[i];
    }
    // Fill rest with deterministic pattern
    for (let i = 32; i < 65; i++) {
      sig[i] = hashArray[i % hashArray.length] || 0;
    }
    return sig;
  }

  async signTransaction(txBytes: Uint8Array): Promise<Uint8Array> {
    if (!this.connected) {
      const error = new Error("Wallet not connected. Call connect() first.");
      (error as any).code = WALLET_CONNECT_FAILED;
      throw error;
    }

    const canSignTx = this.injected?.can_sign_tx ?? false;
    if (!canSignTx) {
      const error = new Error("Wallet does not support transaction signing");
      (error as any).code = WALLET_CAPABILITY_MISSING;
      throw error;
    }

    // Use injected implementation if provided
    if (this.injected?.signTxImpl) {
      const result = await this.injected.signTxImpl(txBytes);
      return hexToBytes(result.signature);
    }

    // Fallback: return deterministic signature
    const hashBuffer = await crypto.subtle.digest("SHA-256", txBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sig = new Uint8Array(65);
    for (let i = 0; i < Math.min(32, hashArray.length); i++) {
      sig[i] = hashArray[i];
    }
    for (let i = 32; i < 65; i++) {
      sig[i] = hashArray[i % hashArray.length] || 0;
    }
    return sig;
  }

  async getBalance(asset_id: string): Promise<number> {
    if (!this.connected) {
      return 0;
    }

    // Use injected balances if available
    if (this.injected?.balances && this.injected.balances[asset_id] !== undefined) {
      return this.injected.balances[asset_id];
    }

    // Default: return 0
    return 0;
  }

  async sign(action: WalletAction): Promise<WalletSignature> {
    if (!this.connected || !this.address) {
      const error = new Error("Wallet not connected. Call connect() first.");
      (error as any).code = WALLET_CONNECT_FAILED;
      throw error;
    }

    const caps = this.capabilities();
    if (!caps.can_sign) {
      const error = new Error("Wallet does not support signing");
      (error as any).code = WALLET_CAPABILITY_MISSING;
      throw error;
    }

    // Create message from action
    const payload = JSON.stringify({
      action: action.action,
      asset_symbol: action.asset_symbol,
      amount: action.amount,
      from: action.from.toLowerCase(),
      to: action.to.toLowerCase(),
      memo: action.memo || "",
      idempotency_key: action.idempotency_key || "",
    });

    const messageBytes = new TextEncoder().encode(payload);
    const signature = await this.signMessage(messageBytes);
    const payloadHash = await hashWalletAction(action);

    return {
      chain: this.chain,
      signer: this.address.toLowerCase(),
      signature,
      payload_hash: payloadHash,
      scheme: "eip191",
    };
  }
}


