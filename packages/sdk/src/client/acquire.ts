import type { PactPolicy } from "../policy/types";
import type { SettlementProvider } from "../settlement/provider";
import type { Receipt } from "../exchange/receipt";
import type { AcquireInput, AcquireResult } from "./types";
import type { ExplainLevel, DecisionCode, ProviderDecision, AcquireExplain } from "./explain";
import { validatePolicyJson, compilePolicy, DefaultPolicyGuard } from "../policy/index";
import { EventRunner, isRetryableFailureCode, createEvidence } from "./event_runner";
import type { AcquisitionPhase } from "./events";
import { NegotiationSession } from "../engine/session";
import { signEnvelope } from "../protocol/envelope";
import { computeCommitHash } from "../exchange/commit";
import { StreamingExchange } from "../exchange/streaming";
import { createReceipt } from "../exchange/receipt";
import { priceStats, agentScore } from "../reputation/compute";
import { agentScoreV2, type AgentScoreV2Context } from "../reputation/scoreV2";
import { routeExecution } from "../router/route";
import type { ReceiptStore } from "../reputation/store";
import type { ProviderDirectory, ProviderRecord } from "../directory/types";
import type { NegotiationContext, IdentityContext } from "../policy/context";
import { fetchQuote, fetchCommit, fetchReveal, fetchStreamChunk, fetchCredential } from "../adapters/http/client";
import { verifyEnvelope, parseEnvelope } from "../protocol/envelope";
import type { SettlementMode, CommitMessage, RevealMessage } from "../protocol/types";
import type { SignedEnvelope } from "../protocol/envelope";
import type { TranscriptV1 } from "../transcript/types";
import { TranscriptStore } from "../transcript/store";
import { computeCredentialTrustScore } from "../kya/trust";
import { createSettlementProvider } from "../settlement/factory";
import { MockSettlementProvider } from "../settlement/mock";
import { selectSettlementProvider } from "../settlement/routing";
import { buildFallbackPlan, type ProviderCandidate } from "../settlement/fallback";
// Note: isRetryableFailure() has been replaced with isRetryableFailureCode() from event_runner
import type { NegotiationStrategy } from "../negotiation/strategy";
import { BaselineNegotiationStrategy } from "../negotiation/baseline";
import { BandedConcessionStrategy } from "../negotiation/banded_concession";
import { AggressiveIfUrgentStrategy } from "../negotiation/aggressive_if_urgent";
import { MLNegotiationStrategy } from "../negotiation/ml_strategy";
import type { NegotiationResult } from "../negotiation/types";
import type { WalletAdapter, WalletConnectResult, WalletCapabilities, WalletAction, WalletSignature, AddressInfo } from "../wallets/types";
import { ExternalWalletAdapter } from "../wallets/external";
import { EthersWallet, SOLANA_WALLET_KIND, SolanaWallet, METAMASK_WALLET_KIND, MetaMaskWallet, COINBASE_WALLET_KIND, CoinbaseWallet } from "../wallets/index";
import { convertZkKyaInputToProof } from "../kya/zk";
import { DefaultZkKyaVerifier, type ZkKyaVerifier } from "../kya/zk/verifier";
import type { ZkKyaVerificationResult } from "../kya/zk/types";
import { stableCanonicalize } from "../protocol/canonical";
import { createHash } from "node:crypto";
// Import test adapter only in test environment
// Use dynamic require to avoid issues in production builds
let TestWalletAdapter: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TestWalletAdapter = require("../wallets/__tests__/test-adapter")?.TestWalletAdapter;
} catch {
  // Test adapter not available (normal in production)
}

const round8 = (x: number) => Math.round(x * 1e8) / 1e8;

/**
 * Compute deterministic intent fingerprint for double-commit detection (PACT-331).
 * Fingerprint is stable across retries of the same economic intent.
 * Exported for test validation of fingerprint stability.
 */
export function computeIntentFingerprint(params: {
  intent_type: string;
  scope: string | object; // Accept string or object, normalize internally
  constraints: Record<string, unknown>;
  buyer_agent_id: string;
}): string {
  // Normalize scope to string (handle both string and object types)
  const normalizedScope = typeof params.scope === "string" 
    ? params.scope 
    : stableCanonicalize(params.scope);
  
  // Normalize constraints by sorting keys and using stable canonicalization
  const normalized = {
    intent_type: params.intent_type,
    scope: normalizedScope,
    constraints: params.constraints, // stableCanonicalize will handle sorting
    buyer_agent_id: params.buyer_agent_id,
  };
  const canonical = stableCanonicalize(normalized);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return hash;
}

