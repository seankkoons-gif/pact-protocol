# PACT Escrow Contract Integration Guide

This guide explains how to integrate the PACT escrow contract for on-chain fund custody in PACT protocol negotiations.

## Overview

The PACT escrow contract (`PactEscrow.sol`) provides on-chain fund custody for PACT protocol transactions. It implements the execution boundary between PACT (negotiation protocol) and Ethereum (execution layer).

**Important: Escrow is out of SDK scope.** The `pact-escrow-evm` package is a separate, optional package that lives alongside the SDK. The SDK provides negotiation and coordination; integrators choose their execution backend (on-chain escrow, payment processors, or custom services). This design keeps the SDK chain-agnostic and execution-agnostic.

**Key Design Principles:**
- Intent ID is the authority (all operations keyed by `intentId`)
- Proof is opaque bytes (contract doesn't interpret proof, only validates it exists)
- No pricing logic (pricing determined by PACT, not this contract)
- No PACT imports (this is an external execution boundary)

**Security Rails:**
- **ReentrancyGuard**: All state-changing functions protected against reentrancy attacks
- **Slash Authorization**: Only buyer (who locked funds) can call `slash()` - prevents unauthorized slashing
- **Events**: All state changes emit events for on-chain transparency and off-chain monitoring

## Contract Interface

### `lock(bytes32 intentId, address buyer, address seller, uint256 amount, string asset, bytes proof)`

Locks funds in escrow until conditions are met. Called by integrator after PACT negotiation completes.

**Parameters:**
- `intentId`: The PACT intent ID (authority identifier)
- `buyer`: The buyer address (funds sender)
- `seller`: The seller address (funds recipient, if released)
- `amount`: The amount to lock (must equal `msg.value` for native ETH)
- `asset`: The asset identifier (e.g., "ETH", "USDC")
- `proof`: Opaque proof bytes from PACT (not interpreted by contract)

**Requirements:**
- Escrow must not already exist for this `intentId`
- `amount` must be greater than zero
- `msg.value` must equal `amount` (for native ETH)
- `msg.sender` must equal `buyer`
- `proof.length` must be greater than zero

**Gas-Efficient Errors:**
- `EscrowAlreadyExists(bytes32 intentId)`: Escrow already exists for this intent ID
- `InvalidAmount()`: Amount must be greater than zero
- `ValueAmountMismatch(uint256 expected, uint256 actual)`: msg.value doesn't match amount
- `OnlyBuyerCanLock(address expected, address actual)`: Only buyer can lock funds
- `ProofRequired()`: Proof must be provided

**Example:**
```solidity
// After PACT negotiation completes
bytes32 intentId = keccak256("pact-intent-123");
address buyer = 0x...;
address seller = 0x...;
uint256 agreedPrice = 0.0001 ether;
bytes memory proof = hex"abc123...";

// Buyer calls lock with native ETH
escrow.lock{value: agreedPrice}(intentId, buyer, seller, agreedPrice, "ETH", proof);
```

### `release(bytes32 intentId, bytes proof)`

Releases funds from escrow to seller. Called by integrator when PACT provides fulfillment proof.

**Parameters:**
- `intentId`: The PACT intent ID
- `proof`: Opaque proof bytes from PACT (fulfillment proof, not interpreted)

**Requirements:**
- Escrow must exist and be in `Locked` status
- `proof.length` must be greater than zero

**Gas-Efficient Errors:**
- `EscrowNotLocked(bytes32 intentId, EscrowStatus currentStatus)`: Escrow must exist and be Locked
- `ProofRequired()`: Proof must be provided
- `TransferFailed(address recipient, uint256 amount)`: Transfer to seller failed

**Example:**
```solidity
// After PACT completes acquisition
bytes32 intentId = keccak256("pact-intent-123");
bytes memory fulfillmentProof = hex"def456...";

// Any address can call release (typically integrator or buyer)
escrow.release(intentId, fulfillmentProof);
```

### `refund(bytes32 intentId)`

Refunds funds from escrow to buyer. Called by integrator when negotiation fails or is rejected.

**Parameters:**
- `intentId`: The PACT intent ID

**Requirements:**
- Escrow must exist and be in `Locked` status

**Gas-Efficient Errors:**
- `EscrowNotLocked(bytes32 intentId, EscrowStatus currentStatus)`: Escrow must exist and be Locked
- `TransferFailed(address recipient, uint256 amount)`: Transfer to buyer failed

**Example:**
```solidity
// When negotiation fails
bytes32 intentId = keccak256("pact-intent-123");

// Any address can call refund (typically integrator or buyer)
escrow.refund(intentId);
```

### `slash(bytes32 intentId, address beneficiary)`

Slashes funds from escrow (for disputes). Called by **buyer** when PACT dispute resolution determines slashing.

**Authorization Model:**
- **Only the buyer** (who locked funds) can call `slash()`
- This security rail prevents unauthorized slashing by malicious actors
- Integrator calls this on behalf of buyer after PACT dispute resolution determines slashing is warranted
- Buyer typically slashes when seller breaches agreement (funds go to buyer as beneficiary)

**Parameters:**
- `intentId`: The PACT intent ID
- `beneficiary`: The address receiving slashed funds (typically buyer for seller breach)

**Requirements:**
- Escrow must exist and be in `Locked` status
- `msg.sender` must be the buyer who locked funds (authorization check)
- `beneficiary` must not be zero address

**Gas-Efficient Errors:**
- `EscrowNotLocked(bytes32 intentId, EscrowStatus currentStatus)`: Escrow must exist and be Locked
- `OnlyBuyerCanSlash(address expected, address actual)`: Only buyer can slash funds
- `InvalidBeneficiary()`: Beneficiary cannot be zero address
- `TransferFailed(address recipient, uint256 amount)`: Transfer to beneficiary failed

**Security Note:**
Slash authorization prevents unauthorized slashing:
- **Buyer can slash**: Buyer who locked funds can slash (e.g., when seller breaches)
- **Seller cannot slash**: Seller cannot slash funds (prevents malicious slashing)
- **Random addresses cannot slash**: Only buyer has authority to slash their locked funds

**Example:**
```solidity
// When PACT dispute resolution determines slashing
bytes32 intentId = keccak256("pact-intent-123");
address buyer = 0x...; // Beneficiary (buyer gets slashed funds when seller breaches)

// Buyer calls slash (or integrator calls on buyer's behalf)
// Must be called by buyer account or with buyer's signature
escrow.slash(intentId, buyer);
```

## Security Features

### ReentrancyGuard

All state-changing functions (`lock`, `release`, `refund`, `slash`) are protected with explicit `nonReentrant` modifier:

```solidity
function release(bytes32 intentId, bytes calldata proof) external nonReentrant {
    // ... implementation
}
```

**Protection:**
- Prevents reentrancy attacks on external calls (`call{value:}`)
- Uses simple locked/unlocked state pattern for gas efficiency
- All transfers happen after state updates (checks-effects-interactions pattern)

### Slash Authorization

Only the buyer (who locked funds) can call `slash()`:

```solidity
function slash(bytes32 intentId, address beneficiary) external nonReentrant {
    // Authorization: Only buyer can slash
    if (msg.sender != escrow.buyer) {
        revert OnlyBuyerCanSlash(escrow.buyer, msg.sender);
    }
    // ... implementation
}
```

**Authorization Model:**
- **Buyer-only**: Only `escrow.buyer` can call `slash()`
- **Prevents malicious slashing**: Seller or random addresses cannot slash funds
- **Integrator pattern**: Integrator can call on behalf of buyer (if buyer provides signature/authorization)

### Events

All state changes emit events for transparency and monitoring:

```solidity
event FundsLocked(bytes32 indexed intentId, address indexed buyer, address indexed seller, uint256 amount, string asset);
event FundsReleased(bytes32 indexed intentId, address indexed seller, uint256 amount);
event FundsRefunded(bytes32 indexed intentId, address indexed buyer, uint256 amount, string reason);
event FundsSlashed(bytes32 indexed intentId, address indexed beneficiary, uint256 amount, string reason);
```

**Event Benefits:**
- **On-chain transparency**: All escrow operations are publicly visible
- **Off-chain monitoring**: Services can monitor escrow lifecycle via events
- **Indexed fields**: `intentId`, `buyer`, `seller`, `beneficiary` are indexed for efficient filtering

## Integration Flow

### 1. PACT Negotiation Phase

```typescript
// PACT SDK negotiates price
const result = await acquire({
  input: {
    intentType: "weather.data",
    scope: "NYC",
    maxPrice: 0.0002,
    // ... other params
  },
  // ... other config
});

if (!result.ok) {
  // Negotiation failed - no escrow needed
  return;
}

const intentId = result.receipt.intent_id;
const agreedPrice = result.receipt.agreed_price;
const proof = `transcript:${path.basename(result.transcriptPath)}`;
```

### 2. Lock Funds in Escrow

```solidity
// Buyer calls lock with native ETH
escrow.lock{value: agreedPrice}(
    intentId,
    buyerAddress,
    sellerAddress,
    agreedPrice,
    "ETH",
    bytes(proof)
);
```

### 3. PACT Completes Acquisition

```typescript
// PACT continues with acquisition...
// Receipt is generated with fulfillment status
```

### 4. Release Funds (Success Path)

```solidity
// When fulfillment is confirmed
bytes memory fulfillmentProof = abi.encodePacked(
    "receipt:",
    receiptId,
    ":fulfilled:",
    fulfilled ? "true" : "false"
);

escrow.release(intentId, fulfillmentProof);
```

### 5. Refund Funds (Failure Path)

```solidity
// If negotiation fails or is rejected
escrow.refund(intentId);
```

### 6. Slash Funds (Dispute Path)

```solidity
// If dispute resolution determines slashing
address beneficiary = buyerAddress; // or sellerAddress depending on breach
escrow.slash(intentId, beneficiary);
```

## Security Considerations

### Reentrancy Protection

The contract uses the **checks-effects-interactions** pattern:
1. **Checks**: Validate escrow status and parameters
2. **Effects**: Update escrow status **before** transfer
3. **Interactions**: Transfer funds after status update

This prevents reentrancy attacks because status is updated before external calls.

### Transfer Safety

- Uses `call{value:}()` instead of `transfer()` for better gas compatibility with modern wallets
- Validates transfer success and reverts on failure
- Emits events before transfers for auditability

### Input Validation

- All parameters are validated before state changes
- Zero address checks for beneficiary
- Amount and value matching for native ETH
- Proof presence validation (opaque, not interpreted)

### State Transition Enforcement

- Only `Locked` escrows can be released/refunded/slashed
- Status transitions are atomic (status updated before transfer)
- No state transitions possible after terminal states (`Released`, `Refunded`, `Slashed`)

## Gas Optimization

The contract uses **custom errors** instead of `require()` strings for gas efficiency:

```solidity
// Instead of: require(condition, "Error message");  // ~250 gas
// We use: if (!condition) revert CustomError();     // ~50 gas
```

This saves approximately **200 gas per error** in revert scenarios.

## Testing

See `pact-escrow-evm/test/PactEscrow.t.sol` for comprehensive test coverage:

- Positive cases: lock, release, refund, slash
- Edge cases: balance verification, status checks
- Revert cases: invalid operations, wrong sender, zero address
- Integration tests: full flow from lock to release/refund/slash

Run tests with Foundry:
```bash
cd pact-escrow-evm
forge test
```

## Future Enhancements

Potential improvements (not yet implemented):

1. **ERC20 Token Support**: Separate functions for ERC20 token escrow
2. **Access Control**: Optional owner/operator roles for dispute resolution
3. **Time-Based Refunds**: Automatic refund after timeout period
4. **Multi-Asset Escrow**: Support multiple assets in single escrow
5. **Event Indexing**: Additional indexed fields for off-chain filtering

## License

[To be determined]

---

**Note**: This contract is in early development. Always test thoroughly before deploying to mainnet.
