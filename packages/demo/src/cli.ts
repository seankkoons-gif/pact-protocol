import minimist from "minimist";
import {
  createDefaultPolicy,
  validatePolicyJson,
  compilePolicy,
  DefaultPolicyGuard,
  signEnvelope,
  verifyEnvelope,
  computeCommitHash,
  MockSettlementProvider,
  createSettlementProvider,
  ReceiptStore,
  referencePriceP50,
  priceStats,
  agentScore,
  routeExecution,
  acquire,
  InMemoryProviderDirectory,
  JsonlProviderDirectory,
  generateKeyPair,
  publicKeyToB58,
  type AcquireExplain,
  type SettlementProvider,
} from "@pact/sdk";
import { startProviderServer } from "@pact/provider-adapter";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Find repo root (go up from packages/demo/src/cli.ts to repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// ============================================================================
// Helper Functions
// ============================================================================

function getPubkeyB58FromEnvelope(env: any): string | undefined {
  return (
    env?.signer_public_key_b58 ||
    env?.signerPublicKeyB58 ||
    env?.signer_pubkey_b58 ||
    env?.signerPubkeyB58 ||
    env?.signerPublicKey ||
    env?.signer_public_key
  );
}

function getSigB58FromEnvelope(env: any): string | undefined {
  return (
    env?.signature_b58 ||
    env?.signatureB58 ||
    env?.signature
  );
}

function getHashFromEnvelope(env: any): string | undefined {
  return (
    env?.message_hash_hex ||
    env?.messageHashHex ||
    env?.hash_hex ||
    env?.hashHex
  );
}

async function verifyAndDescribeEnvelope(envelope: any) {
  const pubkeyB58 = getPubkeyB58FromEnvelope(envelope);
  const sigB58 = getSigB58FromEnvelope(envelope);
  const hashHex = getHashFromEnvelope(envelope);

  let verified = false;
  try {
    if (envelope && envelope.message) {
      verified = await verifyEnvelope(envelope);
    }
  } catch {
    verified = false;
  }

  const signerShort = pubkeyB58 ? `${pubkeyB58.slice(0, 10)}...` : "UNKNOWN";
  const hashShort = hashHex ? hashHex.slice(0, 12) : "UNKNOWN";
  const sigShort = sigB58 ? `${sigB58.slice(0, 10)}...` : "UNKNOWN";

  return {
    verified: verified ? "✅" : "❌",
    signerShort,
    hashShort,
    sigShort,
  };
}

function truncate(str: string, n: number): string {
  return str.length > n ? `${str.slice(0, n)}...` : str;
}

function fmtMoney(n: number): string {
  return n.toFixed(8);
}

function round8(x: number): number {
  return Math.round(x * 1e8) / 1e8;
}

function printSection(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}\n`);
}

function getDemoP50(intentType: string, store: ReceiptStore): { p50: number; isBootstrap: boolean; tradeCount: number } {
  const intentReceipts = store.list({ intentType });
  const p50 = referencePriceP50(intentType, intentReceipts, 200);
  const tradeCount = intentReceipts.length;
  
  if (p50 !== null) {
    return { p50, isBootstrap: false, tradeCount };
  }
  
  // Bootstrap constant when no history exists
  return { p50: 0.00009, isBootstrap: true, tradeCount: 0 };
}

function printReputationStats(
  intentType: string,
  buyerId: string,
  sellerId: string,
  store: ReceiptStore
) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Reputation & Market Intel`);
  console.log(`${"─".repeat(60)}`);

  const { p50, isBootstrap, tradeCount } = getDemoP50(intentType, store);
  const source = isBootstrap ? `bootstrap, ${tradeCount} trades` : `${tradeCount} trades`;

  console.log(`Market Price (${intentType}):`);
  console.log(`  p50: ${fmtMoney(p50)} (${source})`);

  const buyerScore = agentScore(buyerId, store.list({ agentId: buyerId }));
  const sellerScore = agentScore(sellerId, store.list({ agentId: sellerId }));

  console.log(`\nBuyer (${truncate(buyerId, 12)}):`);
  console.log(`  reputation: ${buyerScore.reputation.toFixed(3)}`);
  console.log(`  success rate: ${(buyerScore.successRate * 100).toFixed(1)}%`);
  console.log(`  volume: ${fmtMoney(buyerScore.volume)} (${buyerScore.trades} trades)`);

  console.log(`\nSeller (${truncate(sellerId, 12)}):`);
  console.log(`  reputation: ${sellerScore.reputation.toFixed(3)}`);
  console.log(`  success rate: ${(sellerScore.successRate * 100).toFixed(1)}%`);
  console.log(`  volume: ${fmtMoney(sellerScore.volume)} (${sellerScore.trades} trades)`);
}

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  const raw = process.argv.slice(2).filter((x) => x !== "--");
  const args = minimist(raw);

  function readNumberFlag(args: any, name: string): number | undefined {
    const direct = args[name];
    if (typeof direct === "number" && Number.isFinite(direct)) return direct;
    if (typeof direct === "string" && direct.trim() !== "") {
      const n = Number(direct);
      if (Number.isFinite(n)) return n;
    }

    const arr: any[] = Array.isArray(args._) ? args._ : [];
    const key1 = `--${name}`;
    const key2 = name;

    let idx = arr.indexOf(key1);
    if (idx === -1) idx = arr.indexOf(key2);

    if (idx !== -1 && idx + 1 < arr.length) {
      const n = Number(arr[idx + 1]);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  }

  // --- Mode override parsing (bulletproof) ---
  const rawMode = args.mode;
  const modeArg = Array.isArray(rawMode) 
    ? rawMode[rawMode.length - 1] 
    : (typeof rawMode === "string" ? rawMode : undefined);

  // Supports: positional "streaming" or "hash_reveal" ending up in args._
  const positionalMode =
    Array.isArray(args._) && args._.includes("streaming")
      ? "streaming"
      : (Array.isArray(args._) && args._.includes("hash_reveal") ? "hash_reveal" : undefined);

  // --- Demo mode detection ---
  const rawDemo = args.demo;
  const demoMode = Array.isArray(rawDemo) 
    ? rawDemo[rawDemo.length - 1] 
    : (rawDemo as string | undefined);
  const isDemoMode = !!demoMode;

  // Final override (if present)
  // Force streaming mode for timeout demo (buyerStopAfterTicks only works in streaming)
  let overrideMode =
    modeArg === "streaming" || modeArg === "hash_reveal"
      ? modeArg
      : positionalMode;
  
  if (demoMode === "timeout" && !overrideMode) {
    overrideMode = "streaming";
  }
  
  // --- Other CLI args ---
  const saveTranscript = args.saveTranscript || args["save-transcript"] || false;
  const transcriptDir = args.transcriptDir || args["transcript-dir"];
  const rawIntent = args.intent;
  const intentType = Array.isArray(rawIntent) 
    ? rawIntent[rawIntent.length - 1] 
    : (rawIntent || "weather.data");

  const rawScope = args.scope;
  const scope = Array.isArray(rawScope) 
    ? rawScope[rawScope.length - 1] 
    : (rawScope || "NYC");

  // For price-too-high demo, set maxPrice very low
  const defaultMaxPrice = demoMode === "price-too-high" ? "0.00001" : "0.0001";
  const rawMaxPrice = args.maxPrice;
  const maxPrice = parseFloat(
    Array.isArray(rawMaxPrice) 
      ? rawMaxPrice[rawMaxPrice.length - 1] 
      : (rawMaxPrice || defaultMaxPrice)
  );

  const urgent = !!args.urgent;
  const cheat = !!args.cheat;
  const outOfBandAsk = !!args.outOfBandAsk;
  const rounds = parseInt(args.rounds || "3");
  const seed = args.seed ? parseInt(args.seed) : undefined;
  // For timeout demo, stop after 1 tick
  const defaultBuyerStopAfter = demoMode === "timeout" ? 1 : undefined;
  const buyerStopAfter = readNumberFlag(args, "buyerStopAfter") ?? defaultBuyerStopAfter;
  const useHttpProvider = !!args.useHttpProvider;
  
  // Resolve registry path relative to repo root (not CWD)
  const rawRegistry = args.registry;
  const registryArg = Array.isArray(rawRegistry) 
    ? rawRegistry[rawRegistry.length - 1] 
    : rawRegistry;
  const registryPath = registryArg
    ? path.isAbsolute(registryArg)
      ? registryArg
      : path.resolve(repoRoot, registryArg)
    : undefined;

  const rawExplain = args.explain;
  const explainLevel = (
    Array.isArray(rawExplain) 
      ? rawExplain[rawExplain.length - 1] 
      : rawExplain || "none"
  ) as "none" | "coarse" | "full";
  
  // Trust tier routing flags (v1.5.8+)
  const rawMinTrustTier = args.minTrustTier || args["min-trust-tier"];
  const minTrustTier = Array.isArray(rawMinTrustTier)
    ? (rawMinTrustTier[rawMinTrustTier.length - 1] as "untrusted" | "low" | "trusted")
    : (rawMinTrustTier as "untrusted" | "low" | "trusted" | undefined);
  
  const rawMinTrustScore = args.minTrustScore || args["min-trust-score"];
  const minTrustScore = typeof rawMinTrustScore === "number"
    ? rawMinTrustScore
    : (typeof rawMinTrustScore === "string" ? parseFloat(rawMinTrustScore) : undefined);
  
  const requireCredential = !!args.requireCredential || !!args["require-credential"];
  
  // Settlement provider selection (v1.7.1+)
  const rawSettlementProvider = args.settlementProvider || args["settlement-provider"];
  const settlementProvider = Array.isArray(rawSettlementProvider)
    ? (rawSettlementProvider[rawSettlementProvider.length - 1] as "mock" | "external" | "stripe_like")
    : (rawSettlementProvider as "mock" | "external" | "stripe_like" | undefined);
  
  // v1.7.2+: Optional async flag for stripe_like (default: false, synchronous)
  const stripeAsync = !!args.stripeAsync || !!args["stripe-async"];
  // v1.7.2+: Optional fail flag for stripe_like (default: false, succeeds)
  const stripeFail = !!args.stripeFail || !!args["stripe-fail"];
  
  // Note: For bad-reveal demo, the provider server must be started with
  // PACT_DEV_BAD_REVEAL=1 environment variable set, as the provider server
  // runs in a separate process and reads its own environment.

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  PACT PROTOCOL DEMO                          ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Generate keypairs using SDK helpers (encapsulates tweetnacl)
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  console.log(`Buyer ID:  ${truncate(buyerId, 20)}`);
  console.log(`Seller ID: ${truncate(sellerId, 20)}`);

  // Create receipt store with demo-mode-specific file
  function getReceiptsFilePath(demoMode: string | undefined): string {
    const baseName = demoMode 
      ? `demo_receipts_${demoMode === "price-too-high" ? "price_too_high" : demoMode}.jsonl`
      : "demo_receipts.jsonl";
    return path.join(process.cwd(), baseName);
  }

  const store = new ReceiptStore({
    jsonlPath: getReceiptsFilePath(demoMode),
  });
  store.loadFromJsonl();

  // Create and validate policy
  const policy = createDefaultPolicy();
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    console.error("Policy validation failed:", validated.errors);
    process.exit(1);
  }

  const compiled = compilePolicy(validated.policy);
  const guard = new DefaultPolicyGuard(compiled);

  // Policy Summary
  printSection("Policy Summary");
  console.log(`Negotiation:`);
  console.log(`  max_rounds: ${compiled.base.negotiation.max_rounds}`);
  console.log(`  max_total_duration_ms: ${compiled.base.negotiation.max_total_duration_ms}`);
  console.log(`\nEconomics:`);
  console.log(`  reference_price.use_receipt_history: ${compiled.base.economics.reference_price.use_receipt_history}`);
  console.log(`  reference_price.band_pct: ${compiled.base.economics.reference_price.band_pct}`);
  console.log(`  reference_price.allow_band_override_if_urgent: ${compiled.base.economics.reference_price.allow_band_override_if_urgent}`);
  console.log(`  bonding.seller_bond_multiple: ${compiled.base.economics.bonding.seller_bond_multiple}`);
  console.log(`  bonding.seller_min_bond: ${compiled.base.economics.bonding.seller_min_bond}`);
  console.log(`\nSettlement:`);
  console.log(`  allowed_modes: [${compiled.base.settlement.allowed_modes.join(", ")}]`);
  console.log(`  default_mode: ${compiled.base.settlement.default_mode}`);
  if (compiled.base.settlement.streaming) {
    console.log(`  streaming.tick_ms: ${compiled.base.settlement.streaming.tick_ms}`);
    console.log(`  streaming.max_spend_per_minute: ${compiled.base.settlement.streaming.max_spend_per_minute}`);
    console.log(`  streaming.cutoff_on_violation: ${compiled.base.settlement.streaming.cutoff_on_violation}`);
  }

  // Create settlement provider based on CLI flag (v1.7.1+)
  let settlement: SettlementProvider;
  if (settlementProvider) {
    // Create provider via factory when flag is set
    const providerConfig: { provider: "mock" | "external" | "stripe_like"; params?: Record<string, unknown> } = {
      provider: settlementProvider,
    };
    
    // v1.7.2+: If stripe_like and stripeAsync/stripeFail flags are set, configure async behavior
    if (settlementProvider === "stripe_like" && (stripeAsync || stripeFail)) {
      providerConfig.params = {
        asyncCommit: stripeAsync || stripeFail, // Enable async if either flag is set
        commitDelayTicks: 3, // Default delay
        failCommit: stripeFail, // Fail if stripeFail flag is set
      };
    }
    
    settlement = createSettlementProvider(providerConfig);
  } else {
    // Default to mock provider (backward compatible)
    settlement = new MockSettlementProvider();
  }

  // Credit buyer and seller on the chosen provider instance
  settlement.credit(buyerId, 1.0);
  settlement.credit(sellerId, 0.1);
  
  // Store initial balances for delta calculation
  const initialBuyerBalance = settlement.getBalance(buyerId);
  const initialBalancesByProvider: Record<string, number> = {
    [buyerId]: initialBuyerBalance,
    [sellerId]: settlement.getBalance(sellerId),
  };

  // Create provider directory (persistent JSONL or in-memory)
  let directory: InMemoryProviderDirectory | JsonlProviderDirectory;
  let sellerKeyPairsByPubkeyB58: Record<string, { publicKey: Uint8Array; secretKey: Uint8Array }> = {
    [sellerId]: sellerKeyPair,
  };

  if (registryPath) {
    // Registry-only mode: load from JSONL, do not register demo providers
    directory = new JsonlProviderDirectory({ path: registryPath });
    directory.load();
    
    let providersForIntent = directory.listProviders(intentType);
    
    if (providersForIntent.length === 0) {
      console.error(`\n❌ Error: No providers found in registry for intent type: ${intentType}`);
      console.error(`   Registry: ${registryPath}`);
      console.error(`   Resolved from: ${args.registry || "default"}`);
      console.error(`   Please register providers using: pnpm provider:register`);
      console.error(`   Or use an absolute path: --registry ${path.resolve(repoRoot, "providers.jsonl")}`);
      process.exit(1);
    }

    // Credit all providers from registry
    for (const p of providersForIntent) {
      settlement.credit(p.pubkey_b58, 0.1);
      // Track initial balance for this provider
      initialBalancesByProvider[p.pubkey_b58] = settlement.getBalance(p.pubkey_b58);
    }

    // Build sellerKeyPairsByPubkeyB58 from registry providers
    for (const provider of providersForIntent) {
      // For registry providers, we may not have their keypairs
      // This is fine for HTTP providers, but local providers would need keypairs
      // For now, we'll only include the main sellerKeyPair if it matches
      if (provider.pubkey_b58 === sellerId) {
        sellerKeyPairsByPubkeyB58[provider.pubkey_b58] = sellerKeyPair;
      }
    }
  } else {
    // In-memory mode: create demo providers
    directory = new InMemoryProviderDirectory();
    
    // Create additional seller keypairs for fanout demo
    const seller2KeyPair = generateKeyPair();
    const seller3KeyPair = generateKeyPair();
    const seller2Id = publicKeyToB58(seller2KeyPair.publicKey);
    const seller3Id = publicKeyToB58(seller3KeyPair.publicKey);
    
    // Credit additional sellers
    settlement.credit(seller2Id, 0.1);
    settlement.credit(seller3Id, 0.1);
    // Track initial balances for in-memory providers
    initialBalancesByProvider[seller2Id] = settlement.getBalance(seller2Id);
    initialBalancesByProvider[seller3Id] = settlement.getBalance(seller3Id);
    
    // Map seller keypairs by pubkey for signing
    sellerKeyPairsByPubkeyB58 = {
      [sellerId]: sellerKeyPair,
      [seller2Id]: seller2KeyPair,
      [seller3Id]: seller3KeyPair,
    };
    
    // Register providers in directory
    directory.registerProvider({
      provider_id: sellerId,
      intentType,
      pubkey_b58: sellerId,
      region: "us-east",
      credentials: ["sla_verified"],
      baseline_latency_ms: 50,
    });
    
    directory.registerProvider({
      provider_id: seller2Id,
      intentType,
      pubkey_b58: seller2Id,
      region: "us-west",
      credentials: ["sla_verified"],
      baseline_latency_ms: 60,
    });
    
    directory.registerProvider({
      provider_id: seller3Id,
      intentType,
      pubkey_b58: seller3Id,
      region: "eu-west",
      credentials: [],
      baseline_latency_ms: 70,
    });
  }
  
  // Optionally start HTTP provider server (only in non-registry mode)
  let httpServer: { url: string; close(): void } | null = null;
  if (useHttpProvider && !registryPath) {
    // ONLY in non-registry mode do we spin up a local provider for convenience
    httpServer = startProviderServer({
      port: 0,
      sellerKeyPair,
      sellerId,
    });
    console.log(`\n[HTTP Provider] Started at ${httpServer.url}`);

    // Register it into the in-memory directory
    directory.registerProvider({
      provider_id: sellerId,
      intentType,
      pubkey_b58: sellerId,
      region: "us-east",
      credentials: ["sla_verified"],
      baseline_latency_ms: 50,
      endpoint: httpServer.url,
    });

    sellerKeyPairsByPubkeyB58[sellerId] = sellerKeyPair;
  }

  // Create session with simulated clock starting at 1000 for deterministic timing
  let now = 1000;
  const nowFn = () => {
    return now;
  };

  // Compute market stats for router
  const intentReceipts = store.list({ intentType });
  const stats = priceStats(intentReceipts);
  const p50 = stats.p50;
  const p90 = stats.p90;
  const tradeCount = stats.n;

  // Build execution plan using router
  const plan = routeExecution({
    intentType,
    urgency: urgent,
    tradeCount,
    p50,
    p90,
    policyMaxRounds: compiled.base.negotiation.max_rounds,
  });

  // For registry mode: get final provider list and cap fanout
  let providersForIntent: any[] = [];
  let effectiveFanout = plan.fanout;
  if (registryPath) {
    // Get final provider list from registry (registry-only mode)
    providersForIntent = directory.listProviders(intentType);
    
    // Cap fanout to actual provider count
    effectiveFanout = Math.min(plan.fanout, providersForIntent.length);
    
    // Print directory section
    printSection("Directory (registry)");
    console.log(`  path: ${registryPath}`);
    console.log(`  providers for ${intentType}: ${providersForIntent.length}`);
    for (const provider of providersForIntent) {
      const providerIdShort = provider.provider_id.substring(0, 8);
      const endpointInfo = provider.endpoint ? ` (${provider.endpoint})` : "";
      console.log(`    ${providerIdShort}${endpointInfo}`);
    }
    console.log();
  }

  // Determine settlement mode (user override or router decision)
  const chosenMode = overrideMode ?? plan.settlement;
  const overrideActive = !!overrideMode;
  
  // Print Execution Plan
  printSection("Execution Plan");
  console.log(`Regime: ${plan.regime}`);
  console.log(`Settlement: ${chosenMode}${overrideMode ? " (override)" : ""}`);
  console.log(`Fanout: ${effectiveFanout}${registryPath ? ` (capped from ${plan.fanout} by registry providers)` : ""}`);
  console.log(`Max Rounds: ${plan.maxRounds}`);
  
  // Extract regime reason (before semicolon) and show override if active
  const regimeReason = plan.reason.split(';')[0];
  if (overrideActive) {
    console.log(`Reason: ${regimeReason}`);
    console.log(`Override active: settlement forced to ${overrideMode}`);
  } else {
    console.log(`Reason: ${plan.reason}`);
  }
  
  printSection("Acquire Flow");
  
  // Use acquire() to handle negotiation and settlement
  const result = await acquire({
    input: {
      intentType,
      scope,
      constraints: {
        latency_ms: 50,
        freshness_sec: 10,
      },
      maxPrice,
      urgent,
      modeOverride: overrideMode,
      buyerStopAfterTicks: buyerStopAfter,
      explain: explainLevel,
      useReputationV2: true, // Enable credential-aware, volume-weighted reputation (v1.5.3+)
      saveTranscript: saveTranscript || isDemoMode, // Enable transcripts for demo modes (v1.5.4+)
      transcriptDir: transcriptDir,
      // Trust tier routing overrides (v1.5.8+)
      ...(minTrustTier ? { minTrustTier } : {}),
      ...(minTrustScore !== undefined ? { minTrustScore } : {}),
      ...(requireCredential ? { requireCredential: true } : {}),
      // v1.7.2+: Settlement lifecycle configuration
      // Only set auto_poll_ms if using stripe_like with async
      // DO NOT set provider here - we pass the funded instance explicitly as 'settlement' parameter
      // Setting input.settlement.provider would cause acquire() to create a NEW unfunded instance
      ...(settlementProvider === "stripe_like" && stripeAsync
        ? {
            settlement: {
              auto_poll_ms: 0, // Immediate poll loop for demo
            },
          }
        : {}),
      // Note: Settlement provider is passed as explicit 'settlement' parameter below
      // (explicit instance wins over input.settlement.provider, but only if input.settlement.provider is not set)
    },
    buyerKeyPair,
    sellerKeyPair,
    sellerKeyPairsByPubkeyB58,
    buyerId,
    sellerId,
    policy: validated.policy,
    settlement,
    store,
    directory,
    rfq: {
      fanout: effectiveFanout,
      maxCandidates: 10,
    },
    now: nowFn,
  });
  
  // Print transcript path if saved
  if (result.transcriptPath) {
    console.log(`\n✅ Transcript saved: ${result.transcriptPath}`);
  }
  
  if (!result.ok) {
    printSection("Acquire Failed");
    console.error(`Code: ${result.code}`);
    console.error(`Reason: ${result.reason}`);
    if (result.explain) {
      console.error(`\nProviders considered: ${result.explain.providers_considered}`);
      console.error(`Providers eligible: ${result.explain.providers_eligible}`);
      if (result.explain.log.length > 0) {
        console.error(`\nDecision log:`);
        result.explain.log.forEach((log) => {
          console.error(`  [${log.step}] ${log.provider_id?.slice(0, 10) || "N/A"}: ${log.code} - ${log.reason}`);
        });
      }
    }
    
    // Print transcript path if saved (even on failure)
    if (result.transcriptPath) {
      console.error(`\n✅ Transcript saved: ${result.transcriptPath}`);
    }
    
    // Show balances even on failure
    const buyerBalance = settlement.getBalance(buyerId);
    const buyerLocked = settlement.getLocked(buyerId);
    const buyerDelta = buyerBalance - initialBuyerBalance;
    console.error(`\nBuyer balance: ${fmtMoney(buyerBalance)} (locked: ${fmtMoney(buyerLocked)}) [delta: ${buyerDelta >= 0 ? "+" : ""}${fmtMoney(buyerDelta)}]`);
    
    // Try to identify the provider involved (best-effort)
    // Use pubkey_b58 for settlement lookups (settlement uses pubkey as account ID)
    const providerFromLog = result.explain?.log?.find((l) => l.provider_id);
    const providerPubkeyB58 = 
      providerFromLog?.pubkey_b58 ||
      result.explain?.selected_provider_id || // This might be pubkey or short ID, but try it
      undefined;

    if (providerPubkeyB58) {
      const sellerBalance = settlement.getBalance(providerPubkeyB58);
      const sellerLocked = settlement.getLocked(providerPubkeyB58);
      const initialSellerBalance = initialBalancesByProvider[providerPubkeyB58] ?? 0.1; // Default credit if not tracked
      
      const totalInitial = initialSellerBalance;
      const totalCurrent = sellerBalance + sellerLocked;
      const actualSlash = totalInitial - totalCurrent;
      const balanceDelta = sellerBalance - initialSellerBalance;
      
      // Use provider_id (short) for display, but pubkey_b58 for settlement lookups
      const displayProviderId = providerFromLog?.provider_id || providerPubkeyB58.slice(0, 10);
      
      if (actualSlash > 0 && (result.code === "FAILED_PROOF" || demoMode === "bad-reveal")) {
        console.error(
          `Seller balance: ${fmtMoney(sellerBalance)} (locked: ${fmtMoney(sellerLocked)}) [bond slashed: ${fmtMoney(actualSlash)}, balance delta: ${balanceDelta >= 0 ? "+" : ""}${fmtMoney(balanceDelta)}] [provider: ${displayProviderId}...]`
        );
      } else {
        console.error(
          `Seller balance: ${fmtMoney(sellerBalance)} (locked: ${fmtMoney(sellerLocked)}) [delta: ${balanceDelta >= 0 ? "+" : ""}${fmtMoney(balanceDelta)}] [provider: ${displayProviderId}...]`
        );
      }
    } else {
      console.error(`Seller balance: (unknown — no provider_id available in explain log)`);
    }

    // Extra clarity for proof failures: bond slashing compensation (if applicable)
    if (demoMode === "bad-reveal" || result.code === "FAILED_PROOF") {
      // These come from the compiled policy already printed above:
      const bondMultiple = compiled.base.economics.bonding.seller_bond_multiple;
      const actualPrice = result.agreed_price ?? 0.00008; // Use actual agreed price if available
      const expectedSlash = round8(actualPrice * bondMultiple);

      console.error(`\nBad reveal / FAILED_PROOF economics:`);
      console.error(`  seller_bond_multiple: ${bondMultiple}`);
      console.error(`  agreed_price: ${fmtMoney(actualPrice)}${result.agreed_price ? "" : " (estimated)"}`);
      console.error(`  expected bond slash to buyer: ${fmtMoney(expectedSlash)} (= price × bond_multiple)`);
      console.error(`  NOTE: If buyer balance is +${fmtMoney(expectedSlash)}, that is bond slashing (expected), not a refund bug.`);
    }
    
    // For demo modes, this is expected behavior
    if (isDemoMode && (demoMode === "price-too-high" || demoMode === "timeout" || demoMode === "bad-reveal")) {
      console.error(`\n✅ Demo mode "${demoMode}": Failure is expected behavior.`);
      process.exit(0);
    }
    
    // For stripeFail demo mode, settlement failure is expected
    if (isDemoMode && stripeFail && result.code === "SETTLEMENT_FAILED") {
      console.error(`\n✅ Expected failure demonstrated`);
      process.exit(0);
    }
    
    process.exit(1);
  }
  
  // Display results
  console.log(`✅ Acquire completed successfully`);
  console.log(`\nSelected Provider: ${result.plan.selected_provider_id || "N/A"}`);
  console.log(`Offers Considered: ${result.plan.offers_considered || 1}`);
  console.log(`Offers Eligible: ${result.offers_eligible || result.plan.offers_considered || 1}`);
  console.log(`Intent ID: ${result.intent_id}`);
  console.log(`Buyer Agent: ${truncate(result.buyer_agent_id, 20)}`);
  console.log(`Seller Agent: ${truncate(result.seller_agent_id, 20)}`);
  
  // Print decision log if explain is enabled
  if (result.explain && result.explain.log.length > 0) {
    printSection("Decision Log");
    console.log(`Level: ${result.explain.level}`);
    console.log(`Providers Considered: ${result.explain.providers_considered}`);
    console.log(`Providers Eligible: ${result.explain.providers_eligible}`);
    console.log(`Selected Provider: ${result.explain.selected_provider_id || "N/A"}`);
    console.log(`\nDecisions:`);
    
    for (const decision of result.explain.log) {
      const providerShort = decision.provider_id ? truncate(decision.provider_id, 8) : "-";
      const status = decision.ok ? "✓" : "✗";
      const stepPad = decision.step.padEnd(12);
      console.log(`  [${stepPad}] ${providerShort} ${status} ${decision.code} — ${decision.reason}`);
      
      // Print meta for full level
      if (result.explain.level === "full" && decision.meta && Object.keys(decision.meta).length > 0) {
        const metaStr = JSON.stringify(decision.meta);
        const truncatedMeta = metaStr.length > 100 ? `${metaStr.substring(0, 100)}...` : metaStr;
        console.log(`      meta: ${truncatedMeta}`);
      }
    }
  }
  
  // HTTP Provider Verification section
  if (useHttpProvider && result.verification) {
    const v = result.verification;
    
    // Show different section title for streaming vs hash_reveal
    if (result.plan.settlement === "streaming") {
      printSection("HTTP Streaming Provider");
      console.log(`Chunk envelopes verified: ${v.quoteVerified ? "✅" : "❌"}`);
      console.log(`Signer matched: ${v.signerMatched ? "✅" : "❌"}`);
    } else {
      printSection("HTTP Provider Verification");
      console.log(`Quote envelope verified: ${v.quoteVerified ? "✅" : "❌"}`);
      console.log(`Quote signer matches directory pubkey: ${v.signerMatched ? "✅" : "❌"}`);
      if (v.commitVerified !== undefined && v.revealVerified !== undefined) {
        const bothVerified = v.commitVerified && v.revealVerified;
        console.log(`Commit + Reveal envelopes verified: ${bothVerified ? "✅" : "❌"}`);
      } else {
        console.log(`Commit + Reveal envelopes verified: N/A`);
      }
    }
  }
  
  const receipt = result.receipt;
  
  // Cleanup HTTP server if used
  if (httpServer) {
    httpServer.close();
  }

  // Final Status
  printSection("Final Status");
  
  console.log(`Settlement Mode: ${result.plan.settlement}`);
  if (receipt) {
    console.log(`Receipt:`);
    console.log(`  fulfilled: ${receipt.fulfilled}`);
    if (receipt.failure_code) {
      console.log(`  failure_code: ${receipt.failure_code}`);
    }
    if (receipt.paid_amount !== undefined) {
      console.log(`  paid_amount: ${fmtMoney(receipt.paid_amount)}`);
    }
    if (receipt.ticks !== undefined) {
      console.log(`  ticks: ${receipt.ticks}`);
    }
    if (receipt.chunks !== undefined) {
      console.log(`  chunks: ${receipt.chunks}`);
    }
  }

  console.log(`\nBalances:`);
  const buyerBalance = settlement.getBalance(buyerId);
  const buyerLocked = settlement.getLocked(buyerId);
  const selectedSellerId = result.seller_agent_id;
  const sellerBalance = settlement.getBalance(selectedSellerId);
  const sellerLocked = settlement.getLocked(selectedSellerId);
  
  // Calculate deltas
  const buyerDelta = buyerBalance - initialBuyerBalance;
  const initialSellerBalance = initialBalancesByProvider[selectedSellerId] ?? 0.1; // Default credit if not tracked
  
  const totalInitial = initialSellerBalance;
  const totalCurrent = sellerBalance + sellerLocked;
  const actualSlash = totalInitial - totalCurrent;
  const balanceDelta = sellerBalance - initialSellerBalance;
  
  console.log(`  Buyer:  ${fmtMoney(buyerBalance)} (locked: ${fmtMoney(buyerLocked)}) [delta: ${buyerDelta >= 0 ? "+" : ""}${fmtMoney(buyerDelta)}]`);
  
  // Show bond slash info if applicable (e.g., in bad-reveal scenarios)
  if (actualSlash > 0 && receipt?.failure_code === "FAILED_PROOF") {
    console.log(`  Seller: ${fmtMoney(sellerBalance)} (locked: ${fmtMoney(sellerLocked)}) [bond slashed: ${fmtMoney(actualSlash)}, balance delta: ${balanceDelta >= 0 ? "+" : ""}${fmtMoney(balanceDelta)}]`);
  } else {
    console.log(`  Seller: ${fmtMoney(sellerBalance)} (locked: ${fmtMoney(sellerLocked)}) [delta: ${balanceDelta >= 0 ? "+" : ""}${fmtMoney(balanceDelta)}]`);
  }
  
  // For demo modes, show expected outcome
  if (isDemoMode) {
    console.log(`\n✅ Demo mode "${demoMode}": ${demoMode === "happy" ? "Success!" : "Expected behavior demonstrated."}`);
  }
  
  if (receipt) {
    console.log("\nReceipt JSON:");
    const receiptJson = JSON.stringify(receipt, null, 2);
    console.log(receiptJson);
  }

  // Print reputation stats
  printReputationStats(intentType, buyerId, selectedSellerId, store);

  const separator = "═".repeat(60);
  console.log(`\n${separator}\n`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

