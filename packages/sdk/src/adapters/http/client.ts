import type {
  ProviderQuoteRequest,
  ProviderQuoteResponse,
  CommitRequest,
  CommitResponse,
  RevealRequest,
  RevealResponse,
  StreamChunkRequest,
  StreamChunkResponse,
} from "./types";
import type { SignedEnvelope } from "../../protocol/envelope";
import type { CredentialMessage } from "../../kya/types";

export async function fetchQuote(
  baseUrl: string,
  quoteReq: ProviderQuoteRequest
): Promise<{ envelope: SignedEnvelope }> {
  const response = await fetch(`${baseUrl}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quoteReq),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json() as ProviderQuoteResponse;
  
  // Prefer envelope format (v1 signed)
  if (data.envelope) {
    return { envelope: data.envelope };
  }
  
  // Legacy format: construct unsigned ASK message (backward compatibility)
  // Note: This is only for compatibility; v1 providers should return signed envelopes
  if (data.ask) {
    const askMsg = {
      protocol_version: "pact/1.0" as const,
      type: "ASK" as const,
      intent_id: quoteReq.intent_id,
      price: data.ask.price,
      unit: data.ask.unit,
      latency_ms: data.ask.latency_ms,
      valid_for_ms: data.ask.valid_for_ms,
      bond_required: data.ask.bond_required,
      sent_at_ms: Date.now(),
      expires_at_ms: Date.now() + data.ask.valid_for_ms,
    };
    
    // Return as envelope structure (but unsigned - caller should verify)
    return {
      envelope: {
        envelope_version: "pact-envelope/1.0",
        message: askMsg,
        message_hash_hex: "", // Not signed
        signer_public_key_b58: "", // Not signed
        signature_b58: "", // Not signed
        signed_at_ms: Date.now(),
      } as SignedEnvelope,
    };
  }
  
  throw new Error("Invalid quote response: missing envelope or ask");
}

export async function fetchCommit(
  baseUrl: string,
  commitReq: CommitRequest
): Promise<{ envelope: SignedEnvelope }> {
  const response = await fetch(`${baseUrl}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(commitReq),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json() as CommitResponse;
  return { envelope: data.envelope };
}

export async function fetchReveal(
  baseUrl: string,
  revealReq: RevealRequest
): Promise<RevealResponse> {
  const response = await fetch(`${baseUrl}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(revealReq),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json() as RevealResponse;
  return data;
}

export async function fetchStreamChunk(
  baseUrl: string,
  chunkReq: StreamChunkRequest
): Promise<{ envelope: SignedEnvelope }> {
  const response = await fetch(`${baseUrl}/stream/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chunkReq),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json() as StreamChunkResponse;
  return { envelope: data.envelope };
}

export async function fetchCredential(
  baseUrl: string,
  intentType?: string
): Promise<{ envelope: SignedEnvelope<CredentialMessage> }> {
  const url = intentType 
    ? `${baseUrl}/credential?intent=${encodeURIComponent(intentType)}`
    : `${baseUrl}/credential`;
  
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { envelope: SignedEnvelope<CredentialMessage> };
  return { envelope: data.envelope };
}

/**
 * Send a signed Pact protocol envelope to the /pact endpoint.
 * This is the standard way to communicate with Pact protocol providers.
 */
export async function fetchPact(
  baseUrl: string,
  envelope: SignedEnvelope
): Promise<{ envelope: SignedEnvelope }> {
  const response = await fetch(`${baseUrl}/pact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  if (response.status === 404) {
    const errorText = await response.text();
    throw new Error(`PACT-421: Provider API mismatch - /pact endpoint not found: ${errorText}`);
  }

  if (!response.ok) {
    let errorText: string;
    try {
      const errorJson = await response.json() as Record<string, unknown>;
      errorText = typeof errorJson.error === "string" ? errorJson.error : JSON.stringify(errorJson);
    } catch {
      errorText = await response.text();
    }
    throw new Error(`PACT-422: Provider bad request - HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json() as SignedEnvelope;
  return { envelope: data };
}

