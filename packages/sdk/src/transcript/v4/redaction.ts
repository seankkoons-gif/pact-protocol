/**
 * Pact v4 Transcript Redaction
 * 
 * Structural redaction of transcripts for cross-trust-boundary sharing.
 */

import * as crypto from "node:crypto";
import { stableCanonicalize } from "../../protocol/canonical";
import type { TranscriptV4, TranscriptRound, FailureEvent } from "./replay";

export type TranscriptView = "INTERNAL" | "PARTNER" | "AUDITOR";

export type RedactedField = {
  redacted: true;
  hash: string;
  view: TranscriptView;
};

export type RedactedTranscriptV4 = Omit<TranscriptV4, "policy_hash" | "strategy_hash" | "rounds" | "failure_event"> & {
  // Fields may be redacted (replaced with RedactedField)
  policy_hash?: string | RedactedField;
  strategy_hash?: string | RedactedField;
  rounds?: Array<TranscriptRound | RedactedRound>;
  failure_event?: FailureEvent | RedactedFailureEvent;
};

export type RedactedRound = TranscriptRound & {
  content_summary?: Record<string, unknown> | RedactedField;
};

export type RedactedFailureEvent = FailureEvent & {
  evidence_refs?: Array<string | RedactedField>;
};

/**
 * Compute hash of content for redaction.
 */
function computeContentHash(content: any): string {
  const canonical = stableCanonicalize(content);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return hash;
}

/**
 * Create redacted field replacement.
 */
function createRedactedField(original: any, view: TranscriptView): RedactedField {
  const hash = computeContentHash(original);
  return {
    redacted: true,
    hash,
    view,
  };
}

/**
 * Redact transcript according to view.
 * 
 * Requirements:
 * - Deterministic (same transcript + view → same output)
 * - Preserves cryptographic invariants (transcript_id, signatures)
 * - Replaces sensitive fields with redacted markers
 * 
 * @param transcript Original transcript
 * @param view View type (INTERNAL, PARTNER, AUDITOR)
 * @returns Redacted transcript
 */
export function redactTranscript(
  transcript: TranscriptV4,
  view: TranscriptView
): RedactedTranscriptV4 {
  // INTERNAL view: no redaction
  if (view === "INTERNAL") {
    return transcript as RedactedTranscriptV4;
  }

  // Clone transcript (deep copy)
  const redacted: RedactedTranscriptV4 = {
    ...transcript,
    rounds: transcript.rounds.map((round) => ({ ...round })),
  };

  // PARTNER view redaction
  if (view === "PARTNER") {
    // Redact policy hash (if sensitive)
    // Note: We preserve policy_hash for now, but could redact if policy content is sensitive
    // For MVP, we'll preserve policy_hash but redact strategy details

    // Redact strategy hash (if sensitive)
    if (transcript.strategy_hash) {
      redacted.strategy_hash = createRedactedField(transcript.strategy_hash, view);
    }

    // Redact proprietary pricing logic in rounds
    redacted.rounds = transcript.rounds.map((round) => {
      const redactedRound: RedactedRound = { ...round };
      
      if (round.content_summary) {
        // Redact pricing_logic if present
        if ("pricing_logic" in round.content_summary) {
          const summary = { ...round.content_summary };
          const pricingLogic = summary.pricing_logic;
          delete summary.pricing_logic;
          summary.pricing_logic = createRedactedField(pricingLogic, view);
          redactedRound.content_summary = summary;
        }

        // Redact strategy_details if present
        if ("strategy_details" in round.content_summary) {
          const summary = { ...round.content_summary };
          const strategyDetails = summary.strategy_details;
          delete summary.strategy_details;
          summary.strategy_details = createRedactedField(strategyDetails, view);
          redactedRound.content_summary = summary;
        }
      }

      return redactedRound;
    });

    // Redact evidence content (structure preserved)
    if (transcript.failure_event) {
      const redactedFailure: RedactedFailureEvent = {
        ...transcript.failure_event,
        evidence_refs: transcript.failure_event.evidence_refs.map((ref) => {
          // Preserve structure, redact content if proprietary
          // For MVP, preserve all evidence_refs
          return ref;
        }),
      };
      redacted.failure_event = redactedFailure;
    }
  }

  // AUDITOR view redaction
  if (view === "AUDITOR") {
    // Redact policy hash
    if (transcript.policy_hash) {
      redacted.policy_hash = createRedactedField(transcript.policy_hash, view);
    }

    // Redact strategy hash
    if (transcript.strategy_hash) {
      redacted.strategy_hash = createRedactedField(transcript.strategy_hash, view);
    }

    // Redact negotiation detail (content_summary)
    redacted.rounds = transcript.rounds.map((round) => {
      const redactedRound: RedactedRound = { ...round };
      
      if (round.content_summary) {
        // Redact entire content_summary (negotiation detail)
        redactedRound.content_summary = createRedactedField(round.content_summary, view);
      }

      return redactedRound;
    });

    // Redact evidence content (structure preserved)
    if (transcript.failure_event) {
      const redactedFailure: RedactedFailureEvent = {
        ...transcript.failure_event,
        evidence_refs: transcript.failure_event.evidence_refs.map((ref) => {
          // Redact evidence content if proprietary
          // For MVP, preserve structure but could redact content
          return ref;
        }),
      };
      redacted.failure_event = redactedFailure;
    }
  }

  // Ensure transcript_id is preserved (invariant)
  redacted.transcript_id = transcript.transcript_id;

  return redacted;
}

/**
 * Verify redacted field hash matches original content.
 * 
 * @param redactedField Redacted field
 * @param originalContent Original content
 * @returns true if hash matches
 */
export function verifyRedactedField(
  redactedField: RedactedField,
  originalContent: any
): boolean {
  const computedHash = computeContentHash(originalContent);
  return computedHash === redactedField.hash;
}

/**
 * Check if field is redacted.
 */
export function isRedacted(field: any): field is RedactedField {
  return (
    typeof field === "object" &&
    field !== null &&
    "redacted" in field &&
    field.redacted === true &&
    "hash" in field &&
    "view" in field
  );
}
