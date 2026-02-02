export interface Manifest {
  transcript_id: string;
  constitution_version: string;
  constitution_hash: string;
  created_at_ms: number;
  tool_version: string;
  /** Audit tier (informational only; default T1). Does not affect verification. */
  audit_tier?: 'T1' | 'T2' | 'T3';
  audit_sla?: string;
  /** Optional passport / pack metadata (display only). */
  passport_snapshot?: unknown;
  passport_last_updated_ms?: number;
}

export interface GCView {
  version: string;
  executive_summary: {
    status: string;
    what_happened: string;
    money_moved: boolean;
    final_outcome: string;
    settlement_attempted: boolean;
  };
  integrity: {
    hash_chain: 'VALID' | 'INVALID';
    signatures_verified: {
      verified: number;
      total: number;
    };
    final_hash_validation: 'MATCH' | 'MISMATCH' | 'UNVERIFIABLE';
    notes?: string[];
  };
  responsibility: {
    dbl_version?: string;
    judgment?: {
      fault_domain?: string;
      required_next_actor?: string;
      required_action?: string;
      terminal?: boolean;
      responsible_signer_pubkey?: string;
      confidence: number;
    };
    last_valid_signed_hash: string;
    blame_explanation: string;
  };
  constitution: {
    version: string;
    hash: string;
    rules_applied: string[];
  };
  /** Audit tier metadata (informational only). Tier affects audit schedule, not transaction admissibility. */
  audit?: {
    tier: 'T1' | 'T2' | 'T3';
    sla?: string;
    note: string;
  };
  gc_takeaways?: {
    approval_risk?: 'LOW' | 'MEDIUM' | 'HIGH';
    why?: string[];
    open_questions?: string[];
    recommended_remediation?: string[];
  };
  subject?: {
    transcript_id_or_hash: string;
    intent_fingerprint?: string;
    parties?: Array<{
      role: 'buyer' | 'provider';
      signer_pubkey: string;
    }>;
  };
}

export interface Judgment {
  version: string;
  dblDetermination: string;
  requiredNextActor: 'BUYER' | 'PROVIDER' | 'RAIL' | 'SETTLEMENT' | 'ARBITER' | 'NONE';
  requiredAction: string;
  terminal: boolean;
  confidence: number;
  /** Optional passport impact from DBL (display only). */
  passportImpact?: number;
  responsible_signer_pubkey?: string;
}

export interface InsurerSummary {
  version: string;
  coverage: 'COVERED' | 'COVERED_WITH_SURCHARGE' | 'ESCROW_REQUIRED' | 'EXCLUDED';
  risk_factors: string[];
  surcharges: string[];
  buyer?: {
    tier: 'A' | 'B' | 'C';
    passport_score: number;
  };
  provider?: {
    tier: 'A' | 'B' | 'C';
    passport_score: number;
  };
  constitution_warning?: string;
  /** Audit tier (informational only). Does not affect verification. */
  audit_tier?: 'T1' | 'T2' | 'T3';
  audit_sla?: string;
}

/** Optional Merkle digest (Evidence plane). Additive anchor only; not verification instead of PoN. Institution-grade: constitution_hash + optional signer/signature. */
export interface MerkleDigest {
  version: string;
  date_utc: string;
  root: string;
  leaf_hash: string;
  proof: string[];
  leaf_index: number;
  tree_size: number;
  /** Pack constitution hash; required for attestation when digest present */
  constitution_hash?: string;
  signer?: string;
  signature?: string;
}

/** Minimal transcript round for timeline (v4 schema). */
export interface TranscriptRoundView {
  round_number: number;
  round_type: string;
  agent_id?: string;
  public_key_b58?: string;
  signature?: { signer_public_key_b58?: string };
}

/** Minimal transcript root for timeline (v4 schema). */
export interface TranscriptView {
  rounds?: TranscriptRoundView[];
}

/** Replay/verify result with optional per-round errors (verifier output). */
export interface ReplayVerifyResultView {
  rounds_verified?: number;
  errors?: Array<{ type?: string; round_number?: number; message?: string }>;
}

/** Pack verify result (auditor-pack-verify output). Used for top-level integrity. */
export interface PackVerifyResultView {
  ok?: boolean;
  recompute_ok?: boolean;
  checksums_ok?: boolean;
  mismatches?: string[];
}

/** Client-side integrity computed from pack contents only (no network). */
export interface IntegrityResult {
  status: 'VALID' | 'TAMPERED' | 'INDETERMINATE';
  checksums: {
    status: 'VALID' | 'INVALID' | 'UNAVAILABLE';
    checkedCount: number;
    totalCount: number;
    failures: string[];
  };
  hashChain: {
    status: 'VALID' | 'INVALID';
    details?: string;
  };
  signatures: {
    status: 'VALID' | 'INVALID' | 'UNVERIFIABLE' | 'UNAVAILABLE';
    verifiedCount: number;
    totalCount: number;
    failures: string[];
  };
  warnings: string[];
}

export interface AuditorPackData {
  manifest: Manifest;
  gcView: GCView;
  judgment: Judgment;
  insurerSummary: InsurerSummary;
  checksums: string;
  constitution: string;
  transcript?: string;
  transcriptId: string; // Extracted from transcript.json or fallback sources
  zipFile?: File;
  /** Optional Merkle digest; present when pack was built with --merkle-digest */
  merkleDigest?: MerkleDigest;
  /** @deprecated Packs do not contain pack_verify.json; use integrityResult instead. */
  packVerifyResult?: unknown;
  /** @deprecated Packs do not contain replay_verify.json. */
  replayVerifyResult?: unknown;
  /** How the pack was loaded; drives verify command (repo-root path vs <file>). */
  source: 'demo_public' | 'drag_drop';
  /** When source === 'demo_public': path under public (e.g. "packs/auditor_pack_success.zip"). */
  demoPublicPath?: string;
  /** When source === 'drag_drop': original file name (e.g. "my_pack.zip"). */
  fileName?: string;
  /** @deprecated Use source + demoPublicPath for verify command. */
  verifyPath?: string;
  /** Client-side integrity from pack contents (input/transcript.json hash chain, checksums, signatures). */
  integrityResult?: IntegrityResult;
  /** Temporary debug info for INDETERMINATE (which step failed, found files, etc.). */
  integrityDebug?: {
    transcriptFound: boolean;
    transcriptPath: string | null;
    checksumsFound: boolean;
    checksumsPath: string | null;
    zipEntryCount: number;
  };
}
