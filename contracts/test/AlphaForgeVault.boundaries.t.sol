// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import {
    AlphaForgeTestBTC,
    AlphaForgeTestETH,
    AlphaForgeTestUSDC
} from "../src/AlphaForgeTestAsset.sol";
import { AlphaForgeVault } from "../src/AlphaForgeVault.sol";
import { StrategyPass } from "../src/StrategyPass.sol";
import { AlphaForgeVaultHarness } from "./harness/AlphaForgeVaultHarness.sol";
import { ConfigurableAsset } from "./mocks/ConfigurableAsset.sol";

interface VaultBoundaryVm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
}

contract AlphaForgeVaultBoundaryTest {
    VaultBoundaryVm private constant VM =
        VaultBoundaryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ALICE = address(0xA11CE);
    address private constant CREATOR = address(0xC0FFEE);
    bytes32 private constant STRATEGY_ID = keccak256("boundary-strategy");
    bytes32 private constant STRATEGY_REF = keccak256("ipfs://boundary-v1");

    StrategyPass private pass;
    AlphaForgeTestUSDC private usdc;
    AlphaForgeTestETH private eth;
    AlphaForgeTestBTC private btc;
    AlphaForgeVaultHarness private vault;

    function setUp() public {
        pass = new StrategyPass("Boundary Pass", "AF-BOUND", STRATEGY_ID, 1_000 ether, ALICE);
        usdc = new AlphaForgeTestUSDC(1_000_000e6, ALICE);
        eth = new AlphaForgeTestETH(1_000 ether, address(this));
        btc = new AlphaForgeTestBTC(1_000 ether, address(this));
        vault = _deployHarness();

        VM.startPrank(ALICE);
        usdc.approve(address(vault), type(uint256).max);
        pass.approve(address(vault), type(uint256).max);
        VM.stopPrank();
    }

    // Closed is terminal for owner lifecycle calls and read-side withdrawal capacity.
    function test_ClosedVaultRejectsLifecycleMutationsAndReportsNoWithdrawableUsdc() public {
        VM.prank(ALICE);
        vault.close();

        VM.startPrank(ALICE);
        (bool deposited,) = address(vault).call(abi.encodeCall(vault.deposit, (1)));
        (bool withdrawn,) = address(vault).call(abi.encodeCall(vault.withdraw, (1)));
        (bool closedAgain,) = address(vault).call(abi.encodeCall(vault.close, ()));
        VM.stopPrank();

        require(!deposited && !withdrawn && !closedAgain, "closed lifecycle mutation accepted");
        require(vault.withdrawableUsdc() == 0, "closed Vault reported withdrawable USDC");
    }

    // Zero and over-balance withdrawals must fail before accounting or settlement moves.
    function test_WithdrawalRejectsZeroAndAmountAboveTrackedBalance() public {
        VM.startPrank(ALICE);
        (bool zeroSuccess,) = address(vault).call(abi.encodeCall(vault.withdraw, (0)));
        (bool excessSuccess,) = address(vault).call(abi.encodeCall(vault.withdraw, (1)));
        VM.stopPrank();

        require(!zeroSuccess && !excessSuccess, "invalid withdrawal accepted");
        require(vault.principalBasis() == 0, "invalid withdrawal changed principal");
        require(vault.trackedUsdcBalance() == 0, "invalid withdrawal changed balance");
    }

    // Rescue entry points reject meaningless targets and empty value after terminal close.
    function test_PostCloseRescueRejectsZeroTokenAndEmptyNativeBalance() public {
        VM.prank(ALICE);
        vault.close();

        VM.startPrank(ALICE);
        (bool zeroTokenSuccess,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(0))));
        (bool emptyNativeSuccess,) = address(vault).call(abi.encodeCall(vault.rescueNative, ()));
        VM.stopPrank();

        require(!zeroTokenSuccess, "zero token rescue accepted");
        require(!emptyNativeSuccess, "empty native rescue accepted");
        (bool zeroQuerySuccess,) =
            address(vault).staticcall(abi.encodeCall(vault.untrackedExcess, (address(0))));
        require(!zeroQuerySuccess, "zero token excess query accepted");
    }

    // Compiler-compatible ERC-20 metadata is insufficient without the Strategy Pass identity API.
    function test_ConstructorRejectsTokenWithoutStrategyIdentityAndUsdcAssetAlias() public {
        ConfigurableAsset ordinary =
            new ConfigurableAsset("Ordinary", "ORD", 18, 1_000 ether, ALICE);
        require(
            !_tryDeploy(address(ordinary), address(usdc), address(eth), address(btc)),
            "token without Strategy ID accepted"
        );
        require(
            !_tryDeploy(address(pass), address(usdc), address(usdc), address(btc)),
            "USDC and investment asset alias accepted"
        );
    }

    // Test-only seeded accounting reaches the overflow guard without requiring impossible supply.
    function test_DepositRejectsAccountingOverflowBeforeMovingFunds() public {
        vault.seedAccountingForTest(type(uint256).max, 0);
        VM.prank(ALICE);
        (bool success,) = address(vault).call(abi.encodeCall(vault.deposit, (1)));

        require(!success, "overflowing deposit accepted");
        require(vault.principalBasis() == type(uint256).max, "overflow guard changed principal");
        require(vault.trackedUsdcBalance() == 0, "overflow guard changed tracked balance");
        require(usdc.balanceOf(address(vault)) == 0, "overflow guard moved USDC");
    }

    // Internal position accounting independently rejects unsupported and unfunded assets.
    function test_TrackedPositionRejectsUnsupportedAndUnfundedAmounts() public {
        (bool unsupported,) =
            address(vault).call(abi.encodeCall(vault.setTrackedPositionForTest, (address(usdc), 1)));
        (bool unfunded,) =
            address(vault).call(abi.encodeCall(vault.setTrackedPositionForTest, (address(eth), 1)));

        require(!unsupported, "unsupported tracked asset accepted");
        require(!unfunded, "unfunded tracked position accepted");
        require(vault.openTrackedPositionCount() == 0, "failed position changed open count");
        require(vault.trackedPosition(address(eth)) == 0, "failed position changed accounting");
    }

    function _deployHarness() private returns (AlphaForgeVaultHarness) {
        return new AlphaForgeVaultHarness(
            ALICE,
            CREATOR,
            STRATEGY_ID,
            STRATEGY_REF,
            address(pass),
            address(usdc),
            address(eth),
            address(btc)
        );
    }

    function _tryDeploy(address pass_, address usdc_, address eth_, address btc_)
        private
        returns (bool success)
    {
        try new AlphaForgeVault(
            ALICE, CREATOR, STRATEGY_ID, STRATEGY_REF, pass_, usdc_, eth_, btc_
        ) returns (
            AlphaForgeVault
        ) {
            return true;
        } catch {
            return false;
        }
    }
}
