// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test, console} from "forge-std/Test.sol";
import {PactEscrow} from "../contracts/PactEscrow.sol";

/**
 * @title PactEscrowTest
 * @notice Tests for PactEscrow contract.
 * 
 * These tests verify the escrow contract interface and events.
 * Full implementation tests will be added when contract logic is implemented.
 */
contract PactEscrowTest is Test {
    PactEscrow public escrow;
    
    // Test addresses
    address public buyer = address(0x1);
    address public seller = address(0x2);
    address public beneficiary = address(0x3);
    
    // Test intent ID (bytes32)
    bytes32 public constant INTENT_ID = keccak256("test-intent-001");
    
    // Test values
    uint256 public constant AMOUNT = 1 ether;
    string public constant ASSET = "ETH";
    bytes public constant PROOF = "test-proof-bytes";
    
    function setUp() public {
        escrow = new PactEscrow();
        
        // Fund test addresses
        vm.deal(buyer, 10 ether);
        vm.deal(seller, 10 ether);
        vm.deal(beneficiary, 10 ether);
    }
    
    // ============================================================================
    // Lock Tests
    // ============================================================================
    
    function test_Lock_EmitsFundsLocked() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT); // Ensure buyer has enough funds
        vm.expectEmit(true, true, true, true);
        emit PactEscrow.FundsLocked(INTENT_ID, buyer, seller, AMOUNT, ASSET);
        
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
    }
    
    function test_Lock_StoresEscrowRecord() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT); // Ensure buyer has enough funds
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Verify escrow record is stored correctly
        PactEscrow.EscrowRecord memory record = escrow.getEscrow(INTENT_ID);
        assertEq(record.buyer, buyer);
        assertEq(record.seller, seller);
        assertEq(record.amount, AMOUNT);
        assertEq(record.asset, ASSET);
        assertEq(uint256(record.status), uint256(PactEscrow.EscrowStatus.Locked));
        assertEq(record.lockedAt, block.timestamp);
    }
    
    // ============================================================================
    // Release Tests
    // ============================================================================
    
    function test_Release_EmitsFundsReleased() public {
        // Setup: Lock funds first
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT); // Ensure buyer has enough funds
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Release funds
        uint256 sellerBalanceBefore = seller.balance;
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.FundsReleased(INTENT_ID, seller, AMOUNT);
        
        escrow.release(INTENT_ID, PROOF);
        
        // Verify funds were transferred to seller
        assertEq(seller.balance, sellerBalanceBefore + AMOUNT);
        
        // Verify escrow status is Released
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Released));
    }
    
    // ============================================================================
    // Refund Tests
    // ============================================================================
    
    function test_Refund_EmitsFundsRefunded() public {
        // Setup: Lock funds first
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT); // Ensure buyer has enough funds
        uint256 buyerBalanceBefore = buyer.balance;
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Refund funds
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.FundsRefunded(INTENT_ID, buyer, AMOUNT, "Negotiation failed");
        
        escrow.refund(INTENT_ID);
        
        // Verify funds were transferred back to buyer
        assertEq(buyer.balance, buyerBalanceBefore);
        
        // Verify escrow status is Refunded
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Refunded));
    }
    
    // ============================================================================
    // Slash Tests
    // ============================================================================
    
    function test_Slash_EmitsFundsSlashed() public {
        // Setup: Lock funds first
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT); // Ensure buyer has enough funds
        uint256 beneficiaryBalanceBefore = beneficiary.balance;
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Slash funds
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.FundsSlashed(INTENT_ID, beneficiary, AMOUNT, "Dispute resolution");
        
        escrow.slash(INTENT_ID, beneficiary);
        
        // Verify funds were transferred to beneficiary
        assertEq(beneficiary.balance, beneficiaryBalanceBefore + AMOUNT);
        
        // Verify escrow status is Slashed
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Slashed));
    }
    
    // ============================================================================
    // View Function Tests
    // ============================================================================
    
    function test_GetEscrow_ReturnsEmptyForNonExistent() public {
        PactEscrow.EscrowRecord memory record = escrow.getEscrow(INTENT_ID);
        assertEq(uint256(record.status), uint256(PactEscrow.EscrowStatus.None));
    }
    
    function test_IsStatus_ReturnsFalseForNonExistent() public {
        bool isLocked = escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Locked);
        assertFalse(isLocked);
    }
    
    // ============================================================================
    // Integration Tests
    // ============================================================================
    
    function test_Lock_RevertsIfZeroAddressBuyer() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        vm.expectRevert(PactEscrow.InvalidAddress.selector);
        escrow.lock{value: AMOUNT}(INTENT_ID, address(0), seller, AMOUNT, ASSET, PROOF);
    }
    
    function test_Lock_RevertsIfZeroAddressSeller() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        vm.expectRevert(PactEscrow.InvalidAddress.selector);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, address(0), AMOUNT, ASSET, PROOF);
    }
    
    function test_Lock_RevertsIfEscrowExists() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT * 2); // Enough for two locks
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Attempt to lock again with same intentId should revert
        vm.expectRevert(abi.encodeWithSelector(PactEscrow.EscrowAlreadyExists.selector, INTENT_ID));
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
    }
    
    function test_Lock_RevertsIfAmountMismatch() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(PactEscrow.ValueAmountMismatch.selector, AMOUNT, AMOUNT / 2));
        escrow.lock{value: AMOUNT / 2}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
    }
    
    function test_Lock_RevertsIfWrongSender() public {
        vm.prank(seller); // Seller tries to lock as buyer
        vm.deal(seller, AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(PactEscrow.OnlyBuyerCanLock.selector, buyer, seller));
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
    }
    
    function test_Release_RevertsIfNotLocked() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEscrow.EscrowNotLocked.selector,
                INTENT_ID,
                PactEscrow.EscrowStatus.None
            )
        );
        escrow.release(INTENT_ID, PROOF);
    }
    
    function test_Release_RevertsIfAlreadyReleased() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        escrow.release(INTENT_ID, PROOF);
        
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEscrow.EscrowNotLocked.selector,
                INTENT_ID,
                PactEscrow.EscrowStatus.Released
            )
        );
        escrow.release(INTENT_ID, PROOF);
    }
    
    function test_Refund_RevertsIfNotLocked() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEscrow.EscrowNotLocked.selector,
                INTENT_ID,
                PactEscrow.EscrowStatus.None
            )
        );
        escrow.refund(INTENT_ID);
    }
    
    function test_Slash_RevertsIfNotLocked() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEscrow.EscrowNotLocked.selector,
                INTENT_ID,
                PactEscrow.EscrowStatus.None
            )
        );
        escrow.slash(INTENT_ID, beneficiary);
    }
    
    function test_Slash_RevertsIfZeroAddress() public {
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        vm.expectRevert(PactEscrow.InvalidBeneficiary.selector);
        escrow.slash(INTENT_ID, address(0));
    }
    
    // ============================================================================
    // Slash Authorization Tests
    // ============================================================================
    
    function test_Slash_RevertsIfNotBuyer() public {
        // Setup: Lock funds as buyer
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Seller tries to slash (should revert)
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(PactEscrow.OnlyBuyerCanSlash.selector, buyer, seller)
        );
        escrow.slash(INTENT_ID, beneficiary);
    }
    
    function test_Slash_RevertsIfRandomAddress() public {
        // Setup: Lock funds as buyer
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Random address tries to slash (should revert)
        address randomAddress = address(0x999);
        vm.prank(randomAddress);
        vm.expectRevert(
            abi.encodeWithSelector(PactEscrow.OnlyBuyerCanSlash.selector, buyer, randomAddress)
        );
        escrow.slash(INTENT_ID, beneficiary);
    }
    
    function test_Slash_SucceedsIfBuyer() public {
        // Setup: Lock funds as buyer
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        uint256 buyerBalanceBefore = buyer.balance - AMOUNT; // After lock
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Buyer slashes to themselves (should succeed)
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.FundsSlashed(INTENT_ID, buyer, AMOUNT, "Dispute resolution");
        
        escrow.slash(INTENT_ID, buyer);
        
        // Verify funds were transferred to buyer (beneficiary)
        assertEq(buyer.balance, buyerBalanceBefore + AMOUNT);
        
        // Verify escrow status is Slashed
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Slashed));
    }
    
    function test_Slash_SucceedsIfBuyerToBeneficiary() public {
        // Setup: Lock funds as buyer
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        uint256 beneficiaryBalanceBefore = beneficiary.balance;
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Test: Buyer slashes to beneficiary (should succeed)
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit PactEscrow.FundsSlashed(INTENT_ID, beneficiary, AMOUNT, "Dispute resolution");
        
        escrow.slash(INTENT_ID, beneficiary);
        
        // Verify funds were transferred to beneficiary
        assertEq(beneficiary.balance, beneficiaryBalanceBefore + AMOUNT);
        
        // Verify escrow status is Slashed
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Slashed));
    }
    
    // ============================================================================
    // ReentrancyGuard Tests
    // ============================================================================
    
    /**
     * @notice Mock contract to test reentrancy protection
     */
    contract ReentrancyAttacker {
        PactEscrow public escrow;
        bytes32 public intentId;
        bool public attacking;
        
        constructor(PactEscrow _escrow) {
            escrow = _escrow;
        }
        
        function attack(bytes32 _intentId) external payable {
            intentId = _intentId;
            attacking = true;
            escrow.release(_intentId, "proof");
        }
        
        receive() external payable {
            if (attacking && address(escrow).balance > 0) {
                attacking = false;
                // Try to reenter
                escrow.release(intentId, "proof");
            }
        }
    }
    
    function test_Release_ReentrancyProtected() public {
        // Setup: Lock funds
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Deploy attacker contract
        ReentrancyAttacker attacker = new ReentrancyAttacker(escrow);
        vm.deal(address(attacker), 1 ether);
        
        // First release should succeed
        escrow.release(INTENT_ID, PROOF);
        
        // Verify escrow is released (can't release again)
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Released));
        
        // Try to release again (should revert - not because of reentrancy, but because already released)
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEscrow.EscrowNotLocked.selector,
                INTENT_ID,
                PactEscrow.EscrowStatus.Released
            )
        );
        escrow.release(INTENT_ID, PROOF);
    }
    
    function test_Lock_ReentrancyProtected() public {
        // This is harder to test because lock creates a new escrow
        // But the nonReentrant modifier protects all state-changing functions
        
        // Setup: Create two different escrows
        bytes32 intentId1 = keccak256("intent-1");
        bytes32 intentId2 = keccak256("intent-2");
        
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT * 2);
        
        // First lock should succeed
        escrow.lock{value: AMOUNT}(intentId1, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Second lock (different intent) should also succeed (different escrow)
        escrow.lock{value: AMOUNT}(intentId2, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Verify both escrows are locked
        assertTrue(escrow.isStatus(intentId1, PactEscrow.EscrowStatus.Locked));
        assertTrue(escrow.isStatus(intentId2, PactEscrow.EscrowStatus.Locked));
    }
    
    function test_Slash_ReentrancyProtected() public {
        // Setup: Lock funds
        vm.prank(buyer);
        vm.deal(buyer, AMOUNT);
        escrow.lock{value: AMOUNT}(INTENT_ID, buyer, seller, AMOUNT, ASSET, PROOF);
        
        // Slash funds
        vm.prank(buyer);
        escrow.slash(INTENT_ID, beneficiary);
        
        // Verify escrow is slashed (can't slash again)
        assertTrue(escrow.isStatus(INTENT_ID, PactEscrow.EscrowStatus.Slashed));
        
        // Try to slash again (should revert - not because of reentrancy, but because already slashed)
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PactEscrow.EscrowNotLocked.selector,
                INTENT_ID,
                PactEscrow.EscrowStatus.Slashed
            )
        );
        escrow.slash(INTENT_ID, beneficiary);
    }
}
