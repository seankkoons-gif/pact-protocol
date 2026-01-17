# pact-escrow-evm

Ethereum smart contract implementation of escrow for PACT protocol transactions.

## Purpose

This repository provides on-chain escrow functionality for PACT protocol negotiations. It implements the execution boundary between PACT (negotiation protocol) and Ethereum (execution layer).

**PACT does NOT implement escrow.** Escrow is an external execution boundary that integrators choose based on their requirements:
- On-chain: Smart contracts (this repository)
- Off-chain: Payment processors (Stripe, PayPal)
- Hybrid: Custom escrow services

## How It Integrates with Pact SDK

The PACT SDK negotiates terms and provides proofs. This escrow contract executes fund locking and release:

```
1. PACT SDK: Negotiate price → Agreed price: 0.0001 ETH
2. PACT SDK: Generate proof → Proof: <opaque bytes>
3. Escrow Contract: lock(intentId, buyer, 0.0001 ETH, "ETH", proof)
4. PACT SDK: Complete acquisition → Receipt: <fulfillment proof>
5. Escrow Contract: release(intentId, <fulfillment proof>)
```

The PACT SDK provides:
- Intent ID (authority identifier)
- Proof (opaque bytes that prove conditions are met)
- Buyer/seller addresses

The escrow contract provides:
- Fund custody (locking until conditions met)
- Release mechanism (when proof validates)
- Refund mechanism (if negotiation fails)
- Slashing mechanism (for disputes)

## Why Escrow is External

PACT is a protocol layer, not an execution layer. Escrow is external because:

1. **Chain-agnostic core**: PACT works with any chain (Ethereum, Solana, Bitcoin) or no chain (fiat payments). Escrow is chain-specific.

2. **Replaceable execution**: Integrators choose their execution backend. Some use on-chain escrow (this repo), others use payment processors, custom services, or hybrid approaches.

3. **Separation of concerns**: PACT negotiates and coordinates. Execution (escrow, payment, delivery) is the integrator's responsibility.

4. **Flexibility**: Different use cases require different escrow models:
   - High-value: On-chain smart contracts (this repo)
   - Low-value: Payment processors (Stripe, PayPal)
   - Custom: Domain-specific escrow services

## Contract Interface

### `lock(intentId, buyer, amount, asset, proof)`
Locks funds in escrow until conditions are met. Called by integrator after PACT negotiation completes.

### `release(intentId, proof)`
Releases funds from escrow to seller. Called by integrator when PACT provides fulfillment proof.

### `refund(intentId)`
Refunds funds from escrow to buyer. Called by integrator when negotiation fails or is rejected.

### `slash(intentId, beneficiary)`
Slashes funds from escrow (for disputes). Called by integrator when PACT dispute resolution determines slashing.

## Architecture Position

**Escrow is out of SDK scope.** This package (`pact-escrow-evm`) is a separate, optional package that integrates with the PACT SDK but is not part of it. This design:

- **Keeps SDK chain-agnostic**: The SDK works with any chain or no chain (fiat)
- **Allows flexible execution**: Integrators choose their execution backend (on-chain escrow, payment processors, custom)
- **Maintains clean boundaries**: SDK negotiates; execution backends handle fund custody

The SDK provides a clean integration surface (intent IDs, proofs, addresses). This escrow contract implements one execution backend option.

## Development Status

✅ **Core implementation complete** - `lock`, `release`, `refund`, `slash` functions fully implemented with security rails (ReentrancyGuard, access control, events).

## License

[To be determined]
