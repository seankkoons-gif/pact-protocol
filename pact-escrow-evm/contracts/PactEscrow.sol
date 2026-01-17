// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title PactEscrow
 * @notice Ethereum escrow contract for PACT protocol transactions.
 * 
 * This contract implements the execution boundary between PACT (negotiation protocol)
 * and Ethereum (execution layer). PACT provides intent IDs and proofs; this contract
 * handles fund custody and release.
 * 
 * Key design principles:
 * - Intent ID is the authority (all operations keyed by intentId)
 * - Proof is opaque bytes (contract doesn't interpret proof, only validates it exists)
 * - No pricing logic (pricing determined by PACT, not this contract)
 * - No PACT imports (this is an external execution boundary)
 * - Explicit reentrancy protection via ReentrancyGuard
 * - Buyer-only slash authorization (security rail)
 */
contract PactEscrow {
    // ============================================================================
    // ReentrancyGuard (Explicit Protection)
    // ============================================================================
    
    /**
     * @notice Reentrancy guard state variable.
     * @dev Uses simple locked/unlocked state pattern for gas efficiency.
     */
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    
    /**
     * @notice Reentrancy guard modifier.
     * @dev Prevents reentrant calls to protected functions.
     */
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    // ============================================================================
    // Custom Errors (gas-efficient)
    // ============================================================================
    
    error EscrowAlreadyExists(bytes32 intentId);
    error InvalidAmount();
    error ValueAmountMismatch(uint256 expected, uint256 actual);
    error OnlyBuyerCanLock(address expected, address actual);
    error ProofRequired();
    error EscrowNotLocked(bytes32 intentId, EscrowStatus currentStatus);
    error TransferFailed(address recipient, uint256 amount);
    error InvalidBeneficiary();
    error InvalidAddress(); // Zero address check
    error InsufficientBalance(uint256 required, uint256 available); // Contract balance check
    error OnlyBuyerCanSlash(address expected, address actual); // Slash authorization
    
    // ============================================================================
    // Events
    // ============================================================================
    
    /**
     * @notice Emitted when funds are locked in escrow.
     * @param intentId The PACT intent ID (authority identifier)
     * @param buyer The buyer address
     * @param seller The seller address (from escrow record)
     * @param amount The amount locked
     * @param asset The asset identifier (e.g., "ETH", "USDC")
     */
    event FundsLocked(
        bytes32 indexed intentId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        string asset
    );
    
    /**
     * @notice Emitted when funds are released from escrow to seller.
     * @param intentId The PACT intent ID
     * @param seller The seller address receiving funds
     * @param amount The amount released
     */
    event FundsReleased(
        bytes32 indexed intentId,
        address indexed seller,
        uint256 amount
    );
    
    /**
     * @notice Emitted when funds are refunded from escrow to buyer.
     * @param intentId The PACT intent ID
     * @param buyer The buyer address receiving refund
     * @param amount The amount refunded
     * @param reason The reason for refund (optional)
     */
    event FundsRefunded(
        bytes32 indexed intentId,
        address indexed buyer,
        uint256 amount,
        string reason
    );
    
    /**
     * @notice Emitted when funds are slashed (for disputes).
     * @param intentId The PACT intent ID
     * @param beneficiary The address receiving slashed funds
     * @param amount The amount slashed
     * @param reason The reason for slashing
     */
    event FundsSlashed(
        bytes32 indexed intentId,
        address indexed beneficiary,
        uint256 amount,
        string reason
    );
    
    // ============================================================================
    // Storage
    // ============================================================================
    
    /**
     * @notice Escrow record structure.
     * @param buyer The buyer address
     * @param seller The seller address
     * @param amount The amount locked
     * @param asset The asset identifier
     * @param lockedAt Timestamp when funds were locked
     * @param status Current status of escrow
     */
    struct EscrowRecord {
        address buyer;
        address seller;
        uint256 amount;
        string asset;
        uint256 lockedAt;
        EscrowStatus status;
    }
    
    /**
     * @notice Escrow status enumeration.
     */
    enum EscrowStatus {
        None,      // Escrow doesn't exist
        Locked,    // Funds locked, awaiting release/refund/slash
        Released,  // Funds released to seller
        Refunded,  // Funds refunded to buyer
        Slashed    // Funds slashed (dispute resolution)
    }
    
    /**
     * @notice Mapping from intent ID to escrow record.
     * Intent ID is the authority - all operations keyed by intentId.
     */
    mapping(bytes32 => EscrowRecord) public escrows;
    
    // ============================================================================
    // Public Functions
    // ============================================================================
    
    /**
     * @notice Lock funds in escrow.
     * @dev Called by integrator after PACT negotiation completes.
     * @param intentId The PACT intent ID (authority identifier)
     * @param buyer The buyer address (funds sender)
     * @param seller The seller address (funds recipient, if released)
     * @param amount The amount to lock
     * @param asset The asset identifier (e.g., "ETH", "USDC")
     * @param proof Opaque proof bytes from PACT (not interpreted by contract)
     * 
     * Requirements:
     * - Escrow must not already exist for this intentId
     * - Amount must be greater than zero
     * - Buyer must have sufficient balance and approve this contract
     */
    function lock(
        bytes32 intentId,
        address buyer,
        address seller,
        uint256 amount,
        string calldata asset,
        bytes calldata proof
    ) external payable nonReentrant {
        // Validate escrow doesn't exist
        if (escrows[intentId].status != EscrowStatus.None) {
            revert EscrowAlreadyExists(intentId);
        }
        
        // Validate addresses are not zero
        if (buyer == address(0)) {
            revert InvalidAddress();
        }
        if (seller == address(0)) {
            revert InvalidAddress();
        }
        
        // Validate amount is greater than zero
        if (amount == 0) {
            revert InvalidAmount();
        }
        
        // Validate msg.value matches amount (for native ETH)
        if (msg.value != amount) {
            revert ValueAmountMismatch(amount, msg.value);
        }
        
        // Validate msg.sender is the buyer
        if (msg.sender != buyer) {
            revert OnlyBuyerCanLock(buyer, msg.sender);
        }
        
        // Validate proof is provided (opaque, just check it's not empty)
        if (proof.length == 0) {
            revert ProofRequired();
        }
        
        // Create escrow record
        escrows[intentId] = EscrowRecord({
            buyer: buyer,
            seller: seller,
            amount: amount,
            asset: asset,
            lockedAt: block.timestamp,
            status: EscrowStatus.Locked
        });
        
        // Emit FundsLocked event
        emit FundsLocked(intentId, buyer, seller, amount, asset);
    }
    
    /**
     * @notice Release funds from escrow to seller.
     * @dev Called by integrator when PACT provides fulfillment proof.
     * @param intentId The PACT intent ID
     * @param proof Opaque proof bytes from PACT (fulfillment proof, not interpreted)
     * 
     * Requirements:
     * - Escrow must exist and be in Locked status
     * - Proof must be provided (validation happens off-chain via PACT)
     */
    function release(
        bytes32 intentId,
        bytes calldata proof
    ) external nonReentrant {
        EscrowRecord storage escrow = escrows[intentId];
        
        // Validate escrow exists and is Locked
        if (escrow.status != EscrowStatus.Locked) {
            revert EscrowNotLocked(intentId, escrow.status);
        }
        
        // Validate proof exists (opaque, just check it's not empty)
        if (proof.length == 0) {
            revert ProofRequired();
        }
        
        // Store amount and seller address before updating status (for gas efficiency and event emission)
        uint256 amount = escrow.amount;
        address sellerAddress = escrow.seller;
        
        // Validate contract has sufficient balance (defensive check)
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        
        // Update escrow status to Released (before transfer to prevent reentrancy)
        escrow.status = EscrowStatus.Released;
        
        // Transfer funds to seller (native ETH)
        // Note: Use call() instead of transfer() for better gas compatibility
        (bool success, ) = payable(sellerAddress).call{value: amount}("");
        if (!success) {
            revert TransferFailed(sellerAddress, amount);
        }
        
        // Emit FundsReleased event
        emit FundsReleased(intentId, escrow.seller, amount);
    }
    
    /**
     * @notice Refund funds from escrow to buyer.
     * @dev Called by integrator when negotiation fails or is rejected.
     * @param intentId The PACT intent ID
     * 
     * Requirements:
     * - Escrow must exist and be in Locked status
     */
    function refund(
        bytes32 intentId
    ) external nonReentrant {
        EscrowRecord storage escrow = escrows[intentId];
        
        // Validate escrow exists and is Locked
        if (escrow.status != EscrowStatus.Locked) {
            revert EscrowNotLocked(intentId, escrow.status);
        }
        
        // Store amount and buyer address before updating status (for gas efficiency)
        uint256 amount = escrow.amount;
        address buyerAddress = escrow.buyer;
        
        // Validate contract has sufficient balance (defensive check)
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        
        // Update escrow status to Refunded (before transfer to prevent reentrancy)
        escrow.status = EscrowStatus.Refunded;
        
        // Transfer funds back to buyer (native ETH)
        // Note: Use call() instead of transfer() for better gas compatibility
        (bool success, ) = payable(buyerAddress).call{value: amount}("");
        if (!success) {
            revert TransferFailed(buyerAddress, amount);
        }
        
        // Emit FundsRefunded event
        emit FundsRefunded(intentId, escrow.buyer, amount, "Negotiation failed");
    }
    
    /**
     * @notice Slash funds from escrow (for disputes).
     * @dev Called by buyer when PACT dispute resolution determines slashing.
     * 
     * Authorization Model:
     * - Only the buyer (who locked funds) can call slash()
     * - This prevents unauthorized slashing by malicious actors
     * - Buyer typically slashes when seller breaches (funds go to buyer as beneficiary)
     * - Integrator calls this on behalf of buyer after PACT dispute resolution
     * 
     * @param intentId The PACT intent ID
     * @param beneficiary The address receiving slashed funds (typically buyer for seller breach)
     * 
     * Requirements:
     * - Escrow must exist and be in Locked status
     * - msg.sender must be the buyer who locked funds
     * - beneficiary must not be zero address
     */
    function slash(
        bytes32 intentId,
        address beneficiary
    ) external nonReentrant {
        EscrowRecord storage escrow = escrows[intentId];
        
        // Validate escrow exists and is Locked
        if (escrow.status != EscrowStatus.Locked) {
            revert EscrowNotLocked(intentId, escrow.status);
        }
        
        // Validate beneficiary is not zero address
        if (beneficiary == address(0)) {
            revert InvalidBeneficiary();
        }
        
        // Authorization: Only buyer can slash (security rail)
        if (msg.sender != escrow.buyer) {
            revert OnlyBuyerCanSlash(escrow.buyer, msg.sender);
        }
        
        // Store amount before updating status (for gas efficiency)
        uint256 amount = escrow.amount;
        
        // Validate contract has sufficient balance (defensive check)
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        
        // Update escrow status to Slashed (before transfer to prevent reentrancy)
        escrow.status = EscrowStatus.Slashed;
        
        // Transfer funds to beneficiary (native ETH)
        // Note: Use call() instead of transfer() for better gas compatibility
        (bool success, ) = payable(beneficiary).call{value: amount}("");
        if (!success) {
            revert TransferFailed(beneficiary, amount);
        }
        
        // Emit FundsSlashed event
        emit FundsSlashed(intentId, beneficiary, amount, "Dispute resolution");
    }
    
    // ============================================================================
    // View Functions
    // ============================================================================
    
    /**
     * @notice Get escrow record for an intent ID.
     * @param intentId The PACT intent ID
     * @return Escrow record (or empty if doesn't exist)
     */
    function getEscrow(bytes32 intentId) external view returns (EscrowRecord memory) {
        return escrows[intentId];
    }
    
    /**
     * @notice Check if escrow exists and is in a specific status.
     * @param intentId The PACT intent ID
     * @param status The status to check
     * @return True if escrow exists and is in the specified status
     */
    function isStatus(bytes32 intentId, EscrowStatus status) external view returns (bool) {
        return escrows[intentId].status == status;
    }
}