export async function acquire(params: {
  input: AcquireInput;
  buyerKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
  sellerKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
  sellerKeyPairsByPubkeyB58?: Record<string, { publicKey: Uint8Array; secretKey: Uint8Array }>;
  buyerId: string;
  sellerId: string;
  policy: PactPolicy;
  settlement?: SettlementProvider; // Optional: if not provided, use routing or input.settlement.provider
  store?: ReceiptStore;
  directory?: ProviderDirectory;
  rfq?: {
    fanout?: number;
    maxCandidates?: number;
  };
  now?: () => number;
}): Promise<AcquireResult> {
  const { input, buyerKeyPair, sellerKeyPair, buyerId, sellerId, policy, settlement: explicitSettlement, store, directory, rfq, now: nowFn } = params;
  
  // Extract and normalize asset/chain (v2 Phase 2C)
  // Support new format: { symbol, chain, decimals }
  // Also support legacy format: { asset_id, chain_id } for backward compatibility
  const { resolveAssetFromSymbol, getAssetMeta, normalizeAsset, inferChainForAsset } = await import("../assets/registry");
  let assetMeta;
  // Support both new format (symbol) and legacy format (asset_id) for backward compatibility
  if (input.asset?.symbol) {
    // New format: { symbol, chain, decimals }
    assetMeta = resolveAssetFromSymbol(
      input.asset.symbol,
      input.asset.chain,
      input.asset.decimals
    );
  } else if (input.asset?.asset_id) {
    // Legacy format: { asset_id, chain_id } - convert to new format
    assetMeta = getAssetMeta(input.asset.asset_id);
    if (input.asset.chain_id) {
      assetMeta.chain_id = input.asset.chain_id;
    }
  } else {
    // No asset specified - use default
    assetMeta = resolveAssetFromSymbol();
  }
  
  // Normalize asset symbol and infer chain if not explicitly provided (v2 Phase 2C)
  const normalizedAssetSymbol = normalizeAsset(assetMeta.symbol);
  const normalizedChain = assetMeta.chain_id || inferChainForAsset(normalizedAssetSymbol);
  
  const assetId = assetMeta.asset_id;
  const chainId = normalizedChain; // Use normalized chain
  const assetSymbol = normalizedAssetSymbol; // Use normalized symbol
  const assetDecimals = assetMeta.decimals;
  
  // Wallet adapter connection (v2.3+)
  // All wallet adapters now have async getAddress() that returns AddressInfo with kind and chain properties
  let walletAdapter: any;
  let walletAddress: string | undefined;
  let walletKind: string | undefined;
  let walletChain: string | undefined;
  let walletCapabilities: WalletCapabilities | undefined;
  let walletSignature: WalletSignature | undefined;
  let walletCapabilitiesResponse: any; // WalletCapabilitiesResponse from capabilities() method
  
  // Transcript path (declared at function scope for accessibility)
  let transcriptPath: string | undefined;
  
  // Helper to convert Address (Uint8Array) to hex string
  const addressToHex = (address: Uint8Array): string => {
    return "0x" + Array.from(address)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  };
  
  if (input.wallet) {
    const walletProvider = input.wallet.provider ?? "external";
    
    // Create wallet adapter based on provider
    if (walletProvider === "test") {
      // Test-only provider for integration tests
      if (!TestWalletAdapter) {
        // Test adapter not available - try to load it dynamically using ESM import
        try {
          // Use dynamic import for ESM compatibility
          // Try with .js extension first (ESM requirement), fall back to no extension
          let testAdapterModule: any;
          try {
            testAdapterModule = await import("../wallets/__tests__/test-adapter.js");
          } catch (e1) {
            try {
              testAdapterModule = await import("../wallets/__tests__/test-adapter");
            } catch (e2) {
              throw e1; // Throw original error
            }
          }
          if (testAdapterModule && testAdapterModule.TestWalletAdapter) {
            TestWalletAdapter = testAdapterModule.TestWalletAdapter;
          } else {
            return {
              ok: false,
              code: "WALLET_CONNECT_FAILED",
              reason: "Test wallet adapter not available",
            };
          }
        } catch (e) {
          // Test adapter not available
          return {
            ok: false,
            code: "WALLET_CONNECT_FAILED",
            reason: `Test wallet adapter not available: ${(e as Error).message}`,
          };
        }
      }
      // TestWalletAdapter now takes hex string address and converts to Uint8Array internally
      const testAddress = (input.wallet.params?.address as string | undefined) || "0x1234567890123456789012345678901234567890";
      const testChain = (input.wallet.params?.chain_id as string | undefined) || "ethereum";
      walletAdapter = new TestWalletAdapter(testAddress, testChain);
      walletKind = "test";
    } else if (walletProvider === "ethers") {
      // Ethers wallet adapter
      try {
        const privateKey = input.wallet.params?.privateKey as string | undefined;
        const wallet = input.wallet.params?.wallet as any;
        
        if (wallet) {
          // Use provided wallet instance (synchronous)
          walletAdapter = new EthersWallet({ wallet });
        } else if (privateKey) {
          // Use factory method for private key (async, ESM-compatible)
          walletAdapter = await EthersWallet.create(privateKey);
        } else {
          return {
            ok: false,
            code: "WALLET_CONNECT_FAILED",
            reason: "EthersWallet requires either privateKey or wallet in params",
          };
        }
        walletKind = "ethers";
      } catch (error: any) {
        return {
          ok: false,
          code: "WALLET_CONNECT_FAILED",
          reason: error?.message || "Failed to create ethers wallet adapter",
        };
      }
    } else if (walletProvider === SOLANA_WALLET_KIND || (walletProvider as string) === "solana-keypair") {
      // Solana wallet adapter
      try {
        const secretKey = input.wallet.params?.secretKey as Uint8Array | undefined;
        const keypair = input.wallet.params?.keypair as any;
        
        if (keypair || secretKey) {
          walletAdapter = new SolanaWallet({ keypair, secretKey });
        } else {
          return {
            ok: false,
            code: "WALLET_CONNECT_FAILED",
            reason: "SolanaWallet requires keypair or secretKey in params",
          };
        }
        walletKind = SOLANA_WALLET_KIND;
      } catch (error: any) {
        return {
          ok: false,
          code: "WALLET_CONNECT_FAILED",
          reason: error?.message || "Failed to create Solana wallet adapter",
        };
      }
    } else if ((walletProvider as string) === METAMASK_WALLET_KIND || (walletProvider as string) === "metamask") {
      // MetaMask wallet adapter (v2 Phase 2A)
      try {
        const injected = input.wallet.params?.injected as any;
        walletAdapter = new MetaMaskWallet({ injected });
        walletKind = METAMASK_WALLET_KIND;
      } catch (error: any) {
        return {
          ok: false,
          code: "WALLET_CONNECT_FAILED",
          reason: error?.message || "Failed to create MetaMask wallet adapter",
        };
      }
    } else if ((walletProvider as string) === COINBASE_WALLET_KIND || (walletProvider as string) === "coinbase_wallet" || (walletProvider as string) === "coinbase") {
      // Coinbase Wallet adapter (v2 Phase 2A)
      try {
        const injected = input.wallet.params?.injected as any;
        walletAdapter = new CoinbaseWallet({ injected });
        walletKind = COINBASE_WALLET_KIND;
      } catch (error: any) {
        return {
          ok: false,
          code: "WALLET_CONNECT_FAILED",
          reason: error?.message || "Failed to create Coinbase Wallet adapter",
        };
      }
    } else if (walletProvider === "external") {
      walletAdapter = new ExternalWalletAdapter(input.wallet.params);
      walletKind = "external";
    } else {
      // Unknown provider - default to external
      walletAdapter = new ExternalWalletAdapter(input.wallet.params);
      walletKind = "external";
    }
    
    // Connect wallet and get address, metadata, and capabilities (v2 Phase 2 Execution Layer)
    if (walletAdapter) {
      try {
        // Connect wallet (v2 Phase 2 Execution Layer)
        await walletAdapter.connect();
        
        // Get wallet address
        const addr = await walletAdapter.getAddress();
        walletAddress = addr.value;
        walletKind = walletAdapter.kind;
        walletChain = walletAdapter.chain;
        
        // Get wallet capabilities (v2 Phase 2 Execution Layer)
        if (walletAdapter.capabilities) {
          walletCapabilitiesResponse = walletAdapter.capabilities();
        }
        
        // Get wallet capabilities (v2 Phase 2+ - legacy)
        if (walletAdapter.getCapabilities) {
          walletCapabilities = walletAdapter.getCapabilities();
        } else {
          // Default capabilities if not implemented
          walletCapabilities = {
            chain: walletAdapter.chain === "solana" ? "solana" : 
                   walletAdapter.chain === "evm" || walletAdapter.chain === "ethereum" || 
                   walletAdapter.chain === "base" || walletAdapter.chain === "polygon" || 
                   walletAdapter.chain === "arbitrum" ? "evm" : "unknown",
            can_sign_message: typeof walletAdapter.signMessage === "function",
            can_sign_transaction: typeof walletAdapter.signTransaction === "function",
          };
        }
        
        // Validate wallet supports requested asset/chain (v2 asset selection)
        if (walletCapabilitiesResponse && input.asset) {
          const walletChains = walletCapabilitiesResponse.chains || [];
          const walletAssets = walletCapabilitiesResponse.assets || [];
          
          // Check chain compatibility
          if (chainId && chainId !== "unknown") {
            // Map chain_id to wallet chain format
            const walletChainFormat = chainId === "solana" ? "solana" :
                                    chainId === "ethereum" || chainId === "base" || chainId === "polygon" || chainId === "arbitrum" ? "evm" :
                                    chainId;
            
            // Check if wallet supports the chain
            const chainSupported = walletChains.some((c: string) => 
              c === chainId || 
              c === walletChainFormat ||
              (chainId === "ethereum" && (c === "evm" || c === "ethereum")) ||
              (chainId === "base" && (c === "evm" || c === "base")) ||
              (chainId === "polygon" && (c === "evm" || c === "polygon")) ||
              (chainId === "arbitrum" && (c === "evm" || c === "arbitrum"))
            );
            
            if (!chainSupported) {
              return {
                ok: false,
                code: "WALLET_CAPABILITY_MISSING",
                reason: `Wallet does not support chain '${chainId}'. Supported chains: ${walletChains.join(", ")}`,
              };
            }
          }
          
          // Check asset compatibility (if wallet specifies supported assets)
          if (walletAssets.length > 0 && assetSymbol) {
            const assetSupported = walletAssets.some((a: string) => 
              a.toUpperCase() === assetSymbol.toUpperCase()
            );
            
            if (!assetSupported) {
              return {
                ok: false,
                code: "WALLET_CAPABILITY_MISSING",
                reason: `Wallet does not support asset '${assetSymbol}'. Supported assets: ${walletAssets.join(", ")}`,
              };
            }
          }
        }
        
        // Enforce transaction signing capability if required (v2 Phase 2+)
        if (input.wallet?.requires_transaction_signature) {
          if (!walletCapabilities || !walletCapabilities.can_sign_transaction) {
            return {
              ok: false,
              code: "WALLET_CAPABILITY_MISSING",
              reason: "Wallet cannot sign transactions",
            };
          }
        }
      } catch (error: any) {
        return {
          ok: false,
          code: "WALLET_CONNECT_FAILED",
          reason: error?.message || "Failed to connect wallet",
        };
      }
    }
  }
  
  // Wallet signing (v2 Phase 2 Execution Layer) - happens after acquisition succeeds
  // We'll handle this after we have the receipt/agreed_price
  
  // Initialize transcript collection if requested (needed for recordLifecycleError)
  const saveTranscript = input.saveTranscript ?? false;
  
  // Sanitize input for transcript (remove sensitive wallet data)
  const sanitizedInput = { ...input };
  if (sanitizedInput.wallet?.params) {
    // Remove sensitive wallet params (privateKey, secretKey, keypair) from transcript
    const sanitizedWalletParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sanitizedInput.wallet.params)) {
      // Only include non-sensitive params (like address, chain_id for test adapter)
      if (key !== "privateKey" && key !== "secretKey" && key !== "keypair" && key !== "wallet") {
        sanitizedWalletParams[key] = value;
      }
    }
    sanitizedInput.wallet = {
      ...sanitizedInput.wallet,
      params: Object.keys(sanitizedWalletParams).length > 0 ? sanitizedWalletParams : undefined,
    };
  }
  
  // Compute intent fingerprint early for double-commit detection (PACT-331)
  const intentFingerprint = computeIntentFingerprint({
    intent_type: input.intentType,
    scope: input.scope,
    constraints: input.constraints || {},
    buyer_agent_id: buyerId,
  });
  
  const transcriptData: Partial<TranscriptV1> | null = saveTranscript ? {
    version: "1",
    intent_type: input.intentType,
    timestamp_ms: nowFn ? nowFn() : Date.now(),
    input: sanitizedInput, // Sanitized copy with sensitive wallet data removed
    directory: [],
    credential_checks: [],
    quotes: [],
    outcome: { ok: false },
    // Asset metadata (v2 Phase 2C: normalized)
    asset_id: assetId, // Legacy: keep for backward compatibility
    chain_id: chainId, // Legacy: keep for backward compatibility
    asset: normalizedAssetSymbol, // v2 Phase 2C: normalized asset symbol
    chain: normalizedChain, // v2 Phase 2C: normalized chain
    // Wallet connection (v2 Phase 2C: normalized)
    wallet: walletAddress ? {
      kind: walletKind ?? (input.wallet?.provider ?? "external"),
      chain: walletChain ?? normalizedChain, // v2 Phase 2C: use normalized chain if wallet chain not available
      address: walletAddress,
      used: true,
      // Wallet capabilities (v2 Phase 2+)
      capabilities: walletCapabilities,
      // Asset metadata in wallet block (v2 Phase 2C)
      assets_supported: walletCapabilitiesResponse?.assets || [], // v2 Phase 2C: public list of supported assets
      asset: assetSymbol ?? assetId,
      asset_chain: chainId,
      asset_decimals: assetDecimals,
    } : undefined,
    // Initialize settlement lifecycle metadata (v1.6.3+)
    settlement_lifecycle: input.settlement?.provider ? {
      provider: input.settlement.provider,
      idempotency_key: input.settlement.idempotency_key,
      errors: [],
    } : undefined,
  } : null;
  
  // Helper to record settlement lifecycle error in transcript (v1.6.3+)
  // Must be declared after transcriptData initialization
  const recordLifecycleError = (code: string, reason: string) => {
    if (transcriptData?.settlement_lifecycle) {
      if (!transcriptData.settlement_lifecycle.errors) {
        transcriptData.settlement_lifecycle.errors = [];
      }
      transcriptData.settlement_lifecycle.errors.push({ code, reason });
    }
  };

  // Helper to save transcript on early return (non-retryable failures)
  // This ensures consistent transcript saving for UX and audit trails
  type AttemptEntryType = {
    idx: number;
    provider_pubkey: string;
    provider_id?: string;
    settlement_provider?: string;
    outcome: "success" | "failed";
    failure_code?: string;
    failure_reason?: string;
    timestamp_ms?: number;
  };
  const saveTranscriptOnEarlyReturn = async (
    intentId: string,
    failureCode: string,
    failureReason: string,
    attemptEntry?: AttemptEntryType,
    settlementHandleId?: string // v1.7.3+: Optional handle_id for SETTLEMENT_POLL_TIMEOUT
  ): Promise<string | undefined> => {
    if (!saveTranscript || !transcriptData || !input.transcriptDir) {
      return undefined;
    }

    // Update transcript with outcome and attempt entry
    transcriptData.intent_id = intentId;
    transcriptData.explain = explain || undefined;
    transcriptData.outcome = {
      ok: false,
      code: failureCode,
      reason: failureReason,
    };

    // Include attempt entry if provided, merging with any existing attempts
    // This ensures we capture the full attempt chain even on early returns
    if (attemptEntry) {
      // If transcriptData.settlement_attempts already exists (from previous attempts), 
      // merge with the current attempt entry
      if (transcriptData.settlement_attempts && transcriptData.settlement_attempts.length > 0) {
        // Update existing entry or add new one
        const existingIdx = transcriptData.settlement_attempts.findIndex(a => a.idx === attemptEntry.idx);
        if (existingIdx >= 0) {
          transcriptData.settlement_attempts[existingIdx] = attemptEntry as any;
        } else {
          transcriptData.settlement_attempts.push(attemptEntry as any);
        }
      } else {
        // First attempt, create array with this entry
        transcriptData.settlement_attempts = [attemptEntry as any];
      }
    }

    // Ensure settlement lifecycle status is set if lifecycle exists
    if (transcriptData.settlement_lifecycle) {
      // Handle settlement-related errors
      // EXCEPT for SETTLEMENT_POLL_TIMEOUT which should preserve/set "pending" status
      // (SETTLEMENT_POLL_TIMEOUT means settlement is still pending, we just gave up polling)
      const isSettlementError = failureCode.includes("SETTLEMENT") || 
                                 failureCode === "SETTLEMENT_FAILED" || 
                                 failureCode === "FAILED_PROOF" || 
                                 failureCode === "NO_RECEIPT";
      
      if (isSettlementError) {
        // Set failure code/reason if not already set (for all settlement errors including timeout)
        if (!transcriptData.settlement_lifecycle.failure_code) {
          transcriptData.settlement_lifecycle.failure_code = failureCode;
        }
        if (!transcriptData.settlement_lifecycle.failure_reason) {
          transcriptData.settlement_lifecycle.failure_reason = failureReason;
        }
        
        // Special handling for SETTLEMENT_POLL_TIMEOUT: set status to "pending" if not already terminal
        if (failureCode === "SETTLEMENT_POLL_TIMEOUT") {
          if (!transcriptData.settlement_lifecycle.status || 
              (transcriptData.settlement_lifecycle.status !== "committed" && 
               transcriptData.settlement_lifecycle.status !== "aborted" &&
               transcriptData.settlement_lifecycle.status !== "failed")) {
            transcriptData.settlement_lifecycle.status = "pending";
            // Also set handle_id if provided (for SETTLEMENT_POLL_TIMEOUT, we need the handle to reconcile)
            if (settlementHandleId && !transcriptData.settlement_lifecycle.handle_id) {
              transcriptData.settlement_lifecycle.handle_id = settlementHandleId;
            }
            // If handle_id still not set, try to get it from settlement provider
            if (!transcriptData.settlement_lifecycle.handle_id) {
              // Try to get from explicitSettlement (available in closure)
              // Note: This is a workaround - ideally the session would return handle_id in the error
              try {
                const settlementAny = (explicitSettlement as any);
                if (settlementAny && settlementAny.handles && typeof settlementAny.handles.get === 'function') {
                  // StripeLikeSettlementProvider has a handles Map
                  for (const [handleId, handle] of settlementAny.handles.entries()) {
                    if (handle.status === "pending") {
                      transcriptData.settlement_lifecycle.handle_id = handleId;
                      break;
                    }
                  }
                }
              } catch (e) {
                // Ignore errors - handle_id might not be accessible this way
              }
            }
          }
        } else {
          // Set status to "failed" for other settlement errors
          if (!transcriptData.settlement_lifecycle.status || 
              (transcriptData.settlement_lifecycle.status !== "committed" && 
               transcriptData.settlement_lifecycle.status !== "aborted" &&
               transcriptData.settlement_lifecycle.status !== "failed")) {
            transcriptData.settlement_lifecycle.status = "failed";
          }
        }
      }
    }

    try {
      const transcriptStore = new TranscriptStore(input.transcriptDir);
      return await transcriptStore.writeTranscript(intentId, transcriptData as TranscriptV1);
    } catch (error: any) {
      // Don't throw - transcript save failure shouldn't break the error return
      // Log error in development if needed
      return undefined;
    }
  };

  // Helper to record settlement lifecycle event (v1.7.2+)
  const recordLifecycleEvent = (
    op: "prepare" | "commit" | "poll" | "abort",
    status: "prepared" | "committed" | "aborted" | "pending" | "failed",
    meta?: Record<string, unknown>
  ) => {
    if (transcriptData?.settlement_lifecycle) {
      if (!transcriptData.settlement_lifecycle.settlement_events) {
        transcriptData.settlement_lifecycle.settlement_events = [];
      }
      transcriptData.settlement_lifecycle.settlement_events.push({
        ts_ms: nowFn ? nowFn() : Date.now(),
        op,
        status,
        meta,
      });
      // Update current status
      transcriptData.settlement_lifecycle.status = status;
      // Update timestamps based on operation
      const now = nowFn ? nowFn() : Date.now();
      if (op === "prepare" && status === "prepared") {
        transcriptData.settlement_lifecycle.prepared_at_ms = now;
        transcriptData.settlement_lifecycle.handle_id = meta?.handle_id as string;
      } else if (op === "commit" && status === "committed") {
        transcriptData.settlement_lifecycle.committed_at_ms = now;
        transcriptData.settlement_lifecycle.paid_amount = meta?.paid_amount as number;
      } else if (op === "commit" && status === "pending") {
        // Pending commit - record attempts
        transcriptData.settlement_lifecycle.attempts = meta?.attempts as number;
        transcriptData.settlement_lifecycle.last_attempt_ms = meta?.last_attempt_ms as number;
      } else if (op === "poll" && status === "committed") {
        transcriptData.settlement_lifecycle.committed_at_ms = now;
        transcriptData.settlement_lifecycle.paid_amount = meta?.paid_amount as number;
        transcriptData.settlement_lifecycle.attempts = meta?.attempts as number;
        transcriptData.settlement_lifecycle.last_attempt_ms = meta?.last_attempt_ms as number;
      } else if (op === "poll" && status === "failed") {
        transcriptData.settlement_lifecycle.failure_code = meta?.failure_code as string;
        transcriptData.settlement_lifecycle.failure_reason = meta?.failure_reason as string;
        transcriptData.settlement_lifecycle.attempts = meta?.attempts as number;
        transcriptData.settlement_lifecycle.last_attempt_ms = meta?.last_attempt_ms as number;
      } else if (op === "commit" && status === "failed") {
        // Handle commit failures (when commit returns failed status directly)
        transcriptData.settlement_lifecycle.failure_code = meta?.failure_code as string;
        transcriptData.settlement_lifecycle.failure_reason = meta?.failure_reason as string;
        if (meta?.attempts !== undefined) {
          transcriptData.settlement_lifecycle.attempts = meta.attempts as number;
        }
        if (meta?.last_attempt_ms !== undefined) {
          transcriptData.settlement_lifecycle.last_attempt_ms = meta.last_attempt_ms as number;
        }
      } else if (op === "abort" && status === "aborted") {
        transcriptData.settlement_lifecycle.aborted_at_ms = now;
      }
    }
  };

  // Settlement provider selection (v1.6.2+)
  // If caller passes settlement instance explicitly, that wins (backward compatibility).
  // Else if input.settlement.provider is provided, create provider via factory.
  // Else defer to policy-driven routing (after provider selection to get amount/trust info).
  let settlement: SettlementProvider | undefined;
  let settlementRoutingResult: { provider: string; matchedRuleIndex?: number; reason: string } | undefined;
  
  // Only create settlement provider early if explicitly provided (for backward compatibility)
    if (explicitSettlement) {
      // Explicit instance wins (backward compatibility)
      settlement = explicitSettlement;
    } else if (input.settlement?.provider) {
    // Explicit provider specified - create now
    try {
      settlement = createSettlementProvider({
        provider: input.settlement.provider,
        params: input.settlement.params,
        idempotency_key: input.settlement.idempotency_key,
      });
  } catch (error: any) {
    // Handle factory creation errors (e.g., invalid config)
    const errorMsg = error?.message || String(error);
    const explainLevel: ExplainLevel = input.explain ?? "none";
    const explain: AcquireExplain | null = explainLevel !== "none" ? {
      level: explainLevel,
      intentType: input.intentType,
      settlement: "hash_reveal",
      regime: "posted",
      fanout: 0,
      providers_considered: 0,
      providers_eligible: 0,
      log: [],
    } : null;
    
    // Record lifecycle error in transcript
    recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement provider creation failed: ${errorMsg}`);
    
    return {
      ok: false,
      code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
      reason: `Settlement provider not implemented: ${errorMsg}`,
      explain: explain || undefined,
    };
  }
  }
  // If neither explicit settlement nor input.settlement.provider, defer to routing after provider selection
  
  // Initialize explain if requested
  const explainLevel: ExplainLevel = input.explain ?? "none";
  const explain: AcquireExplain | null = explainLevel !== "none" ? {
    level: explainLevel,
    intentType: input.intentType,
    settlement: "hash_reveal", // Will be updated when settlement mode is determined
    regime: "posted", // Will be updated from plan
    fanout: 0, // Will be updated
    providers_considered: 0,
    providers_eligible: 0,
    log: [],
  } : null;

  // Helper to push decision to explain log
  const pushDecision = (
    provider: { provider_id: string; pubkey_b58: string; endpoint?: string },
    step: ProviderDecision["step"],
    ok: boolean,
    code: DecisionCode,
    reason: string,
    meta?: Record<string, any>
  ) => {
    if (!explain) return;
    const decision: ProviderDecision = {
      provider_id: provider.provider_id,
      pubkey_b58: provider.pubkey_b58,
      endpoint: provider.endpoint,
      step,
      ok,
      code,
      reason,
      ts_ms: nowFn ? nowFn() : Date.now(),
    };
    if (explainLevel === "full" && meta) {
      decision.meta = meta;
    }
    explain.log.push(decision);
  };

  // Initialize EventRunner for phase/event pipeline
  // Intent ID will be generated later, use temporary ID for now
  const tempIntentId = `temp-${nowFn ? nowFn() : Date.now()}`;
  const eventRunner = new EventRunner(tempIntentId, nowFn ? nowFn() : Date.now());
  
  // Register transcript commit handler to preserve ordering
  if (saveTranscript && transcriptData && input.transcriptDir) {
    eventRunner.on(async (event) => {
      // Only commit transcript on transcript_commit phase (preserves atomic gate)
      if (event.phase === "transcript_commit" && event.type === "success") {
        try {
          const transcriptStore = new TranscriptStore(input.transcriptDir);
          // Use intent_id from event (will be updated when actual intent_id is generated)
          await transcriptStore.writeTranscript(event.intent_id, transcriptData as TranscriptV1);
        } catch (error) {
          // Don't throw - transcript save failure shouldn't break execution
        }
      }
    });
  }

  // 1) Validate + compile policy (phase: policy_validation)
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    const failureEvent = await eventRunner.emitFailure(
      "policy_validation" as AcquisitionPhase,
      "INVALID_POLICY",
      `Policy validation failed: ${validated.errors.join(", ")}`,
      isRetryableFailureCode("INVALID_POLICY"), // false - not retryable
      { errors: validated.errors }
    );
    return {
      ok: false,
      code: failureEvent.failure_code,
      reason: failureEvent.failure_reason,
      ...(explain ? { explain } : {}),
    };
  }

  // Policy validation succeeded - emit success event
  await eventRunner.emitSuccess(
    "policy_validation" as AcquisitionPhase,
    { policy_id: validated.policy.policy_id || "default" },
    [createEvidence("policy_validation" as AcquisitionPhase, "policy_validation_result", {
      validated: true,
      policy_id: validated.policy.policy_id,
    })]
  );

  const compiled = compilePolicy(validated.policy);
  const guard = new DefaultPolicyGuard(compiled);
  
  // v2 Phase 5: ZK-KYA verification (policy-gated)
  // Note: compiled.base = policy (entire PactPolicy), so policy.base.kya.zk_kya -> compiled.base.base.kya.zk_kya
  const zkKyaConfig = compiled.base.base?.kya?.zk_kya;
  let zkKyaVerifier: ZkKyaVerifier | undefined = new DefaultZkKyaVerifier();
  let zkKyaVerificationResult: ZkKyaVerificationResult | undefined;
  let zkKyaProof: import("../kya/zk/types").ZkKyaProof | undefined;
  
  if (zkKyaConfig?.required) {
    // ZK-KYA is required - verify proof
    if (!input.identity?.buyer?.zk_kya_proof) {
      return {
        ok: false,
        code: "ZK_KYA_REQUIRED",
        reason: "ZK-KYA proof is required by policy but not provided",
        ...(explain ? { explain } : {}),
      };
    }
    
    const zkKyaInput = input.identity.buyer.zk_kya_proof;
    const now = nowFn ? nowFn() : Date.now();
    
    // Check expiry if provided
    if (zkKyaInput.expires_at_ms && now > zkKyaInput.expires_at_ms) {
      return {
        ok: false,
        code: "ZK_KYA_EXPIRED",
        reason: `ZK-KYA proof expired at ${zkKyaInput.expires_at_ms}, current time is ${now}`,
        ...(explain ? { explain } : {}),
      };
    }
    
    // Convert input to proof (hashing public inputs and proof bytes)
    const converted = convertZkKyaInputToProof(zkKyaInput);
    zkKyaProof = converted.proof;
    
    // Check issuer requirements
    if (zkKyaConfig.require_issuer) {
      if (!zkKyaProof.issuer_id) {
        return {
          ok: false,
          code: "ZK_KYA_ISSUER_NOT_ALLOWED",
          reason: "ZK-KYA proof requires issuer_id but none provided",
          ...(explain ? { explain } : {}),
        };
      }
      
      if (zkKyaConfig.allowed_issuers && zkKyaConfig.allowed_issuers.length > 0) {
        if (!zkKyaConfig.allowed_issuers.includes(zkKyaProof.issuer_id)) {
          return {
            ok: false,
            code: "ZK_KYA_ISSUER_NOT_ALLOWED",
            reason: `ZK-KYA issuer '${zkKyaProof.issuer_id}' not in allowed list: ${zkKyaConfig.allowed_issuers.join(", ")}`,
            ...(explain ? { explain } : {}),
          };
        }
      }
    }
    
    // Verify proof using verifier
    zkKyaVerificationResult = await zkKyaVerifier.verify({
      agent_id: buyerId,
      proof: zkKyaProof,
      now_ms: now,
    });
    
    if (!zkKyaVerificationResult.ok) {
      // Extract error code from reason string (e.g., "ZK_KYA_NOT_IMPLEMENTED: ..." -> "ZK_KYA_NOT_IMPLEMENTED")
      const reasonStr = zkKyaVerificationResult.reason || "ZK_KYA_INVALID";
      const codeMatch = reasonStr.match(/^([A-Z_]+)/);
      const code = codeMatch ? codeMatch[1] : "ZK_KYA_INVALID";
      
      return {
        ok: false,
        code: code as any,
        reason: reasonStr,
        ...(explain ? { explain } : {}),
      };
    }
    
    // Check minimum tier if required
    if (zkKyaConfig.min_tier && zkKyaVerificationResult.tier) {
      const tierOrder: Record<"untrusted" | "low" | "trusted", number> = { untrusted: 0, low: 1, trusted: 2 };
      const minTierOrder = tierOrder[zkKyaConfig.min_tier];
      const proofTierOrder = tierOrder[zkKyaVerificationResult.tier];
      
      if (proofTierOrder < minTierOrder) {
        return {
          ok: false,
          code: "ZK_KYA_TIER_TOO_LOW",
          reason: `ZK-KYA trust tier '${zkKyaVerificationResult.tier}' is below required minimum '${zkKyaConfig.min_tier}'`,
          ...(explain ? { explain } : {}),
        };
      }
    }
  } else if (input.identity?.buyer?.zk_kya_proof) {
    // ZK-KYA not required but proof provided - convert and record metadata (optional)
    const converted = convertZkKyaInputToProof(input.identity.buyer.zk_kya_proof);
    zkKyaProof = converted.proof;
    const now = nowFn ? nowFn() : Date.now();
    
    // Optionally verify (but don't fail if verification fails since it's not required)
    zkKyaVerificationResult = await zkKyaVerifier.verify({
      agent_id: buyerId,
      proof: zkKyaProof,
      now_ms: now,
    });
  }
  
  // Record ZK-KYA in transcript if proof was provided (v2 Phase 5)
  if (zkKyaProof && transcriptData) {
    transcriptData.zk_kya = {
      scheme: zkKyaProof.scheme,
      circuit_id: zkKyaProof.circuit_id,
      issuer_id: zkKyaProof.issuer_id,
      public_inputs_hash: zkKyaProof.public_inputs_hash,
      proof_hash: zkKyaProof.proof_hash,
      issued_at_ms: zkKyaProof.issued_at_ms,
      expires_at_ms: zkKyaProof.expires_at_ms,
      verification: {
        ok: zkKyaVerificationResult?.ok ?? false,
        tier: zkKyaVerificationResult?.tier,
        trust_score: zkKyaVerificationResult?.trust_score,
        reason: zkKyaVerificationResult?.reason,
      },
      meta: zkKyaProof.meta,
    };
  }

  // 2) Compute market stats from store (if provided)
  let p50: number | null = null;
  let p90: number | null = null;
  let tradeCount = 0;

  if (store) {
    const receiptsForIntent = store.list({ intentType: input.intentType });
    const stats = priceStats(receiptsForIntent);
    p50 = stats.p50;
    p90 = stats.p90;
    tradeCount = stats.n;
  }

  // 3) Route execution
  const plan = routeExecution({
    intentType: input.intentType,
    urgency: !!input.urgent,
    tradeCount,
    p50,
    p90,
    policyMaxRounds: compiled.base.negotiation.max_rounds,
  });

  const chosenMode = input.modeOverride ?? plan.settlement;
  const overrideActive = input.modeOverride != null;

  // 4) Build provider candidate list (BEFORE creating session) - Phase: provider_discovery
  let internalNow = 0;
  const nowFunction = nowFn || (() => {
    const current = internalNow;
    internalNow += 1000;
    return current;
  });

  // Build provider candidates
  type ProviderCandidate = {
    provider_id: string;
    pubkey_b58: string;
    credentials?: string[];
    region?: string;
    baseline_latency_ms?: number;
    endpoint?: string; // HTTP endpoint for real providers
  };

  let candidates: ProviderCandidate[] = [];
  
  // Initialize contention tracking for v4 evidence (always defined for scope access)
  let contention: {
    fanout: number;
    contenders: Array<{ provider_id: string; pubkey_b58: string; endpoint?: string; eligible: boolean; reject_code?: string }>;
    winner: null | { provider_id: string; pubkey_b58: string };
    decision: { rule: "v1"; tie_break: "order_then_score"; note?: string };
  } = {
    fanout: 1,
    contenders: [],
    winner: null,
    decision: { rule: "v1", tie_break: "order_then_score" },
  };
  
  // Helper to update contender eligibility/rejection (observational only, no control flow change)
  const updateContender = (providerId: string, eligible: boolean, rejectCode?: string) => {
    const contender = contention.contenders.find(c => c.provider_id === providerId);
    if (contender) {
      contender.eligible = eligible;
      if (rejectCode) {
        contender.reject_code = rejectCode;
      }
    }
  };
  
  // Emit provider_discovery progress event
  await eventRunner.emitProgress(
    "provider_discovery" as AcquisitionPhase,
    0.0,
    "Discovering providers from directory",
    { intent_type: input.intentType }
  );
  
  if (directory) {
    // Use directory for fanout
    const allProviders = directory.listProviders(input.intentType);
    
    // Log directory empty
    if (allProviders.length === 0) {
      const failureEvent = await eventRunner.emitFailure(
        "provider_discovery" as AcquisitionPhase,
        "NO_PROVIDERS",
        "Directory returned no providers for intent type",
        isRetryableFailureCode("NO_PROVIDERS"), // false - not retryable
        { intent_type: input.intentType }
      );
      
      if (explain) {
        explain.regime = plan.regime;
        explain.settlement = chosenMode;
        explain.fanout = plan.fanout;
        explain.providers_considered = 0;
        explain.providers_eligible = 0;
        explain.log.push({
          provider_id: "",
          pubkey_b58: "",
          step: "directory",
          ok: false,
          code: "DIRECTORY_EMPTY",
          reason: "No providers found in directory for intent type",
          ts_ms: nowFunction(),
        });
      }
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
          offers_considered: 0,
        },
        code: failureEvent.failure_code,
        reason: failureEvent.failure_reason,
        offers_eligible: 0,
        ...(explain ? { explain } : {}),
      };
    }
    
    // When explain is enabled, consider all providers to show rejections
    // Otherwise use the plan's fanout
    const baseFanout = explainLevel !== "none" 
      ? allProviders.length  // Consider all providers when explaining
      : (rfq?.fanout ?? plan.fanout);
    const effectiveFanout = Math.min(
      baseFanout,
      rfq?.maxCandidates ?? 100,
      allProviders.length
    );
    
    // Take first N providers (stable order)
    const selectedProviders = allProviders.slice(0, effectiveFanout);
    
    // Update contention for directory-based fanout
    contention.fanout = effectiveFanout;
    contention.contenders = [];
    contention.winner = null;
    
    candidates = selectedProviders.map(record => {
      const provider = record as any;
      const candidate: ProviderCandidate = {
        provider_id: record.provider_id,
        pubkey_b58: provider.pubkey_b58 ?? provider.pubkeyB58 ?? provider.pubkey ?? record.provider_id,
        credentials: provider.credentials ?? provider.credential ?? [],
        region: provider.region,
        baseline_latency_ms: provider.baseline_latency_ms,
        endpoint: provider.endpoint,
      };
      
      // Initialize contender entry with eligible=false (will be updated during evaluation)
      contention.contenders.push({
        provider_id: candidate.provider_id,
        pubkey_b58: candidate.pubkey_b58,
        endpoint: candidate.endpoint,
        eligible: false,
      });
      
      // Collect directory data for transcript
      if (transcriptData) {
        transcriptData.directory!.push({
          provider_id: record.provider_id,
          pubkey_b58: candidate.pubkey_b58,
          endpoint: candidate.endpoint,
          region: candidate.region,
          credentials: candidate.credentials,
        });
      }
      
      // Log directory step (provider found) - don't use PROVIDER_SELECTED here, that's only for the winner
      // Just track that we found the provider (no decision code needed for positive directory lookup)
      
      return candidate;
    });
    
    if (explain) {
      explain.providers_considered = candidates.length;
    }
    
    // Emit provider_discovery success event
    await eventRunner.emitSuccess(
      "provider_discovery" as AcquisitionPhase,
      { providers_found: candidates.length, fanout: effectiveFanout },
      [createEvidence("provider_discovery" as AcquisitionPhase, "provider_candidates", {
        count: candidates.length,
        provider_ids: candidates.map(c => c.provider_id),
      })]
    );
  } else {
    // Single seller path (backward compatible)
    // Update contention for single seller (fanout=1, no contention)
    contention.fanout = 1;
    contention.contenders = [];
    contention.winner = null;
    
    candidates = [{
      provider_id: sellerId,
      pubkey_b58: sellerId,
      credentials: input.identity?.seller?.credentials ?? [],
      region: "us-east",
      baseline_latency_ms: input.constraints.latency_ms,
    }];
    
    // Initialize contender entry for single seller (fanout=1)
    contention.contenders.push({
      provider_id: sellerId,
      pubkey_b58: sellerId,
      eligible: false,
    });
    
    if (explain) {
      // Log that we're using single seller path (no decision code needed for positive directory lookup)
      explain.providers_considered = 1;
    }
    
    // Emit provider_discovery success event (single seller path)
    await eventRunner.emitSuccess(
      "provider_discovery" as AcquisitionPhase,
      { providers_found: 1, fanout: 1 },
      [createEvidence("provider_discovery" as AcquisitionPhase, "provider_candidates", {
        count: 1,
        provider_ids: [sellerId],
      })]
    );
  }

  const cp: any = (params.policy as any).counterparty ?? {};

    // support both naming conventions
  const intentSpecific =
    cp.intent_specific?.[input.intentType] ??
    cp.intentSpecific?.[input.intentType] ??
    null;

  const requiredCreds: string[] =
    intentSpecific?.require_credentials ??
    intentSpecific?.requireCredentials ??
    cp.require_credentials ??
    cp.requireCredentials ??
    [];

  // Evaluate each candidate (side-effect free - no session.onQuote calls)
  type CandidateEvaluation = {
    provider: ProviderCandidate;
    providerPubkey: string;
    askPrice: number;
    utility: number;
    sellerReputation: number;
    hasRequiredCredentials: boolean;
    latencyMs: number;
  };

  const evaluations: CandidateEvaluation[] = [];
  const referenceP50 = p50 ?? 0.00009; // Bootstrap constant
  const askNow = nowFunction();
  
  // Track failure codes for priority selection when no eligible providers
  const failureCodes: DecisionCode[] = [];

  // Emit progress event for provider evaluation phase start
  await eventRunner.emitProgress(
    "provider_evaluation" as AcquisitionPhase,
    0.0,
    `Evaluating ${candidates.length} provider candidate(s)`,
    { candidates_count: candidates.length }
  );

  for (const provider of candidates) {
    // Use pubkey_b58 (never provider_id)
    const providerPubkey = provider.pubkey_b58;
    
    // Get credentials from provider and merge with identity
    const providerCreds = provider.credentials ?? [];
    const finalCreds = [...providerCreds, ...(input.identity?.seller?.credentials ?? [])];
    
    // Pre-filter by credentials
    const hasAllCreds = requiredCreds.length === 0 || requiredCreds.every(c => finalCreds.includes(c));
    
    if (!hasAllCreds) {
      // Log missing credentials
      const code = "PROVIDER_MISSING_REQUIRED_CREDENTIALS" as DecisionCode;
      failureCodes.push(code);
      
      // Emit failure event for this provider evaluation
      await eventRunner.emitFailure(
        "provider_evaluation" as AcquisitionPhase,
        code,
        `Missing required credentials: ${requiredCreds.filter(c => !finalCreds.includes(c)).join(", ")}`,
        isRetryableFailureCode(code), // false - not retryable
        {
          provider_id: provider.provider_id,
          provider_pubkey: providerPubkey,
          required_creds: requiredCreds,
          provider_creds: finalCreds,
        },
        [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
          provider_id: provider.provider_id,
          has_required_creds: false,
          missing_creds: requiredCreds.filter(c => !finalCreds.includes(c)),
        })]
      );
      
      pushDecision(
        provider,
        "capabilities",
        false,
        code,
        `Missing required credentials: ${requiredCreds.filter(c => !finalCreds.includes(c)).join(", ")}`,
        explainLevel === "full" ? {
          requiredCreds,
          providerCreds: finalCreds,
        } : undefined
      );
      updateContender(provider.provider_id, false, code);
      continue; // Skip provider lacking required credentials
    }

    // Build identity context for seller verification
    const sellerIssuers = input.identity?.seller?.issuer_ids || [];
    const credentials: Array<{ type: string; issuer: string }> = [];
    
    // Add credentials with types (need issuers)
    if (finalCreds.length > 0) {
      finalCreds.forEach(type => {
        credentials.push({ type, issuer: sellerIssuers[0] || "default" });
      });
    }
    
    // Add issuer-based credentials (from issuer_ids)
    sellerIssuers.forEach(issuer => {
      credentials.push({ type: "verified", issuer });
    });

    // Track credential verification status for V2 scoring
    let credentialPresent = false;
    let credentialClaims: AgentScoreV2Context["credentialClaims"] = undefined;
    let trustResult: ReturnType<typeof computeCredentialTrustScore> | null = null;

    // Compute initial reputation for identity check (V1, will be recomputed later for utility if V2 enabled)
    let sellerReputation = store ? (() => {
      const score = agentScore(providerPubkey, store.list({ agentId: providerPubkey }));
      return score.reputation;
    })() : 0.5;

    const sellerIdentityCtx: IdentityContext = {
      agent_id: providerPubkey,
      credentials,
      region: provider.region,
      is_new_agent: false,
      reputation: sellerReputation,
    };

    // Check identity phase
    const identityCheck = guard.check("identity", sellerIdentityCtx, input.intentType);
    if (!identityCheck.ok) {
      // Log identity check failure
      const code = identityCheck.code === "MISSING_REQUIRED_CREDENTIALS" ? "PROVIDER_MISSING_REQUIRED_CREDENTIALS" : 
        identityCheck.code === "UNTRUSTED_ISSUER" ? "PROVIDER_UNTRUSTED_ISSUER" :
        "PROVIDER_INTENT_NOT_SUPPORTED" as DecisionCode;
      failureCodes.push(code);
      
      // Emit failure event for this provider evaluation
      await eventRunner.emitFailure(
        "provider_evaluation" as AcquisitionPhase,
        code,
        `Identity check failed: ${identityCheck.code}`,
        isRetryableFailureCode(code), // false - not retryable
        {
          provider_id: provider.provider_id,
          provider_pubkey: providerPubkey,
          identity_check_code: identityCheck.code,
        },
        [createEvidence("provider_evaluation" as AcquisitionPhase, "identity_check", {
          provider_id: provider.provider_id,
          passed: false,
          failure_code: identityCheck.code,
        })]
      );
      
      pushDecision(
        provider,
        "identity",
        false,
        code,
        `Identity check failed: ${identityCheck.code}`,
        explainLevel === "full" ? {
          code: identityCheck.code,
        } : undefined
      );
      
      updateContender(provider.provider_id, false, code);
      // Skip this provider (will result in NO_ELIGIBLE_PROVIDERS if all fail)
      continue;
    }

    // For HTTP providers, fetch and verify credential before fetching quote
    if (provider.endpoint) {
      try {
        const credentialResponse = await fetchCredential(provider.endpoint, input.intentType);
        const credentialEnvelope = credentialResponse.envelope;
        
        // Verify credential envelope signature
        const credentialVerified = verifyEnvelope(credentialEnvelope);
        if (!credentialVerified) {
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            "Credential signature verification failed",
            isRetryableFailureCode(code), // false - not retryable
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "credential_signature_invalid",
            })]
          );
          
          pushDecision(
            provider,
            "identity",
            false,
            code,
            "Credential signature verification failed",
            explainLevel === "full" ? {
              reason: "credential_signature_invalid",
            } : undefined
          );
          // Collect credential check for transcript
          if (transcriptData) {
            transcriptData.credential_checks!.push({
              provider_id: provider.provider_id,
              pubkey_b58: providerPubkey,
              ok: false,
              code: "PROVIDER_CREDENTIAL_INVALID",
              reason: "Credential signature verification failed",
            });
          }
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Verify credential signer matches provider pubkey
        if (credentialEnvelope.signer_public_key_b58 !== providerPubkey) {
          const code = "PROVIDER_SIGNER_MISMATCH" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            "Credential signer does not match provider pubkey",
            isRetryableFailureCode(code), // false - not retryable
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              credential_signer: credentialEnvelope.signer_public_key_b58,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "credential_signer_mismatch",
            })]
          );
          
          pushDecision(
            provider,
            "identity",
            false,
            code,
            "Credential signer does not match provider pubkey",
            explainLevel === "full" ? {
              reason: "credential_signer_mismatch",
              expected: providerPubkey,
              actual: credentialEnvelope.signer_public_key_b58,
            } : undefined
          );
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Parse credential message
        const credentialMsg = credentialEnvelope.message as any;
        
        // Verify credential is not expired
        const now = nowFunction();
        if (credentialMsg.expires_at_ms && credentialMsg.expires_at_ms < now) {
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            "Credential expired",
            isRetryableFailureCode(code), // false - not retryable
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              expires_at_ms: credentialMsg.expires_at_ms,
              now,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "credential_expired",
            })]
          );
          
          pushDecision(
            provider,
            "identity",
            false,
            code,
            "Credential expired",
            explainLevel === "full" ? {
              reason: "credential_expired",
              expires_at_ms: credentialMsg.expires_at_ms,
              now,
            } : undefined
          );
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Verify credential supports requested intent type
        const capabilities = credentialMsg.capabilities || [];
        const supportsIntent = capabilities.some((cap: any) => cap.intentType === input.intentType);
        if (!supportsIntent && capabilities.length > 0) {
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            `Credential does not support intent type: ${input.intentType}`,
            isRetryableFailureCode(code), // false - not retryable
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              requested_intent: input.intentType,
              available_intents: capabilities.map((cap: any) => cap.intentType),
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "credential_intent_not_supported",
            })]
          );
          
          pushDecision(
            provider,
            "identity",
            false,
            code,
            `Credential does not support intent type: ${input.intentType}`,
            explainLevel === "full" ? {
              reason: "credential_intent_not_supported",
              requested: input.intentType,
              available: capabilities.map((cap: any) => cap.intentType),
            } : undefined
          );
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Credential verified successfully - mark for V2 scoring
        credentialPresent = true;
        const matchedCapability = capabilities.find((cap: any) => cap.intentType === input.intentType);
        if (matchedCapability) {
          credentialClaims = {
            credentials: matchedCapability.credentials || [],
            region: matchedCapability.region || provider.region,
            modes: matchedCapability.modes || [],
          };
        }
        
        // Compute trust score (only if credential present)
        const baseTrustConfigForTrust = compiled.trustConfig!;
        if (credentialPresent) {
          trustResult = computeCredentialTrustScore({
            credential: {
              issuer: credentialMsg.issuer || "self",
              claims: matchedCapability?.credentials || [],
              region: matchedCapability?.region || provider.region,
              modes: matchedCapability?.modes || [],
            },
            claims: matchedCapability?.credentials || [],
            requestContext: {
              region: (input.constraints as any)?.region,
              settlementMode: chosenMode,
            },
            policyTrustConfig: baseTrustConfigForTrust,
          });
        }
        
        // Provider eligible - log trust score for full explain
        if (explainLevel === "full" && credentialPresent && trustResult) {
          pushDecision(
            provider,
            "identity",
            true,
            "PROVIDER_CREDENTIAL_TRUST_SCORE",
            `Credential trust score: ${trustResult.trust_score.toFixed(3)} (${trustResult.tier})`,
            {
              trust_score: trustResult.trust_score,
              tier: trustResult.tier,
              issuer: trustResult.issuer,
              reasons: trustResult.reasons,
            }
          );
        }
        
        // Store trust score and tier in evaluation context (for selection and reputation)
        if (credentialPresent && trustResult) {
          (provider as any)._trustScore = trustResult.trust_score;
          (provider as any)._trustTier = trustResult.tier;
        } else {
          (provider as any)._trustScore = 0;
          (provider as any)._trustTier = "untrusted";
        }
        
        // Collect successful credential check for transcript
        if (transcriptData && trustResult) {
          transcriptData.credential_checks!.push({
            provider_id: provider.provider_id,
            pubkey_b58: providerPubkey,
            ok: true,
            credential_summary: {
              signer_public_key_b58: credentialEnvelope.signer_public_key_b58,
              expires_at_ms: credentialMsg.expires_at_ms,
              capabilities: capabilities,
            },
            trust_score: trustResult.trust_score,
            trust_tier: trustResult.tier,
          });
        }
        
        // Credential verified successfully (no decision log entry for success, only failures)
      } catch (error: any) {
        // Credential fetch failed (provider may not support credential endpoint)
        // For v1.5, we allow graceful degradation: if credential endpoint doesn't exist (404),
        // continue without credential verification (backward compatibility)
        if (error.message?.includes("404") || error.message?.includes("Not found")) {
          // Credential endpoint not found - allow legacy providers (backward compatibility)
          // Don't log decision for 404 (graceful degradation)
          // credentialPresent remains false
        } else {
          // Other errors (network, parse) - reject provider
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            `Credential fetch failed: ${error.message}`,
            isRetryableFailureCode(code), // false - not retryable
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              error_message: error.message,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "credential_fetch_error",
            })]
          );
          
          pushDecision(
            provider,
            "identity",
            false,
            code,
            `Credential fetch failed: ${error.message}`,
            explainLevel === "full" ? {
              reason: "credential_fetch_error",
              error: error.message,
            } : undefined
          );
          updateContender(provider.provider_id, false, code);
          continue; // Skip provider if credential fetch fails (except 404)
        }
      }
    }
    
    // Get buyer overrides and merge with policy trust config (after credential verification attempt)
    const baseTrustConfig = compiled.trustConfig!;
    const requireCredential = input.requireCredential ?? baseTrustConfig.require_credential;
    
    // Check requireCredential (after credential verification attempt, whether success or 404)
    if (requireCredential && !credentialPresent) {
      const code = "PROVIDER_CREDENTIAL_REQUIRED" as DecisionCode;
      failureCodes.push(code);
      
      // Emit failure event for this provider evaluation
      await eventRunner.emitFailure(
        "provider_evaluation" as AcquisitionPhase,
        code,
        "Credential required but provider does not present one",
        isRetryableFailureCode(code), // false - not retryable
        {
          provider_id: provider.provider_id,
          provider_pubkey: providerPubkey,
          require_credential: requireCredential,
        },
        [createEvidence("provider_evaluation" as AcquisitionPhase, "credential_check", {
          provider_id: provider.provider_id,
          passed: false,
          reason: "credential_required_but_missing",
        })]
      );
      
      pushDecision(
        provider,
        "identity",
        false,
        code,
        "Credential required but provider does not present one",
        explainLevel === "full" ? {
          require_credential: requireCredential,
        } : undefined
      );
      updateContender(provider.provider_id, false, code);
      continue;
    }
    
    // Get remaining trust config overrides
    const requireTrustedIssuer = baseTrustConfig.require_trusted_issuer; // Buyer override not provided for this
    const minTrustTier = input.minTrustTier ?? baseTrustConfig.min_trust_tier;
    const minTrustScore = input.minTrustScore ?? baseTrustConfig.min_trust_score;
    
    // Trust result was computed above if credentialPresent, otherwise it's null
    // If no credential, trust tier/score checks don't apply (already passed requireCredential check)
    if (credentialPresent && trustResult) {
      // 2. Check require_trusted_issuer
      if (requireTrustedIssuer && !baseTrustConfig.trusted_issuers.includes(trustResult.issuer)) {
        const code = "PROVIDER_ISSUER_UNTRUSTED" as DecisionCode;
        failureCodes.push(code);
        
        // Emit failure event for this provider evaluation
        await eventRunner.emitFailure(
          "provider_evaluation" as AcquisitionPhase,
          code,
          `Issuer "${trustResult.issuer}" not in trusted issuers list`,
          isRetryableFailureCode(code), // false - not retryable
          {
            provider_id: provider.provider_id,
            provider_pubkey: providerPubkey,
            issuer: trustResult.issuer,
            trusted_issuers: baseTrustConfig.trusted_issuers,
          },
          [createEvidence("provider_evaluation" as AcquisitionPhase, "trust_check", {
            provider_id: provider.provider_id,
            passed: false,
            reason: "issuer_untrusted",
          })]
        );
        
        pushDecision(
          provider,
          "identity",
          false,
          code,
          `Issuer "${trustResult.issuer}" not in trusted issuers list`,
          explainLevel === "full" ? {
            issuer: trustResult.issuer,
            trusted_issuers: baseTrustConfig.trusted_issuers,
          } : undefined
        );
        continue;
      }
      
      // 3. Check trust tier
      // Tier ordering: untrusted < low < trusted
      const tierOrder: Record<"untrusted" | "low" | "trusted", number> = {
        untrusted: 0,
        low: 1,
        trusted: 2,
      };
      if (tierOrder[trustResult.tier] < tierOrder[minTrustTier]) {
        const code = "PROVIDER_TRUST_TIER_TOO_LOW" as DecisionCode;
        failureCodes.push(code);
        
        // Emit failure event for this provider evaluation
        await eventRunner.emitFailure(
          "provider_evaluation" as AcquisitionPhase,
          code,
          `Trust tier "${trustResult.tier}" below minimum "${minTrustTier}"`,
          isRetryableFailureCode(code), // false - not retryable
          {
            provider_id: provider.provider_id,
            provider_pubkey: providerPubkey,
            tier: trustResult.tier,
            min_trust_tier: minTrustTier,
            trust_score: trustResult.trust_score,
          },
          [createEvidence("provider_evaluation" as AcquisitionPhase, "trust_check", {
            provider_id: provider.provider_id,
            passed: false,
            reason: "trust_tier_too_low",
          })]
        );
        
        pushDecision(
          provider,
          "identity",
          false,
          code,
          `Trust tier "${trustResult.tier}" below minimum "${minTrustTier}"`,
          explainLevel === "full" ? {
            tier: trustResult.tier,
            min_trust_tier: minTrustTier,
            trust_score: trustResult.trust_score,
          } : undefined
        );
        updateContender(provider.provider_id, false, code);
        continue;
      }
      
      // 4. Check trust score
      if (trustResult.trust_score < minTrustScore) {
        const code = "PROVIDER_TRUST_SCORE_TOO_LOW" as DecisionCode;
        failureCodes.push(code);
        
        // Emit failure event for this provider evaluation
        await eventRunner.emitFailure(
          "provider_evaluation" as AcquisitionPhase,
          code,
          `Credential trust score ${trustResult.trust_score.toFixed(3)} below minimum ${minTrustScore}`,
          isRetryableFailureCode(code), // false - not retryable
          {
            provider_id: provider.provider_id,
            provider_pubkey: providerPubkey,
            trust_score: trustResult.trust_score,
            min_trust_score: minTrustScore,
            tier: trustResult.tier,
          },
          [createEvidence("provider_evaluation" as AcquisitionPhase, "trust_check", {
            provider_id: provider.provider_id,
            passed: false,
            reason: "trust_score_too_low",
          })]
        );
        
        pushDecision(
          provider,
          "identity",
          false,
          code,
          `Credential trust score ${trustResult.trust_score.toFixed(3)} below minimum ${minTrustScore}`,
          explainLevel === "full" ? {
            trust_score: trustResult.trust_score,
            min_trust_score: minTrustScore,
            tier: trustResult.tier,
            reasons: trustResult.reasons,
          } : undefined
        );
        updateContender(provider.provider_id, false, code);
        continue;
      }
    }
    
    // Store trust score and tier for routing (even if no credential, default to untrusted/0)
    if (!credentialPresent || !trustResult) {
      (provider as any)._trustScore = 0;
      (provider as any)._trustTier = "untrusted";
    }

    // Generate or fetch quote price
    let askPrice: number;
    let latencyMs: number;
    
    if (provider.endpoint) {
      // HTTP provider: fetch signed quote envelope from endpoint
      try {
        const quoteResponse = await fetchQuote(provider.endpoint, {
          intent_id: `temp-${nowFunction()}`, // Temporary ID for quote request
          intent_type: input.intentType,
          max_price: input.maxPrice,
          constraints: input.constraints,
          urgent: input.urgent,
        });
        
        // Verify envelope signature (synchronous function)
        const quoteVerified = verifyEnvelope(quoteResponse.envelope);
        if (!quoteVerified) {
          // Invalid signature, skip this provider
          const code = "PROVIDER_SIGNATURE_INVALID" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            "Quote envelope signature verification failed",
            isRetryableFailureCode(code), // true - retryable (network/crypto issue)
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "quote_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "quote_signature_invalid",
            })]
          );
          
          pushDecision(
            provider,
            "quote",
            false,
            code,
            "Quote envelope signature verification failed"
          );
          // Collect failed quote for transcript
          if (transcriptData) {
            transcriptData.quotes!.push({
              provider_id: provider.provider_id,
              pubkey_b58: providerPubkey,
              ok: false,
              code: "PROVIDER_SIGNATURE_INVALID",
              reason: "Quote envelope signature verification failed",
            });
          }
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Parse envelope to get message
        let parsed;
        try {
          parsed = await parseEnvelope(quoteResponse.envelope);
        } catch (error: any) {
          const code = "PROVIDER_QUOTE_PARSE_ERROR" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            `Failed to parse quote envelope: ${error.message}`,
            isRetryableFailureCode(code), // true - retryable (parse/network issue)
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              error_message: error.message,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "quote_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "quote_parse_error",
            })]
          );
          
          pushDecision(
            provider,
            "quote",
            false,
            code,
            `Failed to parse quote envelope: ${error.message}`,
            explainLevel === "full" ? { error: error.message } : undefined
          );
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Know Your Agent: verify signer matches provider pubkey
        const signerMatches = parsed.signer_public_key_b58 === providerPubkey;
        if (!signerMatches) {
          // Signer doesn't match directory pubkey, skip this provider
          const code = "PROVIDER_SIGNER_MISMATCH" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            `Signer ${parsed.signer_public_key_b58.substring(0, 8)} does not match provider ${providerPubkey.substring(0, 8)}`,
            isRetryableFailureCode(code), // true - retryable (identity mismatch)
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              quote_signer: parsed.signer_public_key_b58,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "quote_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "quote_signer_mismatch",
            })]
          );
          
          pushDecision(
            provider,
            "quote",
            false,
            code,
            `Signer ${parsed.signer_public_key_b58.substring(0, 8)} does not match provider ${providerPubkey.substring(0, 8)}`
          );
          updateContender(provider.provider_id, false, code);
          continue;
        }
        
        // Use verified ASK message from envelope
        if (parsed.message.type !== "ASK") {
          const code = "PROVIDER_QUOTE_INVALID" as DecisionCode;
          failureCodes.push(code);
          
          // Emit failure event for this provider evaluation
          await eventRunner.emitFailure(
            "provider_evaluation" as AcquisitionPhase,
            code,
            `Expected ASK message, got ${parsed.message.type}`,
            isRetryableFailureCode(code), // false - not retryable (protocol violation)
            {
              provider_id: provider.provider_id,
              provider_pubkey: providerPubkey,
              message_type: parsed.message.type,
            },
            [createEvidence("provider_evaluation" as AcquisitionPhase, "quote_check", {
              provider_id: provider.provider_id,
              passed: false,
              reason: "invalid_message_type",
            })]
          );
          
          pushDecision(
            provider,
            "quote",
            false,
            code,
            `Expected ASK message, got ${parsed.message.type}`
          );
          updateContender(provider.provider_id, false, code);
          continue; // Invalid message type
        }
        
        askPrice = parsed.message.price;
        latencyMs = parsed.message.latency_ms;
        
        // Store the verified envelope for later use
        (provider as any)._verifiedAskEnvelope = quoteResponse.envelope;
        
        // Collect successful quote for transcript
        if (transcriptData) {
          transcriptData.quotes!.push({
            provider_id: provider.provider_id,
            pubkey_b58: providerPubkey,
            ok: true,
            signer_pubkey_b58: parsed.signer_public_key_b58,
            quote_summary: {
              quote_price: askPrice,
              reference_price_p50: referenceP50,
              valid_for_ms: parsed.message.valid_for_ms,
              is_firm_quote: (parsed.message as any).is_firm_quote,
              urgent: (parsed.message as any).urgent,
            },
          });
        }
      } catch (error: any) {
        // HTTP provider failed, skip this provider
        const code = "PROVIDER_QUOTE_HTTP_ERROR" as DecisionCode;
        failureCodes.push(code);
        
        // Emit failure event for this provider evaluation
        await eventRunner.emitFailure(
          "provider_evaluation" as AcquisitionPhase,
          code,
          `HTTP error fetching quote: ${error.message}`,
          isRetryableFailureCode(code), // true - retryable (network error)
          {
            provider_id: provider.provider_id,
            provider_pubkey: providerPubkey,
            error_message: error.message,
          },
          [createEvidence("provider_evaluation" as AcquisitionPhase, "quote_check", {
            provider_id: provider.provider_id,
            passed: false,
            reason: "quote_http_error",
          })]
        );
        
        pushDecision(
          provider,
          "quote",
          false,
          code,
          `HTTP error fetching quote: ${error.message}`,
          explainLevel === "full" ? { error: error.message } : undefined
        );
        updateContender(provider.provider_id, false, code);
        continue;
      }
    } else {
      // Check if endpoint is required but missing
      // (This would be determined by policy, but for now we'll skip this check as it's handled elsewhere)
      // Local/simulated provider: generate deterministic quote
      const providerHash = providerPubkey.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const priceVariation = (providerHash % 20) / 1000; // 0-0.02 variation
      const basePrice = Math.min(input.maxPrice * 0.8, input.maxPrice);
      askPrice = basePrice * (1 - priceVariation);
      latencyMs = provider.baseline_latency_ms ?? input.constraints.latency_ms;
      
      // Collect local quote for transcript
      if (transcriptData) {
        transcriptData.quotes!.push({
          provider_id: provider.provider_id,
          pubkey_b58: providerPubkey,
          ok: true,
          quote_summary: {
            quote_price: askPrice,
            reference_price_p50: referenceP50,
            valid_for_ms: 20000,
            is_firm_quote: true,
            urgent: input.urgent,
          },
        });
      }
    }

    // Build negotiation context (same shape as policy vectors)
    // Note: intentNow will be set when we create the session
    const intentNowEstimate = nowFunction() - 1000; // Estimate - will be set properly later
    
    // v2 Phase 2+: Get wallet balances for wallet-aware negotiation
    let buyerWalletBalance: number | undefined;
    if (walletAdapter && walletAdapter.getBalance && assetSymbol) {
      try {
        buyerWalletBalance = await walletAdapter.getBalance(assetSymbol);
      } catch (error) {
        // Ignore balance check errors - wallet might not support balance queries
      }
    }
    
    const negotiationCtx: NegotiationContext = {
      now_ms: askNow,
      intent_type: input.intentType,
      round: 1, // First round
      elapsed_ms: askNow - intentNowEstimate,
      message_type: "ASK",
      valid_for_ms: 20000,
      is_firm_quote: true,
      quote_price: askPrice,
      reference_price_p50: referenceP50,
      urgent: input.urgent || false,
      counterparty: {
        reputation: sellerReputation,
        age_ms: 1_000_000,
        region: provider.region ?? "us-east",
        has_required_credentials: hasAllCreds,
        failure_rate: 0,
        timeout_rate: 0,
        is_new: false,
      },
      // v2 Phase 2+: Wallet information for wallet-aware negotiation
      buyer_wallet_address: walletAddress,
      buyer_wallet_chain: walletChain,
      buyer_wallet_balance: buyerWalletBalance,
    };

    // Check negotiation phase (side-effect free, no session)
    const negotiationCheck = guard.check("negotiation", negotiationCtx, input.intentType);
    if (!negotiationCheck.ok) {
      // Log policy rejection
      // Check if it's an out-of-band rejection by checking if price is outside the band
      const isOutOfBand = askPrice > (referenceP50 * 1.5) || askPrice < (referenceP50 * 0.5);
      const code = (isOutOfBand ? "PROVIDER_QUOTE_OUT_OF_BAND" : "PROVIDER_QUOTE_POLICY_REJECTED") as DecisionCode;
      const reasonText = `Policy check failed: ${negotiationCheck.code}`;
      
      // Emit failure event for this provider evaluation
      await eventRunner.emitFailure(
        "provider_evaluation" as AcquisitionPhase,
        code,
        reasonText,
        isRetryableFailureCode(code), // false - not retryable (policy violation)
        {
          provider_id: provider.provider_id,
          provider_pubkey: providerPubkey,
          policy_check_code: negotiationCheck.code,
          quote_price: askPrice,
          reference_price_p50: referenceP50,
        },
        [createEvidence("provider_evaluation" as AcquisitionPhase, "negotiation_check", {
          provider_id: provider.provider_id,
          passed: false,
          reason: isOutOfBand ? "quote_out_of_band" : "quote_policy_rejected",
        })]
      );
      
      pushDecision(
        provider,
        "policy",
        false,
        code,
        reasonText,
        explainLevel === "full" ? {
          code: negotiationCheck.code,
          quote_price: askPrice,
          reference_price_p50: referenceP50,
          urgent: input.urgent || false,
        } : undefined
      );
      updateContender(provider.provider_id, false, code);
      continue; // Skip provider that fails negotiation check
    }
    
    // Provider passed all checks - count as eligible
    if (explain) {
      explain.providers_eligible = (explain.providers_eligible || 0) + 1;
    }
    // Mark contender as eligible
    updateContender(provider.provider_id, true);

    // Recompute reputation for utility calculation (V2 if enabled and credential verified, otherwise keep V1)
    if (store && input.useReputationV2 && credentialPresent) {
      // Use V2 scoring with credential context for utility calculation
      const trustScore = (provider as any)._trustScore || 0;
      const scoreV2 = agentScoreV2(providerPubkey, store.list({ agentId: providerPubkey }), {
        credentialPresent: true,
        credentialClaims,
        intentType: input.intentType,
        trustScore, // Pass trust score to reputation v2
      } as any);
      sellerReputation = scoreV2.reputation;
    }

    // Compute utility score (lower is better)
    // utility = price + 0.00000001 * latency_ms + 0.001 * failureRate - 0.000001 * reputation
    // Add trust-aware routing bonus: small monotonic bonus for higher tier/score
    // +0.02 for low tier, +0.05 for trusted tier, plus +0.02 * trust_score
    // This influences tie-breaks but doesn't dominate price/latency
    const trustScore = (provider as any)._trustScore || 0;
    const trustTier = (provider as any)._trustTier || "untrusted";
    let trustBonus = 0;
    if (trustTier === "trusted") {
      trustBonus = -0.05; // +0.05 bonus (negative because lower utility is better)
    } else if (trustTier === "low") {
      trustBonus = -0.02; // +0.02 bonus
    }
    trustBonus -= 0.02 * trustScore; // Additional score-based bonus
    const utility = askPrice +
      0.00000001 * latencyMs +
      0.001 * 0 - // failure_rate
      0.000001 * sellerReputation +
      trustBonus;

    evaluations.push({
      provider,
      providerPubkey,
      askPrice,
      utility,
      sellerReputation,
      hasRequiredCredentials: hasAllCreds,
      latencyMs,
    });
    
    // Emit success event for this provider evaluation (provider passed all checks)
    await eventRunner.emitSuccess(
      "provider_evaluation" as AcquisitionPhase,
      {
        provider_id: provider.provider_id,
        provider_pubkey: providerPubkey,
        ask_price: askPrice,
        utility: utility,
        seller_reputation: sellerReputation,
        has_required_credentials: hasAllCreds,
        latency_ms: latencyMs,
      },
      [createEvidence("provider_evaluation" as AcquisitionPhase, "provider_evaluation_result", {
        provider_id: provider.provider_id,
        passed_all_checks: true,
        ask_price: askPrice,
        utility: utility,
        seller_reputation: sellerReputation,
      })]
    );
  }

  // Select best quote (lowest utility)
  if (evaluations.length === 0) {
    // Choose highest priority failure code
    // Priority: UNTRUSTED_ISSUER > PROVIDER_SIGNATURE_INVALID > PROVIDER_SIGNER_MISMATCH > 
    //           PROVIDER_MISSING_REQUIRED_CREDENTIALS > PROVIDER_QUOTE_HTTP_ERROR > NO_ELIGIBLE_PROVIDERS
    let finalCode: string = "NO_ELIGIBLE_PROVIDERS";
    if (failureCodes.includes("PROVIDER_UNTRUSTED_ISSUER")) {
      finalCode = "UNTRUSTED_ISSUER";
    } else if (failureCodes.includes("PROVIDER_SIGNATURE_INVALID")) {
      finalCode = "PROVIDER_SIGNATURE_INVALID";
    } else if (failureCodes.includes("PROVIDER_SIGNER_MISMATCH")) {
      finalCode = "PROVIDER_SIGNER_MISMATCH";
    } else if (failureCodes.includes("PROVIDER_MISSING_REQUIRED_CREDENTIALS")) {
      finalCode = "PROVIDER_MISSING_REQUIRED_CREDENTIALS";
    } else if (failureCodes.includes("PROVIDER_QUOTE_HTTP_ERROR")) {
      finalCode = "PROVIDER_QUOTE_HTTP_ERROR";
    }
    
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
      explain.providers_eligible = 0;
      explain.log.push({
        provider_id: "",
        pubkey_b58: "",
        step: "selection",
        ok: false,
        code: "NO_ELIGIBLE_PROVIDERS" as DecisionCode,
        reason: "No providers passed all policy checks",
        ts_ms: nowFunction(),
      });
    }
    // Build and write transcript for error case
    if (saveTranscript && transcriptData) {
      // Generate intent_id for error case
      const errorIntentId = `error-${nowFunction()}`;
      transcriptData.intent_id = errorIntentId;
      transcriptData.explain = explain || undefined;
      transcriptData.outcome = {
        ok: false,
        code: finalCode,
        reason: finalCode === "UNTRUSTED_ISSUER" ? "All providers failed trusted issuer validation" : "No eligible providers",
      };
      
      // Finalize settlement lifecycle metadata for error case (v1.6.3+)
      if (transcriptData.settlement_lifecycle) {
        // If there were lifecycle errors, ensure status reflects that
        if (transcriptData.settlement_lifecycle.errors && transcriptData.settlement_lifecycle.errors.length > 0) {
          // Status may be set by error recording, but ensure it's consistent
          if (!transcriptData.settlement_lifecycle.status) {
            transcriptData.settlement_lifecycle.status = "aborted";
            transcriptData.settlement_lifecycle.aborted_at_ms = nowFn ? nowFn() : Date.now();
          }
        }
      }
      
      const transcriptStore = new TranscriptStore(input.transcriptDir);
      transcriptPath = await transcriptStore.writeTranscript(errorIntentId, transcriptData as TranscriptV1);
    }
    
    const errorResult: AcquireResult = {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
        offers_considered: candidates.length,
      },
      code: finalCode,
      reason: finalCode === "UNTRUSTED_ISSUER" ? "All providers failed trusted issuer validation" : "No eligible providers",
      offers_eligible: 0,
      ...(explain ? { explain } : {}),
      ...(transcriptPath ? { transcriptPath } : {}),
    };
    return errorResult;
  }

  evaluations.sort((a, b) => a.utility - b.utility);
  const bestQuote = evaluations[0];
  const primaryProviderId = bestQuote.provider.provider_id;
  
  // Build fallback plan from eligible candidates (B2)
  const orderedCandidates = buildFallbackPlan({
    candidates: evaluations.map(e => e.provider), // Use evaluated providers
    primaryProviderId,
  });
  
  // Create evaluation map for quick lookup by provider_id
  const evaluationMap = new Map<string, CandidateEvaluation>();
  for (const evaluation of evaluations) {
    evaluationMap.set(evaluation.provider.provider_id, evaluation);
  }
  
  // Initialize settlement_attempts array for transcript (B2)
  const settlementAttempts: Array<{
    idx: number;
    provider_pubkey: string;
    provider_id?: string;
    settlement_provider?: string;
    outcome: "success" | "failed";
    failure_code?: string;
    failure_reason?: string;
    timestamp_ms?: number;
  }> = [];
  
  // Fallback retry loop: attempt acquisition with each candidate in order (B2)
  let lastFailure: { code: string; reason: string } | undefined;
  
  // Variables to store final result values (defined outside loop for access after loop)
  let finalReceipt: Receipt | null = null;
  let finalVerification: {
    quoteVerified: boolean;
    signerMatched: boolean;
    commitVerified?: boolean;
    revealVerified?: boolean;
  } | undefined;
  let finalIntentId: string | undefined;
  let firstAttemptIntentId: string | undefined; // Track first attempt intentId for transcript when all fail
  let finalSelectedProvider: ProviderCandidate | undefined;
  let finalSelectedProviderPubkey: string | undefined;
  let finalSession: NegotiationSession | undefined; // v1.6.7+: Track session for SLA violations (D1)
  
  // Helper function to handle attempt failures with retry logic (B2)
  const handleAttemptFailure = (failureCode: string, failureReason: string, attemptEntry: typeof settlementAttempts[0]): "continue" | "return" => {
    // Record attempt failure
    attemptEntry.outcome = "failed";
    attemptEntry.failure_code = failureCode;
    attemptEntry.failure_reason = failureReason;
    attemptEntry.timestamp_ms = nowFunction();
    settlementAttempts.push(attemptEntry);
    
    lastFailure = { code: failureCode, reason: failureReason };
    
    // Check if retryable (centralized retry policy)
    if (!isRetryableFailureCode(failureCode)) {
      // Non-retryable failure - stop and return
  if (transcriptData) {
        transcriptData.settlement_attempts = settlementAttempts;
      }
      return "return";
    }
    
    // Retryable failure - continue to next candidate
    return "continue";
  };
  
  for (let attemptIdx = 0; attemptIdx < orderedCandidates.length; attemptIdx++) {
    const candidate = orderedCandidates[attemptIdx];
    const candidateEvaluation = evaluationMap.get(candidate.provider_id);
    
    if (!candidateEvaluation) {
      // Should not happen, but handle gracefully
      continue;
    }
    
    const selectedProvider = candidateEvaluation.provider;
    const selectedProviderPubkey = candidateEvaluation.providerPubkey;
    const selectedAskPrice = candidateEvaluation.askPrice;
    const attemptTimestamp = nowFunction();
    
    // Record winner deterministically (v1 contention semantics)
    if (attemptIdx === 0 && contention.winner === null) {
      contention.winner = {
        provider_id: selectedProvider.provider_id,
        pubkey_b58: selectedProviderPubkey,
      };
    }
    
    // Record attempt start (will update with outcome later)
    let attemptEntry: typeof settlementAttempts[0] = {
      idx: attemptIdx,
      provider_pubkey: selectedProviderPubkey,
      provider_id: selectedProvider.provider_id,
      outcome: "failed", // Default, will update if success
      timestamp_ms: attemptTimestamp,
    };
    
    try {
      // Collect selection for transcript (only on first attempt)
      if (attemptIdx === 0 && transcriptData) {
    transcriptData.selection = {
      selected_provider_id: selectedProvider.provider_id,
      selected_pubkey_b58: selectedProviderPubkey,
      reason: "Lowest utility score",
          utility_score: candidateEvaluation.utility,
      alternatives_considered: evaluations.length,
    };
    
    // Persist contention evidence into transcriptData (v1 contention semantics)
    if ((transcriptData as any).contention === undefined) {
      (transcriptData as any).contention = contention;
    }
  }
  
      // Log provider selection (only on first attempt for explain)
      if (attemptIdx === 0 && explain) {
    pushDecision(
      selectedProvider,
      "selection",
      true,
      "PROVIDER_SELECTED",
      `Selected provider with best utility score`,
      explainLevel === "full" ? {
            utility: candidateEvaluation.utility,
        price: selectedAskPrice,
            latency_ms: candidateEvaluation.latencyMs,
            reputation: candidateEvaluation.sellerReputation,
      } : undefined
    );
    explain.selected_provider_id = selectedProvider.provider_id;
  }
      
      // Apply policy-driven settlement provider routing if needed (B1)
      // Only apply if caller did NOT pass settlement instance AND input.settlement.provider is undefined
      let attemptSettlement: SettlementProvider | undefined = explicitSettlement;
      let settlementRoutingResult: { provider: string; matchedRuleIndex?: number; reason: string } | undefined;
      
      if (!attemptSettlement) {
        // Determine routing context from selected provider and negotiation state
        const routingAmount = selectedAskPrice; // Use selected quote price as amount estimate
        const routingMode = chosenMode;
        // Extract trust information from provider (set during evaluation phase)
        const providerTrustTier = (selectedProvider as any)._trustTier;
        const routingTrustTier: "untrusted" | "low" | "trusted" = 
          (providerTrustTier === "low" || providerTrustTier === "trusted") ? providerTrustTier : "untrusted";
        const routingTrustScore = (selectedProvider as any)._trustScore ?? 0;
        
        // Apply routing
        settlementRoutingResult = selectSettlementProvider(compiled, {
          amount: routingAmount,
          mode: routingMode,
          trustTier: routingTrustTier,
          trustScore: routingTrustScore,
        });
        
        // Create settlement provider based on routing result
        try {
          // Set input.settlement.provider so factory creates the chosen provider
          if (!input.settlement) {
            input.settlement = {};
          }
          input.settlement.provider = settlementRoutingResult.provider as "mock" | "stripe_like" | "external";
          
          attemptSettlement = createSettlementProvider({
            provider: settlementRoutingResult.provider as "mock" | "stripe_like" | "external",
            params: input.settlement.params,
            idempotency_key: input.settlement.idempotency_key,
          });
          
          // Record settlement provider in attempt entry
          attemptEntry.settlement_provider = settlementRoutingResult.provider;
          
          // Record routing decision in transcript (only on first attempt)
          if (attemptIdx === 0 && transcriptData) {
            if (!transcriptData.settlement_lifecycle) {
              transcriptData.settlement_lifecycle = {
                provider: settlementRoutingResult.provider,
                idempotency_key: input.settlement?.idempotency_key,
                errors: [],
              };
            } else {
              transcriptData.settlement_lifecycle.provider = settlementRoutingResult.provider;
            }
            // Store routing metadata (use validated/clamped values that were actually used for routing)
            (transcriptData.settlement_lifecycle as any).routing = {
              matched_rule_index: settlementRoutingResult.matchedRuleIndex,
              reason: settlementRoutingResult.reason,
              context: {
                amount: routingAmount, // Already validated (finite and non-negative) by routing function
                mode: routingMode,
                trust_tier: routingTrustTier, // Already validated (defaults to "untrusted" if invalid)
                trust_score: Math.max(0.0, Math.min(1.0, routingTrustScore)), // Clamp to [0.0, 1.0] to match routing function behavior
              },
            };
          }
        } catch (error: any) {
          // Handle factory creation errors - this is retryable
          const errorMsg = error?.message || String(error);
          const selectedProviderName = settlementRoutingResult?.provider ?? "unknown";
          const failureCode = "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED";
          const failureReason = `Settlement provider routing selected "${selectedProviderName}" but creation failed: ${errorMsg}`;
          
          // Record attempt failure using helper
          attemptEntry.settlement_provider = selectedProviderName;
          const action = handleAttemptFailure(failureCode, failureReason, attemptEntry);
          if (action === "return") {
            return {
              ok: false,
              code: failureCode,
              reason: failureReason,
              explain: explain || undefined,
            };
          }
          // continue to next candidate
          continue;
        }
      } else {
        // Explicit settlement provided - use it
        attemptEntry.settlement_provider = (attemptSettlement as any).providerType || "explicit";
      }
  
  // Track verification status for HTTP providers (for demo output)
  let verification: {
    quoteVerified: boolean;
    signerMatched: boolean;
    commitVerified?: boolean;
    revealVerified?: boolean;
  } | undefined;

  // 7) Resolve seller keypair using normalized pubkey
  // For HTTP providers, we don't need the seller keypair (they sign their own messages)
  // For local providers, use the provided keypair
  const selectedSellerKp = selectedProvider.endpoint 
    ? params.sellerKeyPair // HTTP providers don't need specific keypair mapping
    : (params.sellerKeyPairsByPubkeyB58?.[selectedProviderPubkey] ?? params.sellerKeyPair);

  // 8) Create NegotiationSession with selected provider's pubkey
  // v1.6.6+: Prepare split settlement config if enabled (B3)
  const splitEnabled = input.settlement?.split?.enabled === true && chosenMode === "hash_reveal";
  const session = new NegotiationSession({
    compiledPolicy: compiled,
    guard,
    now: nowFunction,
    role: "buyer",
    intentType: input.intentType,
        settlement: attemptSettlement, // Use attemptSettlement, not settlement
    buyerAgentId: buyerId,
    sellerAgentId: selectedProviderPubkey, // Use selected provider's pubkey
    // v2 Phase 2+: Chain and asset for settlement operations
    settlementChain: chainId,
    settlementAsset: assetSymbol ?? assetId,
    // v1.7.2+: Settlement lifecycle configuration
    settlementIdempotencyKey: input.settlement?.idempotency_key,
    settlementAutoPollMs: input.settlement?.auto_poll_ms,
    // v1.6.6+: Split settlement configuration (B3)
    settlementSplit: splitEnabled ? {
      enabled: true,
      max_segments: input.settlement?.split?.max_segments,
    } : undefined,
    settlementCandidates: splitEnabled ? orderedCandidates.map(c => ({
      provider_pubkey: evaluationMap.get(c.provider_id)?.providerPubkey || "",
      provider_id: c.provider_id,
      trust_tier: (c as any)._trustTier || "untrusted",
      trust_score: (c as any)._trustScore || 0,
    })) : undefined,
    createSettlementProvider: splitEnabled ? (provider: "mock" | "stripe_like" | "external", params?: Record<string, unknown>) => {
      return createSettlementProvider({
        provider,
        params: params || input.settlement?.params,
        idempotency_key: input.settlement?.idempotency_key,
      });
    } : undefined,
    selectSettlementProvider: splitEnabled ? (amount: number, mode: "hash_reveal" | "streaming", trustTier: "untrusted" | "low" | "trusted", trustScore: number) => {
      return selectSettlementProvider(compiled, {
        amount,
        mode,
        trustTier,
        trustScore,
      });
    } : undefined,
  });

  // 8.5) Check buyer identity (if policy requires it)
  const buyerCredentials = input.identity?.buyer?.credentials || [];
  const buyerIssuers = input.identity?.buyer?.issuer_ids || [];
  
  // v2 Phase 2+: Generate wallet proof for on-chain identity binding
  let walletProof: { signature: string; message: string; scheme: string } | undefined;
  if (walletAdapter && walletAddress && input.identity?.require_wallet_proof) {
    try {
      const { generateWalletProof } = await import("../wallets/proof");
      const proof = await generateWalletProof(walletAdapter, buyerId);
      walletProof = {
        signature: Buffer.from(proof.signature).toString("hex"),
        message: proof.message,
        scheme: proof.scheme,
      };
    } catch (error) {
      // Wallet proof generation failed - this is a non-retryable error if required
      if (input.identity?.require_wallet_proof) {
        const action = handleAttemptFailure("WALLET_PROOF_FAILED", `Failed to generate wallet proof: ${error}`, attemptEntry);
        if (action === "return") {
          return {
            ok: false,
            code: "WALLET_PROOF_FAILED",
            reason: `Failed to generate wallet proof: ${error}`,
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
          };
        }
      }
    }
  }
  
  const buyerIdentityCtx: IdentityContext = {
    agent_id: buyerId,
    credentials: [
      ...buyerCredentials.map(type => ({ type, issuer: buyerIssuers[0] || "default" })),
      ...buyerIssuers.map(issuer => ({ type: "verified", issuer })),
    ],
    is_new_agent: false,
    reputation: store ? (() => {
      const score = agentScore(buyerId, store.list({ agentId: buyerId }));
      return score.reputation;
    })() : 0.5,
    // v2 Phase 2+: Wallet information for on-chain identity binding
    wallet_address: walletAddress,
    wallet_chain: walletChain,
    wallet_proof: walletProof,
  };

  // Buyer identity check: only check non-credential requirements (reputation, region, etc.)
  // Credential requirements in counterparty section only apply to sellers
  const buyerIdentityCheck = guard.check("identity", buyerIdentityCtx);
  if (!buyerIdentityCheck.ok) {
    // For buyers, only fail on non-credential checks (reputation, region, etc.)
    // Credential requirements are for sellers only
    if (buyerIdentityCheck.code === "MISSING_REQUIRED_CREDENTIALS") {
      // Skip credential check for buyers - credentials are seller requirements
      // Only fail on other identity checks
    } else {
          // Buyer identity check failures are non-retryable (policy/trust issue)
          const action = handleAttemptFailure(buyerIdentityCheck.code, "Buyer identity check failed", attemptEntry);
          if (action === "return") {
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
        },
        code: buyerIdentityCheck.code,
        reason: "Buyer identity check failed",
              explain: explain || undefined,
      };
          }
          continue;
    }
  }

  // 9) Build and sign INTENT envelope
      const intentId = `intent-${nowFunction()}-${attemptIdx}`; // Add attemptIdx for uniqueness
      // Track first attempt intentId for transcript when all attempts fail
      if (attemptIdx === 0) {
        firstAttemptIntentId = intentId;
        // Update EventRunner with actual intent ID (for idempotency and transcript ordering)
        // Note: EventRunner context is read-only, but events will use the actual intent_id
        // We'll pass intent_id explicitly to emitEvent calls going forward
      }
  const intentNow = nowFunction();
  const intentMsg = {
    protocol_version: "pact/1.0" as const,
    type: "INTENT" as const,
    intent_id: intentId,
    intent: input.intentType,
    scope: input.scope,
    constraints: input.constraints,
    max_price: input.maxPrice,
    settlement_mode: (chosenMode === "streaming" ? "streaming" : "hash_reveal") as SettlementMode,
    urgent: input.urgent || false,
    sent_at_ms: intentNow,
    expires_at_ms: intentNow + 60000,
  };

  const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
  const intentResult = await session.openWithIntent(intentEnvelope);

  if (!intentResult.ok) {
        // INTENT failures are typically non-retryable (policy issues), but check anyway
        const action = handleAttemptFailure(intentResult.code, intentResult.reason || "Failed to open intent", attemptEntry);
        if (action === "return") {
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
    }
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
      },
      code: intentResult.code,
      reason: intentResult.reason || "Failed to open intent",
      ...(explain ? { explain } : {}),
    };
        }
        continue;
  }

  // Double-commit detection (PACT-331) - store-backed enforcement
  // Double-commit detection is store-backed; in-memory/no-store runs are considered stateless
  // and do not enforce cross-run exclusivity.
  // Only enforced when store is provided; skipped otherwise to support stateless/determinism tests.
  // This check must happen before any settlement operations (credits/balances) to prevent side effects.
  if (store) {
    const priorCommit = store.hasCommittedFingerprint(intentFingerprint);
    if (priorCommit) {
      const code = "PACT-331" as DecisionCode;
      const reason = `Double commit detected for intent. Prior transcript: ${priorCommit.transcriptId}`;
      
      // Emit failure event
      await eventRunner.emitFailure(
        "settlement" as AcquisitionPhase,
        code,
        reason,
        false, // terminal
        {
          intent_fingerprint: intentFingerprint,
          prior_transcript_id: priorCommit.transcriptId,
          prior_timestamp_ms: priorCommit.timestamp_ms,
        },
        [
          createEvidence("settlement" as AcquisitionPhase, "double_commit_detected", {
            intent_fingerprint: intentFingerprint,
            prior_transcript_id: priorCommit.transcriptId,
          }),
        ]
      );
      
      // Save failure transcript
      // Note: intent_fingerprint and failure_event are v4-only fields
      // For v1 transcripts, double-commit detection works at runtime via Store
      // but is not persisted in the transcript structure
      if (saveTranscript && transcriptData && input.transcriptDir) {
        // Use firstAttemptIntentId if available, otherwise generate a temporary ID
        const failureIntentId = firstAttemptIntentId || `intent-${nowFunction()}-double-commit`;
        transcriptPath = await saveTranscriptOnEarlyReturn(
          failureIntentId,
          code,
          reason,
          attemptEntry
        );
      }
      
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
        },
        code,
        reason,
        offers_eligible: evaluations.length,
        ...(explain ? { explain } : {}),
        ...(transcriptPath ? { transcriptPath } : {}),
      };
    }
  }

  // 10) Compute seller bond requirement deterministically from policy
  const bonding = compiled.base.economics.bonding;
  const sellerBondRequired = Math.max(
    bonding.seller_min_bond,
    selectedAskPrice * bonding.seller_bond_multiple
  );

      // 10.5) Ensure buyer and seller have enough balance (v1 simulation: top-up if needed)
      // This is needed especially when routing creates a new empty settlement provider
      try {
        // Credit buyer if needed (buyer needs balance to lock payment amount)
        // v2 Phase 2+: Pass chain/asset to settlement operations
        const buyerBal = attemptSettlement.getBalance(buyerId, chainId, assetSymbol ?? assetId);
        const paymentAmount = selectedAskPrice;
        const buyerBufferAmount = 0.1; // Buffer for tests/demo to ensure sufficient balance
        if (buyerBal < paymentAmount) {
          // v1: top-up buyer so lock can succeed during tests/demo
          attemptSettlement.credit(buyerId, paymentAmount - buyerBal + buyerBufferAmount, chainId, assetSymbol ?? assetId);
        }
        
        // Credit seller if needed (seller needs balance for bond)
        const sellerBal = attemptSettlement.getBalance(selectedProviderPubkey, chainId, assetSymbol ?? assetId);
  if (sellerBal < sellerBondRequired) {
    // v1: top-up seller so lockBond can succeed during tests/demo
          attemptSettlement.credit(selectedProviderPubkey, sellerBondRequired - sellerBal, chainId, assetSymbol ?? assetId);
    }
  } catch (error: any) {
    // Handle settlement provider errors (e.g., ExternalSettlementProvider NotImplemented)
    const errorMsg = error?.message || String(error);
    if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
          const failureCode = "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED";
          const failureReason = `Settlement operation (credit) failed: ${errorMsg}`;
          
          // Record attempt failure using helper
          const action = handleAttemptFailure(failureCode, failureReason, attemptEntry);
          if (action === "return") {
      return {
        ok: false,
              code: failureCode,
              reason: failureReason,
        explain: explain || undefined,
      };
          }
          // continue to next candidate
          continue;
    }
    // Re-throw other errors
    throw error;
  }

  // 11) Build and sign ASK envelope for selected provider
  // For HTTP providers, extract quote data from verified envelope and create new ASK with correct intent_id
  // For local providers, sign a new ASK message
      const askNow = nowFunction(); // Define askNow inside loop
  let askEnvelope;
  if (selectedProvider.endpoint) {
    // HTTP provider: extract quote data from verified envelope and create new ASK
    if ((selectedProvider as any)._verifiedAskEnvelope) {
      const verifiedEnvelope = (selectedProvider as any)._verifiedAskEnvelope;
      
      // Track verification status for HTTP provider
      try {
        const quoteVerified = verifyEnvelope(verifiedEnvelope);
        const parsed = await parseEnvelope(verifiedEnvelope);
        const signerMatched = parsed.signer_public_key_b58 === selectedProviderPubkey;
        
        verification = {
          quoteVerified,
          signerMatched,
        };
        
        // Extract quote data from verified envelope and create new ASK with correct intent_id
        // This ensures the envelope is properly signed and the intent_id matches the session
        if (parsed.message.type !== "ASK") {
          throw new Error(`Expected ASK message, got ${parsed.message.type}`);
        }
        const askMsg = {
          protocol_version: "pact/1.0" as const,
          type: "ASK" as const,
          intent_id: intentId, // Use session's intent_id
          price: parsed.message.price, // Use price from verified quote
          unit: parsed.message.unit ?? "request" as const,
          latency_ms: parsed.message.latency_ms,
          valid_for_ms: parsed.message.valid_for_ms ?? 20000,
          bond_required: sellerBondRequired,
          sent_at_ms: askNow,
          expires_at_ms: askNow + (parsed.message.valid_for_ms ?? 20000),
        };
        // Sign with seller keypair (ASK messages are signed by the seller)
        askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
      } catch (error) {
        // If verification fails, still track it
        verification = {
          quoteVerified: false,
          signerMatched: false,
        };
        
        // Fall back to using selectedAskPrice
        const askMsg = {
          protocol_version: "pact/1.0" as const,
          type: "ASK" as const,
          intent_id: intentId,
          price: selectedAskPrice,
          unit: "request" as const,
              latency_ms: candidateEvaluation.latencyMs, // Use candidateEvaluation instead of bestQuote
          valid_for_ms: 20000,
          bond_required: sellerBondRequired,
          sent_at_ms: askNow,
          expires_at_ms: askNow + 20000,
        };
        askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
      }
    } else {
      // HTTP provider but no pre-verified envelope (edge case - shouldn't normally happen)
      // Still track that we attempted HTTP provider verification
      verification = {
        quoteVerified: false,
        signerMatched: false,
      };
      
      // Fall back to signing locally
      const askMsg = {
        protocol_version: "pact/1.0" as const,
        type: "ASK" as const,
        intent_id: intentId,
        price: selectedAskPrice,
        unit: "request" as const,
            latency_ms: candidateEvaluation.latencyMs, // Use candidateEvaluation instead of bestQuote
        valid_for_ms: 20000,
        bond_required: sellerBondRequired,
        sent_at_ms: askNow,
        expires_at_ms: askNow + 20000,
        // v2 Phase 2+: Wallet information for wallet-aware negotiation
        seller_wallet_address: undefined, // Seller wallet not available in buyer-initiated flow
        seller_wallet_chain: undefined,
      };
      askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
    }
  } else {
    // Local provider: sign a new ASK message
    const askMsg = {
      protocol_version: "pact/1.0" as const,
      type: "ASK" as const,
      intent_id: intentId,
      price: selectedAskPrice,
      unit: "request" as const,
          latency_ms: candidateEvaluation.latencyMs, // Use candidateEvaluation instead of bestQuote
      valid_for_ms: 20000,
      bond_required: sellerBondRequired,
      sent_at_ms: askNow,
      // v2 Phase 2+: Wallet information for wallet-aware negotiation
      seller_wallet_address: undefined, // Seller wallet not available in buyer-initiated flow
      seller_wallet_chain: undefined,
      expires_at_ms: askNow + 20000,
    };
    askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
    // verification remains undefined for local providers
  }
  const counterpartySummary = {
    agent_id: selectedProviderPubkey,
        reputation: candidateEvaluation.sellerReputation, // Use candidateEvaluation instead of bestQuote
    age_ms: 1_000_000,
    region: selectedProvider.region ?? "us-east",
    failure_rate: 0,
    timeout_rate: 0,
    is_new: false,
  };

  const askResult = await session.onQuote(askEnvelope, counterpartySummary, referenceP50);
  if (!askResult.ok) {
        // ASK rejection failures are typically non-retryable (policy issues), but check anyway
        const action = handleAttemptFailure(askResult.code, askResult.reason || "ASK rejected by policy", attemptEntry);
        if (action === "return") {
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
      pushDecision(
        selectedProvider,
        "policy",
        false,
        "PROVIDER_QUOTE_POLICY_REJECTED",
        askResult.reason || "ASK rejected by policy",
        explainLevel === "full" ? { code: askResult.code } : undefined
      );
    }
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
        offers_considered: evaluations.length,
      },
      code: askResult.code,
      reason: askResult.reason || "ASK rejected",
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
    };
        }
        continue;
  }

  // 6.5) Negotiate price using negotiation strategy (v2.1+)
  const negotiationStrategyName = input.negotiation?.strategy ?? "baseline";
  let negotiationStrategy: NegotiationStrategy;
  if (negotiationStrategyName === "baseline") {
    negotiationStrategy = new BaselineNegotiationStrategy();
  } else if (negotiationStrategyName === "banded_concession") {
    negotiationStrategy = new BandedConcessionStrategy();
  } else if (negotiationStrategyName === "aggressive_if_urgent") {
    negotiationStrategy = new AggressiveIfUrgentStrategy();
  } else if (negotiationStrategyName === "ml_stub") {
    negotiationStrategy = new MLNegotiationStrategy(input.negotiation?.params);
  } else {
    // Default to baseline for unknown strategies
    negotiationStrategy = new BaselineNegotiationStrategy();
  }

  // Emit NEGOTIATION_START event
  const effectiveMaxRounds = input.negotiation?.params?.max_rounds as number | undefined ?? plan.maxRounds;
  await eventRunner.emitProgress(
    "negotiation" as AcquisitionPhase,
    0.0,
    "NEGOTIATION_START",
    {
      event_name: "NEGOTIATION_START",
      custom_event_id: `negotiation:start:${intentId}`,
      intent_type: input.intentType,
      max_rounds: effectiveMaxRounds,
      regime: plan.regime,
      settlement_mode: chosenMode,
      strategy: negotiationStrategyName,
    }
  );

  // For negotiated regime, run negotiation rounds loop (v2.3+)
  let negotiationResult: NegotiationResult | undefined;
  let negotiationRounds: Array<{
    round: number;
    ask_price: number;
    counter_price: number;
    accepted: boolean;
    reason: string;
    timestamp_ms: number;
    strategy_id?: string; // Strategy used for this round (v2.3.1+)
  }> = [];
  
  if ((plan.regime === "negotiated" || negotiationStrategyName === "ml_stub") && (negotiationStrategyName === "banded_concession" || negotiationStrategyName === "aggressive_if_urgent" || negotiationStrategyName === "ml_stub")) {
    // Run negotiation rounds for negotiated regime with banded_concession
    const bandPct = input.negotiation?.params?.band_pct as number | undefined ?? 0.1;
    
    let accepted = false;
    let finalAgreedPrice = selectedAskPrice;
    
    for (let round = 1; round <= effectiveMaxRounds && !accepted; round++) {
      const roundTime = nowFunction();
      
      // Emit NEGOTIATION_ROUND event before round execution
      await eventRunner.emitProgress(
        "negotiation" as AcquisitionPhase,
        round / effectiveMaxRounds,
        "NEGOTIATION_ROUND",
        {
          event_name: "NEGOTIATION_ROUND",
          custom_event_id: `negotiation:round:${intentId}:${round - 1}`,
          round_index: round - 1,
        }
      );
      
      // Call negotiation strategy for this round
      const roundInput = {
        intent_type: input.intentType,
        buyer_id: buyerId,
        provider_id: selectedProvider.provider_id || selectedProviderPubkey,
        reference_price: referenceP50,
        quote_price: selectedAskPrice, // Reuse initial ask
        max_price: input.maxPrice,
        band_pct: bandPct,
        max_rounds: effectiveMaxRounds,
        max_total_duration_ms: input.negotiation?.params?.max_total_duration_ms as number | undefined,
        urgent: input.urgent,
        current_round: round,
        allow_band_override: input.urgent,
      };
      
      const roundResult = await negotiationStrategy.negotiate(roundInput);
      
      const counterPrice = roundResult.counter_price ?? roundResult.agreed_price;
      const roundAccepted = counterPrice >= selectedAskPrice;
      
      // Record round evidence after round execution
      await eventRunner.emitProgress(
        "negotiation" as AcquisitionPhase,
        round / effectiveMaxRounds,
        "NEGOTIATION_ROUND_COMPLETE",
        {
          event_name: "NEGOTIATION_ROUND",
          custom_event_id: `negotiation:round:${intentId}:${round - 1}`,
          round_index: round - 1,
          msg_type: roundAccepted ? "ACCEPT" : "COUNTER",
          actor: "buyer",
          price: counterPrice,
          decision_code: roundAccepted ? "ACCEPTED" : "COUNTER",
          accepted: roundAccepted,
        },
        [createEvidence("negotiation" as AcquisitionPhase, "negotiation_round", {
          round: round - 1,
          ask_price: selectedAskPrice,
          counter_price: counterPrice,
          accepted: roundAccepted,
          timestamp_ms: roundTime,
        })]
      );
      
      // Record round
      negotiationRounds.push({
        round,
        ask_price: selectedAskPrice,
        counter_price: counterPrice,
        accepted: roundAccepted,
        reason: roundResult.reason || (roundAccepted ? "Counter accepted" : `Round ${round} counteroffer`),
        timestamp_ms: roundTime,
        strategy_id: negotiationStrategyName, // Record which strategy was used (v2.3.1+)
      });
      
      if (roundAccepted) {
        accepted = true;
        finalAgreedPrice = selectedAskPrice; // Use ask price when accepted
        negotiationResult = roundResult;
        break;
      }
      
      // If this is the last round and not accepted, use the result
      if (round === effectiveMaxRounds) {
        negotiationResult = roundResult;
        finalAgreedPrice = counterPrice;
      }
    }
    
    if (!accepted && negotiationRounds.length === 0) {
      // No rounds executed - fall back to single negotiation
      const fallbackInput = {
        intent_type: input.intentType,
        buyer_id: buyerId,
        provider_id: selectedProvider.provider_id || selectedProviderPubkey,
        reference_price: referenceP50,
        quote_price: selectedAskPrice,
        max_price: input.maxPrice,
        band_pct: bandPct,
        max_rounds: effectiveMaxRounds,
        max_total_duration_ms: input.negotiation?.params?.max_total_duration_ms as number | undefined,
        urgent: input.urgent,
        allow_band_override: input.urgent,
      };
      negotiationResult = await negotiationStrategy.negotiate(fallbackInput);
      finalAgreedPrice = negotiationResult.agreed_price;
    }
    
    // Ensure negotiationResult is set
    if (!negotiationResult) {
      // Fallback: create a result from the last round
      const lastRound = negotiationRounds[negotiationRounds.length - 1];
      negotiationResult = {
        ok: lastRound?.accepted ?? false,
        agreed_price: lastRound?.accepted ? selectedAskPrice : (lastRound?.counter_price ?? selectedAskPrice),
        rounds_used: negotiationRounds.length,
        log: [],
        counter_price: lastRound?.counter_price,
        within_band: true,
        used_override: false,
        reason: lastRound?.accepted ? undefined : "Negotiation did not reach agreement",
      };
    }
  } else {
    // Non-negotiated regime or baseline strategy - single negotiation call
    const negotiationInput = {
      intent_type: input.intentType,
      buyer_id: buyerId,
      provider_id: selectedProvider.provider_id || selectedProviderPubkey,
      reference_price: referenceP50,
      quote_price: selectedAskPrice,
      max_price: input.maxPrice,
      band_pct: input.negotiation?.params?.band_pct as number | undefined,
      max_rounds: input.negotiation?.params?.max_rounds as number | undefined,
      max_total_duration_ms: input.negotiation?.params?.max_total_duration_ms as number | undefined,
      urgent: input.urgent,
      allow_band_override: input.urgent,
    };

    // Emit single round event for baseline/non-negotiated
    await eventRunner.emitProgress(
      "negotiation" as AcquisitionPhase,
      0.5,
      "NEGOTIATION_ROUND",
      {
        event_name: "NEGOTIATION_ROUND",
        custom_event_id: `negotiation:round:${intentId}:0`,
        round_index: 0,
      }
    );

    negotiationResult = await negotiationStrategy.negotiate(negotiationInput);
  }

  // Emit NEGOTIATION_END event
  if (!negotiationResult || !negotiationResult.ok) {
    // Negotiation failed - emit failure event
    await eventRunner.emitFailure(
      "negotiation" as AcquisitionPhase,
      "NEGOTIATION_FAILED",
      negotiationResult?.reason || "Negotiation failed",
      isRetryableFailureCode("NEGOTIATION_FAILED"),
      {
        event_name: "NEGOTIATION_END",
        custom_event_id: `negotiation:end:${intentId}`,
        outcome_code: "NEGOTIATION_FAILED",
        rounds_used: negotiationResult?.rounds_used ?? 0,
        agreed_price: null,
      },
      negotiationRounds.length > 0 ? [createEvidence("negotiation" as AcquisitionPhase, "negotiation_summary", {
        rounds_used: negotiationRounds.length,
        strategy: negotiationStrategyName,
      })] : undefined
    );

    // Negotiation failed - treat as non-retryable failure
    const action = handleAttemptFailure(
      "NEGOTIATION_FAILED",
      negotiationResult?.reason || "Negotiation failed",
      attemptEntry
    );
    if (action === "return") {
      if (explain) {
        explain.regime = plan.regime;
        explain.settlement = chosenMode;
        explain.fanout = plan.fanout;
        pushDecision(
          selectedProvider,
          "policy",
          false,
          "PROVIDER_QUOTE_POLICY_REJECTED",
          negotiationResult?.reason || "Negotiation failed",
          explainLevel === "full" ? { rounds_used: negotiationResult?.rounds_used } : undefined
        );
      }
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
          offers_considered: evaluations.length,
        },
        code: "NEGOTIATION_FAILED",
        reason: negotiationResult?.reason || "Negotiation failed",
        offers_eligible: evaluations.length,
        ...(explain ? { explain } : {}),
      };
    }
    continue;
  }

  // Negotiation succeeded - emit success event
  // Use negotiated price (for negotiated regime with rounds, this is the accepted ask price or final counter)
  const negotiatedPrice = (plan.regime === "negotiated" || negotiationStrategyName === "ml_stub") && (negotiationStrategyName === "banded_concession" || negotiationStrategyName === "aggressive_if_urgent" || negotiationStrategyName === "ml_stub") && negotiationRounds.length > 0
    ? (negotiationRounds[negotiationRounds.length - 1].accepted ? selectedAskPrice : negotiationRounds[negotiationRounds.length - 1].counter_price)
    : (negotiationResult?.agreed_price ?? selectedAskPrice);

  await eventRunner.emitSuccess(
    "negotiation" as AcquisitionPhase,
    {
      event_name: "NEGOTIATION_END",
      custom_event_id: `negotiation:end:${intentId}`,
      outcome_code: "ACCEPT",
      rounds_used: negotiationResult.rounds_used,
      agreed_price: negotiatedPrice,
    },
    [createEvidence("negotiation" as AcquisitionPhase, "negotiation_summary", {
      strategy: negotiationStrategyName,
      rounds_used: negotiationResult.rounds_used,
      agreed_price: negotiatedPrice,
      rounds: negotiationRounds,
    })]
  );

  // Record negotiation in transcript
  if (transcriptData && negotiationResult) {
    // Get ML metadata (captured during rounds or from strategy)
    let mlMetadata: { scorer: string; selected_candidate_idx: number; top_scores?: Array<{idx: number; score: number; reason?: string}> } | undefined;
    if (negotiationStrategyName === "ml_stub") {
      if (negotiationStrategy instanceof MLNegotiationStrategy) {
        mlMetadata = negotiationStrategy.getMLMetadata() || undefined;
      }
    }
    
    transcriptData.negotiation = {
      strategy: negotiationStrategyName,
      rounds_used: negotiationResult.rounds_used,
      log: negotiationResult.log.map(entry => ({
        round: entry.round,
        timestamp_ms: entry.timestamp_ms,
        decision: {
          type: entry.decision.type,
          quote_price: "quote_price" in entry.decision ? entry.decision.quote_price : undefined,
          max_price: "max_price" in entry.decision ? entry.decision.max_price : undefined,
          buyer_price: "buyer_price" in entry.decision ? entry.decision.buyer_price : undefined,
          provider_price: "provider_price" in entry.decision ? entry.decision.provider_price : undefined,
          price: "price" in entry.decision ? entry.decision.price : undefined,
          final_price: "final_price" in entry.decision ? entry.decision.final_price : undefined,
          reason: "reason" in entry.decision ? entry.decision.reason : undefined,
        },
      })),
      ...(mlMetadata ? { ml: mlMetadata } : {}),
    };
    
    // Record negotiation rounds detail (v2.3+)
    if (negotiationRounds.length > 0) {
      transcriptData.negotiation_rounds = negotiationRounds;
    }
  }

  // 7) Build and sign ACCEPT envelope
  const acceptNow = nowFunction();
  const acceptMsg = {
    protocol_version: "pact/1.0" as const,
    type: "ACCEPT" as const,
    intent_id: intentId,
    agreed_price: negotiatedPrice,
    settlement_mode: (chosenMode === "streaming" ? "streaming" : "hash_reveal") as SettlementMode,
    proof_type: (chosenMode === "streaming" ? "streaming" : "hash_reveal") as SettlementMode,
    challenge_window_ms: 150,
    delivery_deadline_ms: acceptNow + 30000, // 30 seconds to allow for commit/reveal process
    sent_at_ms: acceptNow,
    expires_at_ms: acceptNow + 10000,
    // v2 Phase 2+: Wallet information for wallet-aware negotiation and Phase 3 locking
    buyer_wallet_address: walletAddress,
    buyer_wallet_chain: walletChain,
    seller_wallet_address: undefined, // Seller wallet not available in buyer-initiated flow
    seller_wallet_chain: undefined,
  };

  const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
  const acceptResult = await session.accept(acceptEnvelope);
      if (!acceptResult.ok) {
        // ACCEPT failures (settlement failures) are retryable
        const action = handleAttemptFailure(acceptResult.code, acceptResult.reason || "ACCEPT failed", attemptEntry);
        
        // For SETTLEMENT_POLL_TIMEOUT, get handle_id from session BEFORE it gets aborted
        // (The session will abort the handle when poll times out, so we need to capture it now)
        if ((acceptResult.code as string) === "SETTLEMENT_POLL_TIMEOUT" && transcriptData?.settlement_lifecycle && !transcriptData.settlement_lifecycle.handle_id) {
          try {
            const sessionAny = session as any;
            if (sessionAny.settlementHandle?.handle_id) {
              transcriptData.settlement_lifecycle.handle_id = sessionAny.settlementHandle.handle_id;
            }
          } catch (e) {
            // Ignore - handle_id might not be accessible
          }
        }
        
        // Record settlement lifecycle failure (v1.7.2+) if applicable
        if (acceptResult.code === "SETTLEMENT_FAILED" && transcriptData?.settlement_lifecycle) {
          recordLifecycleEvent("poll", "failed", {
            failure_code: acceptResult.code,
            failure_reason: acceptResult.reason || "Settlement failed during async processing",
          });
        }
        
        if (action === "return") {
          if (explain) {
            explain.regime = plan.regime;
            explain.settlement = chosenMode;
            explain.fanout = plan.fanout;
            pushDecision(
              selectedProvider,
              "settlement",
              false,
              "SETTLEMENT_FAILED",
              acceptResult.reason || "ACCEPT failed",
              explainLevel === "full" ? { code: acceptResult.code } : undefined
            );
          }
          
          // Save transcript for non-retryable ACCEPT failure (v1.7.2+)
          // For SETTLEMENT_POLL_TIMEOUT, try to get handle_id from session's settlementHandle
          let handleIdForTimeout: string | undefined;
          if (acceptResult.code === "SETTLEMENT_POLL_TIMEOUT" as any) {
            try {
              const sessionAny = session as any;
              if (sessionAny.settlementHandle?.handle_id) {
                handleIdForTimeout = sessionAny.settlementHandle.handle_id;
              }
            } catch (e) {
              // Ignore - handle_id might not be accessible
            }
          }
          transcriptPath = await saveTranscriptOnEarlyReturn(
            intentId,
            acceptResult.code,
            acceptResult.reason || "ACCEPT failed",
            attemptEntry,
            handleIdForTimeout
          );
          
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: acceptResult.code,
            reason: acceptResult.reason || "ACCEPT failed",
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
            ...(transcriptPath ? { transcriptPath } : {}),
          };
        }
        continue;
      }

  const agreement = session.getAgreement();
  if (!agreement) {
        // NO_AGREEMENT is typically non-retryable (protocol error), but check anyway
        const action = handleAttemptFailure("NO_AGREEMENT", "No agreement found after ACCEPT", attemptEntry);
        if (action === "return") {
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
      },
      code: "NO_AGREEMENT",
      reason: "No agreement found after ACCEPT",
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
    };
        }
        continue;
  }

  // v1.6.6+: Record split settlement segments if enabled (B3)
  if (splitEnabled && transcriptData) {
    const segments = session.getSettlementSegments();
    const totalPaid = session.getSplitTotalPaid();
    
    if (segments.length > 0) {
      transcriptData.settlement_segments = segments;
      transcriptData.settlement_split_summary = {
        enabled: true,
        target_amount: negotiatedPrice,
        total_paid: totalPaid,
        segments_used: segments.filter(s => s.status === "committed").length,
      };
    }
  }

  // v1.6.7+: Record settlement SLA violations if any (D1)
  if (transcriptData) {
    const violations = session.getSettlementSLAViolations();
    const slaConfig = compiled.base.settlement?.settlement_sla;
    
    if (violations.length > 0 || slaConfig) {
      transcriptData.settlement_sla = {
        enabled: slaConfig?.enabled || false,
        max_pending_ms: slaConfig?.max_pending_ms,
        max_poll_attempts: slaConfig?.max_poll_attempts,
        poll_interval_ms: slaConfig?.poll_interval_ms,
        violations: violations.length > 0 ? violations : undefined,
      };
      
      // v1.6.7+: Apply minimal reputation penalty if enabled (D1)
      if (slaConfig?.penalty?.enabled && violations.length > 0 && store) {
        // Record penalty receipts for each violation (minimal hook)
        for (const violation of violations) {
          const penaltyReceipt = createReceipt({
            intent_id: finalIntentId || `intent-${nowFunction()}-sla-penalty`,
            buyer_agent_id: buyerId,
            seller_agent_id: finalSelectedProviderPubkey || "unknown",
            agreed_price: 0, // Zero paid amount for penalty
            fulfilled: false,
            timestamp_ms: violation.ts_ms,
            failure_code: "SETTLEMENT_SLA_VIOLATION",
            paid_amount: 0,
            asset_id: assetId,
            chain_id: chainId,
          });
          (penaltyReceipt as any).intent_type = input.intentType;
          store.ingest(penaltyReceipt);
        }
      }
    }
  }

  // 8) Execute settlement
  let receipt: Receipt | null = null;
  
  // Log settlement start
  if (explain) {
    pushDecision(
      selectedProvider,
      "settlement",
      true,
      "SETTLEMENT_STARTED",
      `Starting ${chosenMode} settlement`,
      explainLevel === "full" ? { settlement_mode: chosenMode } : undefined
    );
  }

      if (chosenMode === "hash_reveal") {
    // Settlement exclusivity guard (v1 contention semantics)
    // Enforce that only the selected provider can settle
    if (contention.winner && selectedProviderPubkey !== contention.winner.pubkey_b58) {
      const code = "PACT-330" as DecisionCode;
      const reason = `Contention exclusivity violated: attempted settlement with non-selected provider. Selected: ${contention.winner.provider_id}, Attempted: ${selectedProvider.provider_id}`;
      
      // Emit failure event
      await eventRunner.emitFailure(
        "settlement" as AcquisitionPhase,
        code,
        reason,
        false, // terminal
        {
          selected_provider_id: contention.winner.provider_id,
          selected_pubkey_b58: contention.winner.pubkey_b58,
          attempted_provider_id: selectedProvider.provider_id,
          attempted_pubkey_b58: selectedProviderPubkey,
        },
        [
          createEvidence("settlement" as AcquisitionPhase, "contention_exclusivity_violation", {
            winner_provider_id: contention.winner.provider_id,
            attempted_provider_id: selectedProvider.provider_id,
          }),
        ]
      );
      
      // Return terminal failure
      return {
        ok: false,
        plan,
        code,
        reason,
        offers_eligible: evaluations.length,
        ...(explain ? { explain } : {}),
        ...(transcriptPath ? { transcriptPath } : {}),
      };
    }
    
    // Emit SETTLEMENT_START event
    await eventRunner.emitProgress(
      "settlement" as AcquisitionPhase,
      0.0,
      "SETTLEMENT_START",
      {
        event_name: "SETTLEMENT_START",
        custom_event_id: `settlement:start:${intentId}`,
        mode: "hash_reveal",
        asset: assetSymbol ?? assetId,
        chain: chainId,
      }
    );

    // Hash-reveal settlement
    const commitNow = nowFunction();
    const payload = JSON.stringify({ data: "delivered", scope: input.scope });
    const nonce = Buffer.from(`nonce-${commitNow}`).toString("base64");
    const payloadB64 = Buffer.from(payload).toString("base64");
    
    // Emit SETTLEMENT_PREPARE event
    await eventRunner.emitProgress(
      "settlement" as AcquisitionPhase,
      0.1,
      "SETTLEMENT_PREPARE",
      {
        event_name: "SETTLEMENT_PREPARE",
        custom_event_id: `settlement:prepare:${intentId}`,
        mode: "hash_reveal",
        provider_id: selectedProvider.provider_id || selectedProviderPubkey,
        price: negotiatedPrice,
        prepared: true,
      },
      [createEvidence("settlement" as AcquisitionPhase, "settlement_prepare", {
        provider_id: selectedProvider.provider_id || selectedProviderPubkey,
        price: negotiatedPrice,
        mode: "hash_reveal",
      })]
    );
    
    let commitHash: string;
    let revealOk: boolean = false;
    let commitAttemptIndex = 0;
    let revealAttemptIndex = 0;
    
      if (selectedProvider.endpoint) {
      // HTTP provider: use /commit and /reveal endpoints (signed envelopes)
      try {
        // Call /commit endpoint to get signed COMMIT envelope
        const commitResponse = await fetchCommit(selectedProvider.endpoint, {
          intent_id: intentId,
          payload_b64: payloadB64,
          nonce_b64: nonce,
        });

        // Verify COMMIT envelope signature (synchronous)
        const commitVerified = verifyEnvelope(commitResponse.envelope);
        if (!commitVerified) {
          throw new Error("Invalid COMMIT envelope signature");
        }

        // Parse COMMIT envelope (async)
        const parsedCommit = await parseEnvelope(commitResponse.envelope);
        
        // Track commit verification status (will update reveal later)
        if (verification) {
          verification.commitVerified = commitVerified;
        }
        
        // Know Your Agent: verify signer matches provider pubkey
        if (parsedCommit.signer_public_key_b58 !== selectedProviderPubkey) {
          throw new Error("COMMIT envelope signer doesn't match provider pubkey");
        }

        if (parsedCommit.message.type !== "COMMIT") {
          throw new Error("Invalid COMMIT message type");
        }

        commitHash = parsedCommit.message.commit_hash_hex;
        
        // Emit SETTLEMENT_COMMIT_ATTEMPT event
        const commitAttemptId = `settlement:commit:${intentId}:${commitAttemptIndex}`;
        await eventRunner.emitProgress(
          "settlement" as AcquisitionPhase,
          0.3 + (commitAttemptIndex * 0.1),
          "SETTLEMENT_COMMIT_ATTEMPT",
          {
            event_name: "SETTLEMENT_COMMIT_ATTEMPT",
            custom_event_id: commitAttemptId,
            attempt: commitAttemptIndex,
          }
        );
        
        // Feed verified COMMIT envelope into session
        const commitResult = await session.onCommit(commitResponse.envelope as SignedEnvelope<CommitMessage>);
        
        if (!commitResult.ok) {
          // COMMIT failures are retryable (SETTLEMENT_FAILED)
          const action = handleAttemptFailure(commitResult.code, commitResult.reason || "COMMIT failed", attemptEntry);
          if (action === "return") {
            if (explain) {
              pushDecision(
                selectedProvider,
                "settlement",
                false,
                "SETTLEMENT_FAILED",
                commitResult.reason || "COMMIT failed",
                explainLevel === "full" ? { code: commitResult.code } : undefined
              );
            }
            
            // Record settlement lifecycle failure if applicable
            if (commitResult.code === "SETTLEMENT_FAILED" && transcriptData?.settlement_lifecycle) {
              recordLifecycleEvent("commit", "failed", {
                failure_code: commitResult.code,
                failure_reason: commitResult.reason || "COMMIT failed",
              });
            }
            
            // Emit SETTLEMENT_FAIL event before returning
            await eventRunner.emitFailure(
              "settlement" as AcquisitionPhase,
              commitResult.code,
              commitResult.reason || "COMMIT failed",
              isRetryableFailureCode(commitResult.code),
              {
                event_name: "SETTLEMENT_FAIL",
                custom_event_id: `settlement:fail:${intentId}`,
                mode: "hash_reveal",
                code: commitResult.code,
              }
            );
            
            // Save transcript for non-retryable COMMIT failure (v1.7.2+)
            transcriptPath = await saveTranscriptOnEarlyReturn(
              intentId,
              commitResult.code,
              commitResult.reason || "COMMIT failed",
              attemptEntry
            );
            
            return {
              ok: false,
              plan: {
                ...plan,
                overrideActive,
              },
              code: commitResult.code,
              reason: commitResult.reason || "COMMIT failed",
              offers_eligible: evaluations.length,
              ...(explain ? { explain } : {}),
              ...(transcriptPath ? { transcriptPath } : {}),
            };
          }
          // Retryable - continue to next candidate (will be caught by outer catch)
          throw new Error(`COMMIT failed: ${commitResult.reason || commitResult.code}`); // Will be caught by outer catch
        }
        
        // Emit SETTLEMENT_REVEAL_ATTEMPT event
        const revealAttemptId = `settlement:reveal:${intentId}:${revealAttemptIndex}`;
        await eventRunner.emitProgress(
          "settlement" as AcquisitionPhase,
          0.6 + (revealAttemptIndex * 0.1),
          "SETTLEMENT_REVEAL_ATTEMPT",
          {
            event_name: "SETTLEMENT_REVEAL_ATTEMPT",
            custom_event_id: revealAttemptId,
            attempt: revealAttemptIndex,
          }
        );
        
        // Call /reveal endpoint to get signed REVEAL envelope
        const revealResponse = await fetchReveal(selectedProvider.endpoint, {
          intent_id: intentId,
          payload_b64: payloadB64,
          nonce_b64: nonce,
          commit_hash_hex: commitHash,
        });

        // Verify REVEAL envelope signature (synchronous)
        const revealVerified = verifyEnvelope(revealResponse.envelope);
        if (!revealVerified) {
          throw new Error("Invalid REVEAL envelope signature");
        }

        // Parse REVEAL envelope (async)
        const parsedReveal = await parseEnvelope(revealResponse.envelope);
        
        // Know Your Agent: verify signer matches provider pubkey
        if (parsedReveal.signer_public_key_b58 !== selectedProviderPubkey) {
          throw new Error("REVEAL envelope signer doesn't match provider pubkey");
        }

        if (parsedReveal.message.type !== "REVEAL") {
          throw new Error("Invalid REVEAL message type");
        }
        
        // Track commit and reveal verification status
        if (verification) {
          verification.commitVerified = true; // Already verified above
          verification.revealVerified = revealVerified;
        }
        
        if (!revealResponse.ok) {
              // Provider rejected reveal (hash mismatch) - FAILED_PROOF is non-retryable
              const failureCode = revealResponse.code || "FAILED_PROOF";
          // Still feed the verified envelope to record the failure
          const revealResult = await session.onReveal(revealResponse.envelope as SignedEnvelope<RevealMessage>);
          
              const action = handleAttemptFailure(failureCode, revealResponse.reason || "REVEAL failed", attemptEntry);
              if (action === "return") {
                if (explain) {
                  pushDecision(
                    selectedProvider,
                    "settlement",
                    false,
                    "SETTLEMENT_FAILED",
                    revealResponse.reason || "REVEAL failed",
                    explainLevel === "full" ? { code: failureCode } : undefined
                  );
                }
                
                // Emit SETTLEMENT_FAIL event before returning
                await eventRunner.emitFailure(
                  "settlement" as AcquisitionPhase,
                  failureCode,
                  revealResponse.reason || "REVEAL failed",
                  isRetryableFailureCode(failureCode),
                  {
                    event_name: "SETTLEMENT_FAIL",
                    custom_event_id: `settlement:fail:${intentId}`,
                    mode: "hash_reveal",
                    code: failureCode,
                  }
                );
                
                // Save transcript for non-retryable REVEAL failure (v1.7.2+)
                transcriptPath = await saveTranscriptOnEarlyReturn(
                  intentId,
                  failureCode,
                  revealResponse.reason || "REVEAL failed",
                  attemptEntry
                );
                
                return {
                  ok: false,
                  plan: {
                    ...plan,
                    overrideActive,
                  },
                  code: failureCode,
                  reason: revealResponse.reason || "REVEAL failed",
                  agreed_price: agreement.agreed_price,
                  ...(explain ? { explain } : {}),
                  ...(transcriptPath ? { transcriptPath } : {}),
                };
              }
              // If retryable (shouldn't happen for FAILED_PROOF), continue
              throw new Error(`REVEAL failed: ${revealResponse.reason || failureCode}`); // Will be caught by outer catch
        }
        
        revealOk = true;
        
        // For HTTP providers, use the verified envelope from the provider
        // For local providers, sign a new REVEAL message
        let revealEnvelopeToUse: SignedEnvelope<RevealMessage>;
        if (selectedProvider.endpoint) {
          // HTTP provider: use the verified envelope from the provider
          revealEnvelopeToUse = revealResponse.envelope as SignedEnvelope<RevealMessage>;
        } else {
          // Local provider: sign a new REVEAL message
          const revealNow = nowFunction();
          const revealMsg = {
            protocol_version: "pact/1.0" as const,
            type: "REVEAL" as const,
            intent_id: intentId,
            payload_b64: payloadB64,
            nonce_b64: nonce,
            sent_at_ms: revealNow,
            expires_at_ms: revealNow + 10000,
          };
          revealEnvelopeToUse = await signEnvelope(revealMsg, selectedSellerKp);
        }
        
        const revealResult = await session.onReveal(revealEnvelopeToUse);
        
        if (!revealResult.ok) {
          // REVEAL failures are typically non-retryable (FAILED_PROOF), but check anyway
          const action = handleAttemptFailure(revealResult.code, revealResult.reason || "REVEAL failed", attemptEntry);
          if (action === "return") {
            if (explain) {
              pushDecision(
                selectedProvider,
                "settlement",
                false,
                "SETTLEMENT_FAILED",
                revealResult.reason || "REVEAL failed",
                explainLevel === "full" ? { code: revealResult.code } : undefined
              );
            }
            
          // Emit SETTLEMENT_FAIL event before returning
          await eventRunner.emitFailure(
            "settlement" as AcquisitionPhase,
            revealResult.code,
            revealResult.reason || "REVEAL failed",
            isRetryableFailureCode(revealResult.code),
            {
              event_name: "SETTLEMENT_FAIL",
              custom_event_id: `settlement:fail:${intentId}`,
              mode: "hash_reveal",
              code: revealResult.code,
            }
          );
          
          // Save transcript for non-retryable REVEAL failure (v1.7.2+)
          transcriptPath = await saveTranscriptOnEarlyReturn(
            intentId,
            revealResult.code,
            revealResult.reason || "REVEAL failed",
            attemptEntry
          );
          
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: revealResult.code,
            reason: revealResult.reason || "REVEAL failed",
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
            ...(transcriptPath ? { transcriptPath } : {}),
          };
        }
        // If retryable, continue
        throw new Error(`REVEAL failed: ${revealResult.reason || revealResult.code}`); // Will be caught by outer catch
      }
      } catch (error: any) {
            // HTTP provider errors are retryable (provider-specific issues)
            const action = handleAttemptFailure("HTTP_PROVIDER_ERROR", `HTTP provider error: ${error.message}`, attemptEntry);
            if (action === "return") {
        return {
          ok: false,
          plan: {
            ...plan,
            overrideActive,
          },
          code: "HTTP_PROVIDER_ERROR",
          reason: `HTTP provider error: ${error.message}`,
          offers_eligible: evaluations.length,
          ...(explain ? { explain } : {}),
        };
            }
            // Retryable - continue to next candidate (will be caught by outer catch)
            throw error; // Re-throw to be caught by outer catch
      }
      } else {
      // Local provider: generate commit/reveal locally
      commitHash = computeCommitHash(payloadB64, nonce);

      const commitMsg = {
        protocol_version: "pact/1.0" as const,
        type: "COMMIT" as const,
        intent_id: intentId,
        commit_hash_hex: commitHash,
        sent_at_ms: commitNow,
        expires_at_ms: commitNow + 10000,
      };

      // Emit SETTLEMENT_COMMIT_ATTEMPT event for local provider
      const commitAttemptId = `settlement:commit:${intentId}:${commitAttemptIndex}`;
      await eventRunner.emitProgress(
        "settlement" as AcquisitionPhase,
        0.3 + (commitAttemptIndex * 0.1),
        "SETTLEMENT_COMMIT_ATTEMPT",
        {
          event_name: "SETTLEMENT_COMMIT_ATTEMPT",
          custom_event_id: commitAttemptId,
          attempt: commitAttemptIndex,
        }
      );

      const commitEnvelope = await signEnvelope(commitMsg, selectedSellerKp);
      const commitResult = await session.onCommit(commitEnvelope);

      if (!commitResult.ok) {
        // COMMIT failures are retryable (SETTLEMENT_FAILED)
        const action = handleAttemptFailure(commitResult.code, commitResult.reason || "COMMIT failed", attemptEntry);
        if (action === "return") {
          // Record settlement lifecycle failure if applicable
          if (commitResult.code === "SETTLEMENT_FAILED" && transcriptData?.settlement_lifecycle) {
            recordLifecycleEvent("commit", "failed", {
              failure_code: commitResult.code,
              failure_reason: commitResult.reason || "COMMIT failed",
            });
          }
          
          // Emit SETTLEMENT_FAIL event before returning
          await eventRunner.emitFailure(
            "settlement" as AcquisitionPhase,
            commitResult.code,
            commitResult.reason || "COMMIT failed",
            isRetryableFailureCode(commitResult.code),
            {
              event_name: "SETTLEMENT_FAIL",
              custom_event_id: `settlement:fail:${intentId}`,
              mode: "hash_reveal",
              code: commitResult.code,
            }
          );
          
          // Save transcript for non-retryable COMMIT failure (v1.7.2+)
          transcriptPath = await saveTranscriptOnEarlyReturn(
            intentId,
            commitResult.code,
            commitResult.reason || "COMMIT failed",
            attemptEntry
          );
          
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: commitResult.code,
            reason: commitResult.reason || "COMMIT failed",
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
            ...(transcriptPath ? { transcriptPath } : {}),
          };
        }
        // Retryable - continue
        throw new Error(`COMMIT failed: ${commitResult.reason || commitResult.code}`); // Will be caught by outer catch
      }

      const revealNow = nowFunction();
      // Emit SETTLEMENT_REVEAL_ATTEMPT event for local provider
      const revealAttemptId = `settlement:reveal:${intentId}:${revealAttemptIndex}`;
      await eventRunner.emitProgress(
        "settlement" as AcquisitionPhase,
        0.6 + (revealAttemptIndex * 0.1),
        "SETTLEMENT_REVEAL_ATTEMPT",
        {
          event_name: "SETTLEMENT_REVEAL_ATTEMPT",
          custom_event_id: revealAttemptId,
          attempt: revealAttemptIndex,
        }
      );

      const revealMsg = {
        protocol_version: "pact/1.0" as const,
        type: "REVEAL" as const,
        intent_id: intentId,
        payload_b64: payloadB64,
        nonce_b64: nonce,
        sent_at_ms: revealNow,
        expires_at_ms: revealNow + 10000,
      };

      const revealEnvelope = await signEnvelope(revealMsg, selectedSellerKp);
      const revealResult = await session.onReveal(revealEnvelope);

      if (!revealResult.ok) {
        // REVEAL failures are typically non-retryable (FAILED_PROOF), but check anyway
        const action = handleAttemptFailure(revealResult.code, revealResult.reason || "REVEAL failed", attemptEntry);
        if (action === "return") {
          if (explain) {
            pushDecision(
              selectedProvider,
              "settlement",
              false,
              "SETTLEMENT_FAILED",
              revealResult.reason || "REVEAL failed",
              explainLevel === "full" ? { code: revealResult.code } : undefined
            );
          }
          
          // Emit SETTLEMENT_FAIL event before returning (local provider path)
          await eventRunner.emitFailure(
            "settlement" as AcquisitionPhase,
            revealResult.code,
            revealResult.reason || "REVEAL failed",
            isRetryableFailureCode(revealResult.code),
            {
              event_name: "SETTLEMENT_FAIL",
              custom_event_id: `settlement:fail:${intentId}`,
              mode: "hash_reveal",
              code: revealResult.code,
            }
          );
          
          // Save transcript for non-retryable REVEAL failure (v1.7.2+)
          transcriptPath = await saveTranscriptOnEarlyReturn(
            intentId,
            revealResult.code,
            revealResult.reason || "REVEAL failed",
            attemptEntry
          );
          
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: revealResult.code,
            reason: revealResult.reason || "REVEAL failed",
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
            ...(transcriptPath ? { transcriptPath } : {}),
          };
        }
        // If retryable, continue
        throw new Error(`REVEAL failed: ${revealResult.reason || revealResult.code}`); // Will be caught by outer catch
      }
      }

      receipt = session.getReceipt() ?? null;
      // Add asset metadata to receipt from session (v2.2+)
      if (receipt) {
        receipt.asset_id = assetId;
        receipt.chain_id = chainId;
      }

      // Emit SETTLEMENT_COMPLETE event (before transcript commit)
      await eventRunner.emitSuccess(
        "settlement" as AcquisitionPhase,
        {
          event_name: "SETTLEMENT_COMPLETE",
          custom_event_id: `settlement:complete:${intentId}`,
          mode: "hash_reveal",
        },
        [createEvidence("settlement" as AcquisitionPhase, "settlement_complete", {
          mode: "hash_reveal",
          receipt_id: receipt?.intent_id,
          fulfilled: receipt?.fulfilled,
        })]
      );
      }

      if (chosenMode === "streaming") {
        // Settlement exclusivity guard (v1 contention semantics)
        // Enforce that only the selected provider can settle
        if (contention.winner && selectedProviderPubkey !== contention.winner.pubkey_b58) {
          const code = "PACT-330" as DecisionCode;
          const reason = `Contention exclusivity violated: attempted settlement with non-selected provider. Selected: ${contention.winner.provider_id}, Attempted: ${selectedProvider.provider_id}`;
          
          // Emit failure event
          await eventRunner.emitFailure(
            "settlement" as AcquisitionPhase,
            code,
            reason,
            false, // terminal
            {
              selected_provider_id: contention.winner.provider_id,
              selected_pubkey_b58: contention.winner.pubkey_b58,
              attempted_provider_id: selectedProvider.provider_id,
              attempted_pubkey_b58: selectedProviderPubkey,
            },
            [
              createEvidence("settlement" as AcquisitionPhase, "contention_exclusivity_violation", {
                winner_provider_id: contention.winner.provider_id,
                attempted_provider_id: selectedProvider.provider_id,
              }),
            ]
          );
          
          // Return terminal failure
          return {
            ok: false,
            plan,
            code,
            reason,
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
            ...(transcriptPath ? { transcriptPath } : {}),
          };
        }
        
        // Streaming settlement
        const streamingPolicy = compiled.base.settlement.streaming;
        
        // Declare variables for streaming settlement
        let streamingReceipt: Receipt | null = null;
        let streamingSuccess = false;
        let attemptFailed = false;
        let attemptFailureCode: string | undefined = undefined;
        let attemptFailureReason: string | undefined = undefined;
        
        // Use selectedProvider for streaming (same as hash_reveal)
        const streamingProvider = selectedProvider;
        const streamingProviderPubkey = selectedProviderPubkey;
    
        // v1.6.9+: Track cumulative streaming state across attempts (B4)
        let streamingTotalPaidAmount = 0;
        let streamingTotalTicks = 0;
        let streamingTotalChunks = 0;
        const streamingAttempts: Array<{
          idx: number;
          provider_pubkey: string;
          provider_id?: string;
          settlement_provider?: string;
          ticks_paid: number;
          paid_amount: number;
          outcome: "success" | "failed";
          failure_code?: string;
          failure_reason?: string;
        }> = [];
        let streamingAttemptIdx = 0;
        if (!streamingPolicy) {
      // STREAMING_NOT_CONFIGURED is non-retryable (policy issue)
      // Emit SETTLEMENT_STREAM_FAIL event before returning
      await eventRunner.emitFailure(
        "settlement" as AcquisitionPhase,
        "STREAMING_NOT_CONFIGURED",
        "Streaming policy not configured",
        false, // Non-retryable
        {
          event_name: "SETTLEMENT_STREAM_FAIL",
          custom_event_id: `settlement:stream:fail:${intentId}`,
          mode: "streaming",
          code: "STREAMING_NOT_CONFIGURED",
        }
      );
      
      const action = handleAttemptFailure("STREAMING_NOT_CONFIGURED", "Streaming policy not configured", attemptEntry);
      if (action === "return") {
        // Save transcript for STREAMING_NOT_CONFIGURED failure (v1.7.2+)
        const transcriptPath = await saveTranscriptOnEarlyReturn(
          intentId,
          "STREAMING_NOT_CONFIGURED",
          "Streaming policy not configured",
          attemptEntry
        );
        
        return {
          ok: false,
          plan: {
            ...plan,
            overrideActive,
          },
          code: "STREAMING_NOT_CONFIGURED",
          reason: "Streaming policy not configured",
          offers_eligible: evaluations.length,
          ...(explain ? { explain } : {}),
          ...(transcriptPath ? { transcriptPath } : {}),
        };
      }
      // If retryable, continue
      throw new Error("STREAMING_NOT_CONFIGURED"); // Will be caught by outer catch
    }

    // Emit SETTLEMENT_STREAM_START event (after policy check)
    await eventRunner.emitProgress(
      "settlement" as AcquisitionPhase,
      0.0,
      "SETTLEMENT_STREAM_START",
      {
        event_name: "SETTLEMENT_STREAM_START",
        custom_event_id: `settlement:stream:start:${intentId}`,
        mode: "streaming",
        tick_ms: streamingPolicy?.tick_ms ?? null,
        provider_id: streamingProvider.provider_id ?? "",
        provider_pubkey: streamingProviderPubkey,
        total_budget: round8(agreement.agreed_price),
      }
    );

    // Unlock what the agreement locked (pay-as-you-go)
      try {
          // v2 Phase 2+: Pass chain/asset to settlement operations
          attemptSettlement.release(buyerId, agreement.agreed_price, chainId, assetSymbol ?? assetId);
          attemptSettlement.release(selectedProviderPubkey, agreement.seller_bond, chainId, assetSymbol ?? assetId);
      } catch (error: any) {
        // Handle settlement provider errors (e.g., ExternalSettlementProvider NotImplemented)
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
            const failureCode = "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED";
            const failureReason = `Settlement operation (unlock) failed: ${errorMsg}`;
            
            const action = handleAttemptFailure(failureCode, failureReason, attemptEntry);
            if (action === "return") {
          return {
            ok: false,
                code: failureCode,
                reason: failureReason,
            explain: explain || undefined,
          };
            }
            // Retryable - continue to next candidate
            throw error; // Re-throw to be caught by outer catch
        }
        // Re-throw other errors
        throw error;
    }

    const totalBudget = agreement.agreed_price;
    const tickMs = streamingPolicy.tick_ms;
    const plannedTicks = 50;

    // Calculate batch size (deterministic from tickMs)
    // batch_size_ticks = min( max(5, floor(1000 / tickMs)), 50 )
    const batchSizeTicks = Math.min(Math.max(5, Math.floor(1000 / tickMs)), 50);

    // Create dedicated streaming clock that the exchange will use
    let streamNow = nowFunction(); // start from whatever nowFunction returns
    const streamNowFn = () => streamNow; // THIS is the clock exchange will use

    const exchange = new StreamingExchange({
      settlement: attemptSettlement, // Use attemptSettlement instead of settlement
      policy: compiled,
      now: streamNowFn, // Use dedicated streaming clock, not nowFunction
      buyerId,
      sellerId: selectedProviderPubkey,
      intentId,
      totalBudget,
      tickMs,
      plannedTicks,
    });

        try {
          exchange.start();
        } catch (error: any) {
          // Handle settlement provider errors from exchange.start()
          const errorMsg = error?.message || String(error);
          if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
            const failureCode = "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED";
            const failureReason = `Settlement operation (exchange.start) failed: ${errorMsg}`;
            
            const action = handleAttemptFailure(failureCode, failureReason, attemptEntry);
            if (action === "return") {
            return {
              ok: false,
                code: failureCode,
                reason: failureReason,
              explain: explain || undefined,
            };
            }
            // Retryable - continue to next candidate
            throw error; // Re-throw to be caught by outer catch
          }
          // Re-throw other errors
          throw error;
        }

        // Initialize batching counters at start of each attempt
        let batchIdx = 0;
        let batchStartTicks = streamingTotalTicks;
        let batchStartChunks = streamingTotalChunks;
        let batchStartPaid = streamingTotalPaidAmount;

      for (let i = 1; i <= plannedTicks; i++) {
      streamNow += tickMs + 5; // Always advance the streaming clock
      const tickNow = streamNow;

        // v1.6.9+: Calculate chunk sequence accounting for previous attempts (B4)
        // Chunk sequence should continue from where previous attempts left off
        const chunkSeq = streamingTotalChunks + (i - 1);
        
        if (streamingProvider.endpoint) {
        // HTTP provider: fetch signed chunk envelope
        try {
          const chunkResponse = await fetchStreamChunk(streamingProvider.endpoint, {
            intent_id: intentId,
            seq: chunkSeq,
            sent_at_ms: tickNow,
          });
          
          // Verify envelope signature (synchronous)
          if (!verifyEnvelope(chunkResponse.envelope)) {
            // PROVIDER_SIGNATURE_INVALID is retryable
            attemptFailed = true;
            attemptFailureCode = "PROVIDER_SIGNATURE_INVALID";
            attemptFailureReason = "Invalid STREAM_CHUNK envelope signature";
            break; // Break out of tick loop
          }
          
          // Parse envelope (async)
          const parsed = await parseEnvelope(chunkResponse.envelope);
          
          // Know Your Agent: verify signer matches provider pubkey
          const chunkSignerMatches = parsed.signer_public_key_b58 === streamingProviderPubkey;
          if (!chunkSignerMatches) {
            // PROVIDER_SIGNER_MISMATCH is retryable
            attemptFailed = true;
            attemptFailureCode = "PROVIDER_SIGNER_MISMATCH";
            attemptFailureReason = "STREAM_CHUNK envelope signer doesn't match provider pubkey";
            break; // Break out of tick loop
          }
          
          // Type assertion: we know this is a STREAM_CHUNK from the HTTP endpoint
          const chunkMsg = parsed.message as any;
          if (chunkMsg.type !== "STREAM_CHUNK") {
            // INVALID_MESSAGE_TYPE is retryable
            attemptFailed = true;
            attemptFailureCode = "INVALID_MESSAGE_TYPE";
            attemptFailureReason = "Expected STREAM_CHUNK message";
            break; // Break out of tick loop
          }
          
          // Call onChunk with the verified chunk message
          exchange.onChunk(chunkMsg);
        } catch (error: any) {
          // HTTP_STREAMING_ERROR is retryable (network/provider issue)
          const errorMsg = error?.message || String(error);
          // Check if this is already a handled error (from above checks)
          if (errorMsg.includes("PROVIDER_SIGNATURE_INVALID") || errorMsg.includes("PROVIDER_SIGNER_MISMATCH") || errorMsg.includes("INVALID_MESSAGE_TYPE")) {
            attemptFailed = true;
            attemptFailureCode = errorMsg.split(":")[0] || "HTTP_STREAMING_ERROR";
            attemptFailureReason = errorMsg;
            break; // Break out of tick loop
          }
          // Otherwise, treat as HTTP_STREAMING_ERROR
          attemptFailed = true;
          attemptFailureCode = "HTTP_STREAMING_ERROR";
          attemptFailureReason = `HTTP streaming error: ${errorMsg}`;
          break; // Break out of tick loop
        }
      } else {
        // Local provider: generate chunk locally
        exchange.onChunk({
          protocol_version: "pact/1.0",
          type: "STREAM_CHUNK",
          intent_id: intentId,
          seq: chunkSeq,
          chunk_b64: "AA==",
          sent_at_ms: tickNow,
          expires_at_ms: tickNow + 60000,
        });
      }

        // Then call tick() to process payment
        let tickResult;
        try {
          tickResult = exchange.tick();
        } catch (error: any) {
          // Handle settlement provider errors from exchange.tick()
          const errorMsg = error?.message || String(error);
          if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
            attemptFailed = true;
            attemptFailureCode = "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED";
            attemptFailureReason = `Settlement operation (exchange.tick) failed: ${errorMsg}`;
            break; // Break out of tick loop
          }
          // Re-throw other errors
          throw error;
        }
        
        // v1.6.9+: Check for tick failure (B4)
        if (!tickResult.ok) {
          const failureCode = tickResult.code || "SETTLEMENT_FAILED";
          const failureReason = tickResult.reason || "Stream tick failed";
          
          // Check if retryable (centralized retry policy)
          if (isRetryableFailureCode(failureCode)) {
            attemptFailed = true;
            attemptFailureCode = failureCode;
            attemptFailureReason = failureReason;
            break; // Break out of tick loop to continue with next candidate
          } else {
            // Non-retryable - fail overall
            attemptFailed = true;
            attemptFailureCode = failureCode;
            attemptFailureReason = failureReason;
            break; // Break out of tick loop
          }
        }
        
        // v1.6.9+: Update cumulative state from exchange state (B4)
        const state = exchange.getState();
        streamingTotalPaidAmount = state.paid_amount; // Exchange tracks cumulative
        streamingTotalTicks = state.ticks;
        streamingTotalChunks = state.chunks;

        // Track batch deltas
        const batchTicks = streamingTotalTicks - batchStartTicks;
        const batchChunks = streamingTotalChunks - batchStartChunks;
        const batchPaid = streamingTotalPaidAmount - batchStartPaid;

        // Emit batch event when batch size threshold is reached
        if (batchTicks >= batchSizeTicks) {
          await eventRunner.emitProgress(
            "settlement" as AcquisitionPhase,
            0.5 + (batchIdx * 0.05),
            "SETTLEMENT_STREAM_BATCH",
            {
              event_name: "SETTLEMENT_STREAM_BATCH",
              custom_event_id: `settlement:stream:batch:${intentId}:${streamingAttemptIdx}:${batchIdx}`,
              attempt: streamingAttemptIdx,
              batch: batchIdx,
              ticks_delta: batchTicks,
              chunks_delta: batchChunks,
              paid_delta: round8(batchPaid),
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
              paid_total: round8(streamingTotalPaidAmount),
            }
          );
          
          // Reset batch start variables and increment batch index
          batchStartTicks = streamingTotalTicks;
          batchStartChunks = streamingTotalChunks;
          batchStartPaid = streamingTotalPaidAmount;
          batchIdx++;
        }

        // Check for receipt (completion or failure) - natural exit
        if (tickResult.receipt) {
          const epsilon = 1e-12; // Small epsilon for floating point comparison
          // If receipt indicates completion, we're done
          if (tickResult.receipt.fulfilled && (tickResult.receipt.paid_amount || 0) >= totalBudget - epsilon) {
            streamingReceipt = tickResult.receipt;
            // Add asset metadata (v2.2+)
            streamingReceipt.asset_id = assetId;
            streamingReceipt.chain_id = chainId;
            streamingSuccess = true;
            // Record successful attempt
            streamingAttempts.push({
              idx: streamingAttemptIdx,
              provider_pubkey: streamingProviderPubkey,
              provider_id: selectedProvider.provider_id,
              settlement_provider: plan.settlement,
              ticks_paid: state.ticks,
              paid_amount: state.paid_amount,
              outcome: "success",
            });
            // Assign receipt and let execution continue to shared success path
            receipt = streamingReceipt;
            // Don't break - let execution continue to shared success path
          }
          // If receipt indicates failure, check if retryable
          if (!tickResult.receipt.fulfilled && tickResult.receipt.failure_code) {
            const failureCode = tickResult.receipt.failure_code;
            if (isRetryableFailureCode(failureCode)) {
              attemptFailed = true;
              attemptFailureCode = failureCode;
              attemptFailureReason = `Stream failed: ${failureCode}`;
              break; // Break out of tick loop to continue with next candidate
            } else {
              // Non-retryable - fail overall
              streamingReceipt = tickResult.receipt;
              // Add asset metadata (v2.2+)
              streamingReceipt.asset_id = assetId;
              streamingReceipt.chain_id = chainId;
              // Assign receipt before breaking out of loop
              receipt = streamingReceipt;
              break; // Break out of streaming attempt loop
            }
          }
        }

        // Only stop early if buyerStopAfterTicks is explicitly set and we've reached it
        if (typeof input.buyerStopAfterTicks === "number" && (streamingTotalTicks + (i - 1)) >= input.buyerStopAfterTicks) {
          const finalState = exchange.getState();
          streamingTotalPaidAmount = finalState.paid_amount;
          streamingTotalTicks = finalState.ticks;
          streamingTotalChunks = finalState.chunks;
          
          // Emit SETTLEMENT_STREAM_CUTOFF event before stopping
          const finalBatchTicks = streamingTotalTicks - batchStartTicks;
          const finalBatchChunks = streamingTotalChunks - batchStartChunks;
          const finalBatchPaid = streamingTotalPaidAmount - batchStartPaid;
          
          await eventRunner.emitProgress(
            "settlement" as AcquisitionPhase,
            0.9,
            "SETTLEMENT_STREAM_CUTOFF",
            {
              event_name: "SETTLEMENT_STREAM_CUTOFF",
              custom_event_id: `settlement:stream:cutoff:${intentId}:${streamingAttemptIdx}`,
              attempt: streamingAttemptIdx,
              reason: "BUYER_STOP",
              ticks_delta: finalBatchTicks,
              chunks_delta: finalBatchChunks,
              paid_delta: round8(finalBatchPaid),
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
              paid_total: round8(streamingTotalPaidAmount),
            }
          );
          
          streamingReceipt = exchange.stop("buyer", "Buyer requested stop");
          streamingSuccess = true; // Buyer stop is considered success
          // Record successful attempt (buyer stopped)
          streamingAttempts.push({
            idx: streamingAttemptIdx,
            provider_pubkey: streamingProviderPubkey,
            provider_id: selectedProvider.provider_id,
            settlement_provider: plan.settlement,
            ticks_paid: finalState.ticks,
            paid_amount: finalState.paid_amount,
            outcome: "success",
          });
          // Assign receipt and let execution continue to shared success path
          receipt = streamingReceipt;
          // Clear attemptFailed flag since buyer stop is a success
          attemptFailed = false;
          // Break out of tick loop to skip attemptFailed check
          break;
        }
      } // End of tick loop
      
      // v1.6.9+: Handle attempt failure or completion (B4)
      if (attemptFailed) {
        // Capture attempt metrics
        const finalState = exchange.getState();
        const attemptStartPaid = 0; // For single attempt, start from 0
        const attemptStartTicks = 0; // For single attempt, start from 0
        const attemptStartChunks = 0; // For single attempt, start from 0
        const attemptPaid = finalState.paid_amount - attemptStartPaid;
        const attemptTicks = finalState.ticks - attemptStartTicks;
        const attemptChunks = finalState.chunks - attemptStartChunks;
        
        // Update cumulative state
        streamingTotalPaidAmount = finalState.paid_amount;
        streamingTotalTicks = finalState.ticks;
        streamingTotalChunks = finalState.chunks;
        
        // Record failed attempt
        streamingAttempts.push({
          idx: streamingAttemptIdx,
          provider_pubkey: streamingProviderPubkey,
          provider_id: selectedProvider.provider_id,
          settlement_provider: plan.settlement,
          ticks_paid: attemptTicks,
          paid_amount: attemptPaid,
          outcome: "failed",
          failure_code: attemptFailureCode,
          failure_reason: attemptFailureReason,
        });
        
        // Check if retryable (centralized retry policy)
        if (attemptFailureCode && isRetryableFailureCode(attemptFailureCode)) {
          // Retryable - continue to next candidate
          continue;
        } else {
          // Non-retryable - fail overall
          // Emit SETTLEMENT_STREAM_FAIL event before creating failure receipt
          await eventRunner.emitFailure(
            "settlement" as AcquisitionPhase,
            attemptFailureCode || "SETTLEMENT_FAILED",
            attemptFailureReason || "Stream settlement failed",
            false, // Non-retryable
            {
              event_name: "SETTLEMENT_STREAM_FAIL",
              custom_event_id: `settlement:stream:fail:${intentId}`,
              mode: "streaming",
              code: attemptFailureCode || "SETTLEMENT_FAILED",
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
              paid_total: round8(streamingTotalPaidAmount),
            }
          );
          
          streamingReceipt = createReceipt({
            intent_id: intentId,
            buyer_agent_id: buyerId,
            seller_agent_id: streamingProviderPubkey,
            agreed_price: totalBudget,
            fulfilled: false,
            timestamp_ms: nowFunction(),
            paid_amount: round8(streamingTotalPaidAmount),
            ticks: streamingTotalTicks,
            chunks: streamingTotalChunks,
            failure_code: attemptFailureCode,
            asset_id: assetId,
            chain_id: chainId,
          });
          // Assign receipt before breaking out of loop
          receipt = streamingReceipt;
          break; // Break out of streaming attempt loop
        }
      } else {
        // Attempt succeeded - check if we're done
        // If buyer stop already set a receipt, skip budget check and continue to success path
        if (streamingReceipt && streamingSuccess && receipt) {
          // Buyer stop or other early success - receipt already assigned, continue to shared success path
          // Continue to shared success path (receipt already assigned)
          // No need to check budget or create receipt - already done
        } else {
          // State already updated in tick loop above
          const finalState = exchange.getState();
          
          // Check if budget is exhausted
          const epsilon = 1e-12; // Small epsilon for floating point comparison
          if (streamingTotalPaidAmount >= totalBudget - epsilon) {
          // Emit SETTLEMENT_STREAM_CUTOFF event before creating receipt
          const finalBatchTicks = streamingTotalTicks - batchStartTicks;
          const finalBatchChunks = streamingTotalChunks - batchStartChunks;
          const finalBatchPaid = streamingTotalPaidAmount - batchStartPaid;
          
          await eventRunner.emitProgress(
            "settlement" as AcquisitionPhase,
            0.9,
            "SETTLEMENT_STREAM_CUTOFF",
            {
              event_name: "SETTLEMENT_STREAM_CUTOFF",
              custom_event_id: `settlement:stream:cutoff:${intentId}:${streamingAttemptIdx}`,
              attempt: streamingAttemptIdx,
              reason: "BUDGET_REACHED",
              ticks_delta: finalBatchTicks,
              chunks_delta: finalBatchChunks,
              paid_delta: round8(finalBatchPaid),
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
              paid_total: round8(streamingTotalPaidAmount),
            }
          );
          
          // All budget paid - create final receipt
          streamingReceipt = createReceipt({
            intent_id: intentId,
            buyer_agent_id: buyerId,
            seller_agent_id: streamingProviderPubkey,
            agreed_price: totalBudget,
            fulfilled: true,
            timestamp_ms: nowFunction(),
            paid_amount: round8(streamingTotalPaidAmount),
            ticks: streamingTotalTicks,
            chunks: streamingTotalChunks,
            asset_id: assetId,
            chain_id: chainId,
          });
          streamingSuccess = true;
          // Record successful attempt
          streamingAttempts.push({
            idx: streamingAttemptIdx,
            provider_pubkey: streamingProviderPubkey,
            provider_id: selectedProvider.provider_id,
            settlement_provider: plan.settlement,
            ticks_paid: finalState.ticks,
            paid_amount: finalState.paid_amount,
            outcome: "success",
          });
          // Assign receipt and let execution continue to shared success path
          receipt = streamingReceipt;
          // Don't break - let execution continue to shared success path
        } else {
          // Partial success - record attempt and continue to next candidate if available
          streamingAttempts.push({
            idx: streamingAttemptIdx,
            provider_pubkey: streamingProviderPubkey,
            provider_id: selectedProvider.provider_id,
            settlement_provider: plan.settlement,
            ticks_paid: finalState.ticks,
            paid_amount: finalState.paid_amount,
            outcome: "success", // Partial success - will continue with next candidate
          });
          // Continue to next candidate to complete remaining budget
          continue;
          }
        }
      }
    
        // v1.6.9+: Use streaming receipt if available (B4)
        if (streamingReceipt) {
          receipt = streamingReceipt;
        } else if (!streamingSuccess && streamingTotalPaidAmount > 0) {
          // All attempts failed but some amount was paid - create failure receipt
          const failureCode = streamingAttempts[streamingAttempts.length - 1]?.failure_code || "SETTLEMENT_FAILED";
          
          // Emit SETTLEMENT_STREAM_FAIL event before creating failure receipt
          await eventRunner.emitFailure(
            "settlement" as AcquisitionPhase,
            failureCode,
            `Stream settlement failed: ${failureCode}`,
            false, // Terminal failure
            {
              event_name: "SETTLEMENT_STREAM_FAIL",
              custom_event_id: `settlement:stream:fail:${intentId}`,
              mode: "streaming",
              code: failureCode,
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
              paid_total: round8(streamingTotalPaidAmount),
            }
          );
          
          receipt = createReceipt({
            intent_id: intentId,
            buyer_agent_id: buyerId,
            seller_agent_id: selectedProviderPubkey,
            agreed_price: totalBudget,
            fulfilled: false,
            timestamp_ms: nowFunction(),
            paid_amount: round8(streamingTotalPaidAmount),
            ticks: streamingTotalTicks,
            chunks: streamingTotalChunks,
            failure_code: failureCode,
            asset_id: assetId,
            chain_id: chainId,
          });
        } else if (!streamingReceipt) {
          // No receipt yet - create one based on final cumulative state
          const eps = 1e-12;

          if (streamingTotalPaidAmount + eps >= totalBudget) {
            // Budget exhausted - fulfilled receipt
            receipt = createReceipt({
              intent_id: intentId,
              buyer_agent_id: buyerId,
              seller_agent_id: selectedProviderPubkey,
              agreed_price: totalBudget,
              fulfilled: true,
              timestamp_ms: nowFunction(),
              paid_amount: round8(streamingTotalPaidAmount),
              ticks: streamingTotalTicks,
              chunks: streamingTotalChunks,
              asset_id: assetId,
              chain_id: chainId,
            });
          } else {
            // Stream completed naturally (all ticks processed) - fulfilled receipt
            receipt = createReceipt({
              intent_id: intentId,
              buyer_agent_id: buyerId,
              seller_agent_id: selectedProviderPubkey,
              agreed_price: round8(streamingTotalPaidAmount), // Use actual paid amount
              fulfilled: true,
              timestamp_ms: nowFunction(),
              paid_amount: round8(streamingTotalPaidAmount),
              ticks: streamingTotalTicks,
              chunks: streamingTotalChunks,
              asset_id: assetId,
              chain_id: chainId,
            });
          }
        }
    
        // v1.6.9+: Record streaming attempts and summary in transcript (B4)
        if (transcriptData) {
          transcriptData.streaming_attempts = streamingAttempts;
          transcriptData.streaming_summary = {
            total_ticks: streamingTotalTicks,
            total_paid_amount: streamingTotalPaidAmount,
            attempts_used: streamingAttempts.length,
          };
        }

        // Emit SETTLEMENT_STREAM_COMPLETE event on success (before transcript commit)
        if (streamingSuccess && streamingReceipt && receipt) {
          await eventRunner.emitSuccess(
            "settlement" as AcquisitionPhase,
            {
              event_name: "SETTLEMENT_STREAM_COMPLETE",
              custom_event_id: `settlement:stream:complete:${intentId}`,
              mode: "streaming",
              receipt_id: streamingReceipt.intent_id,
              paid_total: round8(streamingTotalPaidAmount),
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
            },
            [createEvidence("settlement" as AcquisitionPhase, "settlement_complete", {
              mode: "streaming",
              receipt_id: streamingReceipt.intent_id,
              fulfilled: streamingReceipt.fulfilled,
              ticks_total: streamingTotalTicks,
              chunks_total: streamingTotalChunks,
              paid_total: round8(streamingTotalPaidAmount),
            })]
          );
        }

        if (agreement) {
          (agreement as any).status = "COMPLETED";
        }
      } // End of streaming block

      // Shared success path for both hash_reveal and streaming modes
      if (!receipt) {
      // NO_RECEIPT is typically non-retryable (protocol error), but check anyway
      const action = handleAttemptFailure("NO_RECEIPT", "No receipt generated after settlement", attemptEntry);
        if (action === "return") {
        if (explain) {
          explain.regime = plan.regime;
          explain.settlement = chosenMode;
          explain.fanout = plan.fanout;
          pushDecision(
            selectedProvider,
            "settlement",
            false,
            "SETTLEMENT_FAILED",
            "No receipt generated after settlement"
          );
        }
        
        // Save transcript for NO_RECEIPT failure (v1.7.2+)
        const transcriptPath = await saveTranscriptOnEarlyReturn(
          intentId,
          "NO_RECEIPT",
          "No receipt generated after settlement",
          attemptEntry
        );
        
        return {
          ok: false,
          plan: {
            ...plan,
            overrideActive,
          },
          code: "NO_RECEIPT",
          reason: "No receipt generated after settlement",
          offers_eligible: evaluations.length,
          ...(explain ? { explain } : {}),
          ...(transcriptPath ? { transcriptPath } : {}),
        };
        }
        continue;
      }

        // SUCCESS! Record success attempt and break out of loop
        attemptEntry.outcome = "success";
        attemptEntry.timestamp_ms = nowFunction();
        settlementAttempts.push(attemptEntry);
        
        // Record settlement_attempts in transcript
        if (transcriptData) {
          transcriptData.settlement_attempts = settlementAttempts;
        }
        
        // Break out of loop - we succeeded!
        // Store variables for success return (already defined outside loop)
        finalReceipt = receipt;
        finalVerification = verification;
        finalIntentId = intentId;
        finalSelectedProvider = selectedProvider;
        finalSelectedProviderPubkey = selectedProviderPubkey;
        finalSession = session; // v1.6.7+: Store session for SLA violation tracking (D1)
        
        break; // Exit the for loop
    } catch (error: any) {
      // Handle errors during attempt (may be retryable failures thrown from nested blocks)
      const errorMsg = error?.message || String(error);
      
      // Check if this is a known retryable failure pattern (from nested blocks)
      // Known retryable patterns: SETTLEMENT_FAILED, SETTLEMENT_PROVIDER_NOT_IMPLEMENTED, HTTP_PROVIDER_ERROR, etc.
      let failureCode = "UNEXPECTED_ERROR";
      let failureReason = `Unexpected error during acquisition attempt: ${errorMsg}`;
      
      // Try to extract failure code from error message (for retryable failures thrown from nested blocks)
      if (errorMsg.includes("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED")) {
        failureCode = "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED";
        failureReason = errorMsg;
      } else if (errorMsg.includes("SETTLEMENT_FAILED") || errorMsg.includes("COMMIT failed") || errorMsg.includes("REVEAL failed")) {
        failureCode = "SETTLEMENT_FAILED";
        failureReason = errorMsg;
      } else if (errorMsg.includes("HTTP_PROVIDER_ERROR") || errorMsg.includes("HTTP provider error") || errorMsg.includes("HTTP_STREAMING_ERROR")) {
        failureCode = errorMsg.includes("HTTP_STREAMING_ERROR") ? "HTTP_STREAMING_ERROR" : "HTTP_PROVIDER_ERROR";
        failureReason = errorMsg;
      } else if (errorMsg === "STREAMING_NOT_CONFIGURED" || errorMsg.includes("STREAMING_NOT_CONFIGURED")) {
        failureCode = "STREAMING_NOT_CONFIGURED";
        failureReason = errorMsg;
      } else if (errorMsg.includes("PROVIDER_SIGNATURE_INVALID")) {
        failureCode = "PROVIDER_SIGNATURE_INVALID";
        failureReason = errorMsg;
      } else if (errorMsg.includes("PROVIDER_SIGNER_MISMATCH")) {
        failureCode = "PROVIDER_SIGNER_MISMATCH";
        failureReason = errorMsg;
      } else if (errorMsg.includes("INVALID_MESSAGE_TYPE")) {
        failureCode = "INVALID_MESSAGE_TYPE";
        failureReason = errorMsg;
      } else if (errorMsg.includes("SETTLEMENT_POLL_TIMEOUT")) {
        failureCode = "SETTLEMENT_POLL_TIMEOUT";
        failureReason = errorMsg;
      }
      
      // Record attempt failure
      const action = handleAttemptFailure(failureCode, failureReason, attemptEntry);
      if (action === "return") {
        return {
          ok: false,
          code: failureCode,
          reason: failureReason,
          explain: explain || undefined,
        };
      }
      // Retryable failure - continue to next candidate
      continue;
    }
  } // End of for loop
  
  // After loop: check if we succeeded or all attempts failed
  // If we broke out of the loop (success), finalReceipt should be set
  // Otherwise, all attempts failed - return last failure
  if (!finalReceipt) {
    // All attempts failed
    if (transcriptData) {
      transcriptData.settlement_attempts = settlementAttempts;
      
      // v1.6.7+: Record settlement SLA violations if any (D1) - even on failure
      // Note: session may not be in scope here if all attempts failed before creating session
      // We'll record violations from the last attempt's session if available
      const violations = finalSession?.getSettlementSLAViolations() || [];
      const slaConfig = compiled.base.settlement?.settlement_sla;
      
      if (violations.length > 0 || slaConfig) {
        transcriptData.settlement_sla = {
          enabled: slaConfig?.enabled || false,
          max_pending_ms: slaConfig?.max_pending_ms,
          max_poll_attempts: slaConfig?.max_poll_attempts,
          poll_interval_ms: slaConfig?.poll_interval_ms,
          violations: violations.length > 0 ? violations : undefined,
        };
        
        // v1.6.7+: Apply minimal reputation penalty if enabled (D1)
        if (slaConfig?.penalty?.enabled && violations.length > 0 && store && finalSelectedProvider) {
          // Record penalty receipts for each violation (minimal hook)
          for (const violation of violations) {
            const penaltyReceipt = createReceipt({
              intent_id: firstAttemptIntentId || finalIntentId || `intent-${nowFunction()}-sla-penalty`,
              buyer_agent_id: buyerId,
              seller_agent_id: finalSelectedProviderPubkey || "unknown",
              agreed_price: 0, // Zero paid amount for penalty
              fulfilled: false,
              timestamp_ms: violation.ts_ms,
              failure_code: "SETTLEMENT_SLA_VIOLATION",
              paid_amount: 0,
              asset_id: assetId,
              chain_id: chainId,
            });
            (penaltyReceipt as any).intent_type = input.intentType;
            store.ingest(penaltyReceipt);
          }
        }
      }
    }
    
    // Return last failure or NO_ELIGIBLE_PROVIDERS if none attempted
    const failureCode = lastFailure?.code || "NO_ELIGIBLE_PROVIDERS";
    const failureReason = lastFailure?.reason || "All provider attempts failed";
    
    
    // Save transcript if requested (v1.7.2+)
    if (saveTranscript && transcriptData && input.transcriptDir) {
      // Use first attempt intentId if available, otherwise generate one
      const transcriptIntentId = firstAttemptIntentId || finalIntentId || `intent-${nowFunction()}-failed`;
      transcriptData.intent_id = transcriptIntentId;
      transcriptData.explain = explain || undefined;
      transcriptData.outcome = {
        ok: false,
        code: failureCode,
        reason: failureReason,
      };
      
      // Finalize settlement lifecycle metadata when all attempts fail (v1.7.2+)
      if (transcriptData.settlement_lifecycle) {
        // Handle settlement-related failures
        // EXCEPT for SETTLEMENT_POLL_TIMEOUT which should preserve/set "pending" status
        // (SETTLEMENT_POLL_TIMEOUT means settlement is still pending, we just gave up polling)
        const isSettlementFailure = failureCode.includes("SETTLEMENT") || failureCode === "SETTLEMENT_FAILED";
        
        if (isSettlementFailure) {
          // Set failure code/reason if not already set (for all settlement failures including timeout)
          if (!transcriptData.settlement_lifecycle.failure_code) {
            transcriptData.settlement_lifecycle.failure_code = failureCode;
          }
          if (!transcriptData.settlement_lifecycle.failure_reason) {
            transcriptData.settlement_lifecycle.failure_reason = failureReason;
          }
        }
        
        // Special handling for SETTLEMENT_POLL_TIMEOUT: set status to "pending" if not already terminal
        if (failureCode === "SETTLEMENT_POLL_TIMEOUT") {
          if (!transcriptData.settlement_lifecycle.status || 
              (transcriptData.settlement_lifecycle.status !== "committed" && 
               transcriptData.settlement_lifecycle.status !== "aborted" &&
               transcriptData.settlement_lifecycle.status !== "failed")) {
            transcriptData.settlement_lifecycle.status = "pending";
            // Try to get handle_id from settlement provider if not already set
            // (For StripeLikeSettlementProvider, we can check for pending handles)
            if (!transcriptData.settlement_lifecycle.handle_id && explicitSettlement) {
              try {
                const settlementAny = explicitSettlement as any;
                if (settlementAny.handles && typeof settlementAny.handles.get === 'function') {
                  // StripeLikeSettlementProvider has a handles Map
                  for (const [handleId, handle] of settlementAny.handles.entries()) {
                    if (handle.status === "pending") {
                      transcriptData.settlement_lifecycle.handle_id = handleId;
                      break;
                    }
                  }
                }
              } catch (e) {
                  // Ignore errors - handle_id might not be accessible this way
                }
            }
          }
        } else {
          // Set status to "failed" for other settlement failures
          if (!transcriptData.settlement_lifecycle.status || 
              (transcriptData.settlement_lifecycle.status !== "committed" && 
               transcriptData.settlement_lifecycle.status !== "aborted" &&
               transcriptData.settlement_lifecycle.status !== "failed")) {
            transcriptData.settlement_lifecycle.status = "failed";
          }
        }
        // Ensure errors array exists and includes this failure if not already present
        if (!transcriptData.settlement_lifecycle.errors) {
          transcriptData.settlement_lifecycle.errors = [];
        }
        const errorExists = transcriptData.settlement_lifecycle.errors.some(
          (e: any) => e.code === failureCode && e.reason === failureReason
        );
        if (!errorExists && (failureCode.includes("SETTLEMENT") || failureCode === "SETTLEMENT_FAILED")) {
          transcriptData.settlement_lifecycle.errors.push({
            code: failureCode,
            reason: failureReason,
          });
        }
      }
      
      try {
        const transcriptStore = new TranscriptStore(input.transcriptDir);
        transcriptPath = await transcriptStore.writeTranscript(transcriptIntentId, transcriptData as TranscriptV1);
      } catch (error: any) {
        // Don't throw - transcript save failure shouldn't break the error return
      }
    }
    
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
        offers_considered: evaluations.length,
      },
      code: failureCode,
      reason: failureReason,
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
      ...(transcriptPath ? { transcriptPath } : {}),
    };
  }
  
  // SUCCESS! Build and return success result
  // Log settlement completion
  if (explain && finalReceipt && finalSelectedProvider) {
    pushDecision(
      finalSelectedProvider,
      "settlement",
      true,
      "SETTLEMENT_COMPLETED",
      `Settlement completed successfully`,
      explainLevel === "full" ? {
        receipt_id: (finalReceipt as any).intent_id,
        fulfilled: (finalReceipt as any).fulfilled,
      } : undefined
    );
  }

  // Ingest receipt into store if provided
  if (store && finalReceipt) {
    (finalReceipt as any).intent_type = input.intentType;
    store.ingest(finalReceipt);
    
    // Log receipt ingestion
    if (explain && finalSelectedProvider) {
      pushDecision(
        finalSelectedProvider,
        "settlement",
        true,
        "RECEIPT_INGESTED",
        "Receipt ingested into store"
      );
    }
  }
  
  // Finalize explain metadata
  if (explain) {
    explain.regime = plan.regime;
    explain.settlement = chosenMode;
    explain.fanout = plan.fanout;
  }

  // Ensure required values are defined (should be set in success path)
  if (!finalIntentId || !finalSelectedProvider || !finalSelectedProviderPubkey || !finalReceipt) {
    throw new Error("Internal error: success path variables not set");
  }

  const baseResult = {
    ok: true as const,
    plan: {
      regime: plan.regime,
      settlement: chosenMode,
      fanout: plan.fanout,
      maxRounds: plan.maxRounds,
      reason: plan.reason,
      overrideActive,
      selected_provider_id: finalSelectedProvider.provider_id,
      offers_considered: evaluations.length,
    },
    intent_id: finalIntentId,
    buyer_agent_id: buyerId,
    seller_agent_id: finalSelectedProviderPubkey,
    receipt: finalReceipt,
    offers_eligible: evaluations.length,
  };
  
  // Wallet signing (v2 Phase 2 Execution Layer) - happens after acquisition succeeds
  if (walletAdapter && input.wallet?.requires_signature && walletAdapter.sign) {
    try {
      // Check if wallet can sign
      const caps = walletAdapter.capabilities ? walletAdapter.capabilities() : { can_sign: false, chains: [], assets: [] };
      if (!caps.can_sign) {
        // Wallet cannot sign - this should have been caught earlier, but handle gracefully
        if (transcriptData && transcriptData.wallet) {
          (transcriptData.wallet as any).signature_error = "Wallet cannot sign";
        }
      } else {
        // Create wallet action
        const signatureAction = input.wallet.signature_action || {};
        const walletAction: WalletAction = {
          action: signatureAction.action || "authorize",
          asset_symbol: signatureAction.asset_symbol || assetSymbol || assetId,
          amount: signatureAction.amount ?? (finalReceipt?.agreed_price ?? 0),
          from: walletAddress!,
          to: signatureAction.to || finalSelectedProviderPubkey,
          memo: signatureAction.memo,
          idempotency_key: signatureAction.idempotency_key || finalIntentId,
        };
        
        // Sign the action
        walletSignature = await walletAdapter.sign(walletAction);
        
        // Record signature in transcript
        if (transcriptData && transcriptData.wallet && walletSignature) {
          (transcriptData.wallet as any).adapter = walletKind;
          (transcriptData.wallet as any).asset = walletAction.asset_symbol;
          (transcriptData.wallet as any).signer = walletSignature.signer;
          
          // Convert signature to hex string for display
          let signatureHex: string;
          if (walletSignature.chain === "solana") {
            const bs58 = (await import("bs58")).default;
            signatureHex = bs58.encode(walletSignature.signature);
          } else {
            signatureHex = "0x" + Array.from(walletSignature.signature).map(b => b.toString(16).padStart(2, "0")).join("");
          }
          
          (transcriptData.wallet as any).signature_metadata = {
            chain: walletSignature.chain,
            signer: walletSignature.signer,
            signature_hex: signatureHex,
            payload_hash: walletSignature.payload_hash,
            scheme: walletSignature.scheme,
          };
        }
      }
    } catch (error: any) {
      // Wallet signing failed - record error but don't fail acquisition
      if (transcriptData && transcriptData.wallet) {
        (transcriptData.wallet as any).signature_error = error?.message || "Failed to sign wallet action";
      }
      // Return error code for wallet signing failure
      // Note: We don't fail the acquisition, but record the error
    }
  }
  
  // Build and write transcript if requested
  if (saveTranscript && transcriptData) {
    transcriptData.intent_id = finalIntentId;
    transcriptData.settlement = {
      mode: chosenMode,
      verification_summary: finalVerification,
    };
    transcriptData.receipt = finalReceipt;
    transcriptData.explain = explain || undefined;
    transcriptData.outcome = { ok: true };
    
    // Finalize settlement lifecycle metadata (v1.6.3+)
    if (transcriptData.settlement_lifecycle) {
      // If successful, record committed status and paid amount from receipt
      // v1.7.2+: Preserve pending status if async settlement is in progress
      if (finalReceipt && finalReceipt.fulfilled) {
        // Only update if not already set to pending (preserve async status)
        if (!transcriptData.settlement_lifecycle.status || 
            (transcriptData.settlement_lifecycle.status !== "pending" && 
             transcriptData.settlement_lifecycle.status !== "failed")) {
          transcriptData.settlement_lifecycle.status = "committed";
        }
        if (!transcriptData.settlement_lifecycle.committed_at_ms) {
          transcriptData.settlement_lifecycle.committed_at_ms = finalReceipt.timestamp_ms || (nowFn ? nowFn() : Date.now());
        }
        if (!transcriptData.settlement_lifecycle.paid_amount) {
          transcriptData.settlement_lifecycle.paid_amount = finalReceipt.paid_amount || (finalReceipt as any).agreed_price || 0;
        }
      }
    }
    
    // Mark intent fingerprint as committed (atomic reservation, PACT-331)
    // This must happen inside the atomic commit gate, before transcript_commit
    if (store && finalIntentId) {
      try {
        store.markFingerprintCommitted(intentFingerprint, finalIntentId, nowFn ? nowFn() : Date.now());
      } catch (err) {
        // Log but don't fail - fingerprint tracking is best-effort
        // If store is unavailable, we still want to complete the transaction
      }
    }
    
    // Emit transcript_commit event (triggers handler registered above, preserves ordering)
    // This ensures transcript is written atomically after all settlement events complete
    await eventRunner.emitSuccess(
      "transcript_commit" as AcquisitionPhase,
      { intent_id: finalIntentId, outcome: "success" },
      [createEvidence("transcript_commit" as AcquisitionPhase, "transcript_data", {
        intent_id: finalIntentId,
        has_receipt: !!finalReceipt,
        settlement_mode: chosenMode,
      })]
    );
    
    // Transcript path is set by the event handler registered above
    // For immediate access, also write directly (handler will handle idempotency)
    const transcriptStore = new TranscriptStore(input.transcriptDir);
    if (finalIntentId) {
      transcriptPath = await transcriptStore.writeTranscript(finalIntentId, transcriptData as TranscriptV1);
    }
  }
  
  const finalResult: AcquireResult = explain 
    ? { ...baseResult, explain, ...(finalVerification ? { verification: finalVerification } : {}), ...(transcriptPath ? { transcriptPath } : {}) }
    : { ...baseResult, ...(finalVerification ? { verification: finalVerification } : {}), ...(transcriptPath ? { transcriptPath } : {}) };
  return finalResult;
}

