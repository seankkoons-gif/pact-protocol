# Wallet Signature Verification Guide

This guide explains how wallet signature verification works in PACT, with a focus on the EthersWalletAdapter implementation.

## Overview

PACT uses wallet adapters to sign and verify wallet actions. The verification process ensures that signatures are cryptographically valid and match the expected signer address.

## Signature Format

PACT wallet signatures use the **EIP-191** standard (Ethereum Signed Message):

```typescript
interface WalletSignature {
  chain: "evm" | "solana" | "unknown";
  signer: string;          // 0x-prefixed hex address (EVM) or base58 pubkey (Solana)
  signature: Uint8Array;   // 65 bytes for EIP-191, 64 bytes for Ed25519
  payload_hash: string;    // SHA-256 hash (hex) of action payload
  scheme: "eip191" | "ed25519";
}
```

## Message Format

When signing a wallet action, the message format is:

```
PACT Wallet Action\n{payload_hash}
```

Where `payload_hash` is the SHA-256 hash of the canonicalized wallet action:

```typescript
const payload = JSON.stringify({
  action: action.action,
  asset_symbol: action.asset_symbol,
  amount: action.amount,
  from: action.from.toLowerCase(),
  to: action.to.toLowerCase(),
  memo: action.memo || "",
  idempotency_key: action.idempotency_key || "",
});
const payload_hash = sha256Hex(payload);
```

## Ethers Wallet Verification

### Implementation

The `EthersWalletAdapter.verify()` method performs full cryptographic verification:

```typescript
verify(signature: WalletSignature, action: WalletAction): boolean {
  // 1. Verify signer matches action.from
  if (signature.signer.toLowerCase() !== action.from.toLowerCase()) {
    return false;
  }
  
  // 2. Reconstruct the message that was signed
  const message = `PACT Wallet Action\n${signature.payload_hash}`;
  const messageBytes = new TextEncoder().encode(message);
  
  // 3. Verify signature format (65 bytes for EIP-191)
  if (signature.signature.length !== 65) {
    return false;
  }
  
  // 4. Verify scheme matches
  if (signature.scheme !== "eip191") {
    return false;
  }
  
  // 5. Recover signer from signature using ethers
  const signatureHex = bytesToHex(signature.signature);
  const { verifyMessage } = require("ethers");
  const recoveredAddress = verifyMessage(messageBytes, signatureHex);
  
  // 6. Verify recovered address matches expected signer
  return recoveredAddress.toLowerCase() === signature.signer.toLowerCase();
}
```

### Verification Steps

1. **Signer Match Check**: Ensures `signature.signer` matches `action.from` (case-insensitive)
2. **Message Reconstruction**: Reconstructs the exact message that was signed
3. **Format Validation**: Verifies signature is 65 bytes (EIP-191 format)
4. **Scheme Validation**: Ensures signature uses "eip191" scheme
5. **Cryptographic Verification**: Uses `ethers.verifyMessage()` to recover signer address
6. **Address Comparison**: Compares recovered address with expected signer

### Error Handling

The verification method includes error handling for production use:

```typescript
try {
  // ... verification logic ...
  return isValid;
} catch (verifyError: any) {
  // Log error for debugging (in production, send to monitoring)
  console.warn(
    `[EthersWalletAdapter.verify] Verification failed: ${verifyError?.message}`
  );
  
  // Return false for safety (signature cannot be verified)
  return false;
}
```

**Error Scenarios:**
- Ethers not available (ESM environment): Returns `false`
- Signature recovery fails: Returns `false` with warning log
- Invalid signature format: Returns `false` early
- Address mismatch: Returns `false` early

## Usage Example

### Signing

```typescript
import { EthersWalletAdapter } from "@pact/sdk";

const adapter = await EthersWalletAdapter.create(privateKey);

const walletAction = {
  action: "authorize" as const,
  asset_symbol: "USDC",
  amount: 0.0001,
  from: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  to: "0x1234567890123456789012345678901234567890",
  memo: "PACT authorization",
  idempotency_key: "test-001",
};

const signature = await adapter.sign(walletAction);
// Returns: { chain, signer, signature, payload_hash, scheme }
```

### Verifying

