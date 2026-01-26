/**
 * @pact/passport
 * 
 * Pact Passport v4 - Agent reputation and credit scoring system.
 */

export { PassportStorage } from "./storage";
export { MemoryPassportStorage } from "./storage-memory";
export { ingestTranscriptOutcome, ingestDisputeOutcome, type IngestionResult } from "./ingestion";
export { computePassportScore, type ScoreResult, type ScoreBreakdown } from "./scoring";
export { queryPassport, requirePassport, clearCache, type PassportQueryResponse, type PassportPolicyResult, type PassportDenialReason } from "./query";
export { startPassportServer, type PassportServer } from "./server";
export { getPassportReplayContext, narratePassportDenial, narrateCreditDecision, type PassportReplayContext, type CreditReplayContext } from "./replayer";
export type { TranscriptV4, PassportEvent, PassportScore, PassportEventType } from "./types";

// Credit v1 exports
export {
  computeCreditTerms,
  canExtendCredit,
  applyCreditEventFromTranscript,
} from "./credit/riskEngine";
export {
  mapCreditDenialToFailureEvent,
  shouldTriggerCreditKillSwitch,
} from "./credit/failureIntegration";
export type {
  CreditTerms,
  CreditDecision,
  CreditTier,
  CreditEvent,
  CreditAccount,
  CreditExposure,
  PerCounterpartyExposure,
  CreditEventReasonCode,
} from "./credit/types";

// Passport v1 exports
export * as passportV1 from "./v1";