```typescript
// Later, verify the signature
const isValid = adapter.verify(signature, walletAction);

if (isValid) {
  console.log("Signature is valid!");
} else {
  console.error("Signature verification failed");
}
```

### Verifying Without Original Action

If you only have the signature and payload_hash, you can reconstruct verification:

```typescript
// Reconstruct message from payload_hash
const message = `PACT Wallet Action\n${signature.payload_hash}`;
const messageBytes = new TextEncoder().encode(message);

// Use ethers directly
import { verifyMessage } from "ethers";
const signatureHex = "0x" + Array.from(signature.signature)
  .map(b => b.toString(16).padStart(2, "0"))
  .join("");

const recoveredAddress = verifyMessage(messageBytes, signatureHex);
const isValid = recoveredAddress.toLowerCase() === signature.signer.toLowerCase();
```

## Security Considerations

### Cryptographic Verification

The implementation uses `ethers.verifyMessage()`, which:
- Implements EIP-191 standard correctly
- Recovers signer address from signature cryptographically
- Validates signature format before recovery
- Handles edge cases (invalid signatures, wrong format)

### Defense in Depth

Multiple validation layers:
1. **Early Exit Checks**: Format and scheme validation before cryptographic operations
2. **Address Matching**: Compares both action.from and recovered address
3. **Error Handling**: Fails safely (returns `false`) on any error
4. **Logging**: Warns on verification failures for debugging/monitoring

### ESM Compatibility

The implementation handles both CommonJS and ESM environments:

```typescript
try {
  // Try CommonJS require (works in Node.js)
  const { verifyMessage } = require("ethers");
  // ... verification ...
} catch (verifyError: any) {
  // If require() fails (ESM), we can't verify synchronously
  // Return false for safety
  return false;
}
```

**Note**: In ESM-only environments, verification may not work. Consider:
- Using dynamic import: `const { verifyMessage } = await import("ethers")`
- Making verification async: `async verify(...)`
- Using a factory pattern to inject ethers instance

## Testing

See `packages/sdk/src/wallets/__tests__/ethers.test.ts` for test coverage:

- Valid signature verification
- Invalid signature rejection
- Wrong action rejection
- Different signatures for different actions

Run tests:
```bash
pnpm -C packages/sdk test src/wallets/__tests__/ethers.test.ts
```

## Comparison with Previous Version

### Previous Implementation (Incomplete)

```typescript
// Only checked format, didn't verify cryptographically
if (signature.signature.length !== 65) return false;
if (signature.scheme !== "eip191") return false;
return true; // Trusted format check, not actual verification
```

### Current Implementation (Complete)

```typescript
// Full cryptographic verification using ethers
const recoveredAddress = verifyMessage(messageBytes, signatureHex);
return recoveredAddress.toLowerCase() === signature.signer.toLowerCase();
```

**Improvements:**
- ✅ Actual cryptographic verification (not just format checks)
- ✅ Signer address recovery and comparison
- ✅ Production-ready error handling
- ✅ Debugging support with warning logs
- ✅ Maintains backward compatibility

## Future Enhancements

Potential improvements:

1. **Async Verification**: Make verification async for ESM compatibility
2. **Batch Verification**: Verify multiple signatures efficiently
3. **Signature Caching**: Cache verification results for performance
4. **Custom Error Types**: Use typed errors for better error handling
5. **Monitoring Integration**: Send verification failures to monitoring service

## Replay Verification

When replaying historical transcripts, wallet signature verification failures (`WALLET_VERIFY_FAILED`) are treated as **warnings**, not errors. This is because:

1. **Historical Transcript Formats**: Older transcripts may have been created before wallet signature verification was fully implemented
2. **Payload Hash Calculation**: The payload hash calculation may have changed over time
3. **Replay Context**: Wallet signatures are validated during live negotiation, but replay focuses on transcript integrity

Both `CREDENTIAL_EXPIRED` and `WALLET_VERIFY_FAILED` are always warnings in replay verification, even in strict mode:

```bash
# Warnings for wallet verification failures are expected
pnpm replay:verify -- .pact/transcripts

# Even in strict mode, wallet failures remain warnings
pnpm replay:verify --strict -- .pact/transcripts
```

## License

[To be determined]

---

**Note**: Always verify signatures before trusting wallet actions in production. In replay verification, wallet signature failures are treated as warnings for historical transcripts.
