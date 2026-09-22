// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { AlphaForgeVault } from "../src/AlphaForgeVault.sol";
import {
    AlphaForgeTestBTC,
    AlphaForgeTestETH,
    AlphaForgeTestUSDC
} from "../src/AlphaForgeTestAsset.sol";
import { PassLocker } from "../src/PassLocker.sol";
import { StrategyPass } from "../src/StrategyPass.sol";

interface Phase1DeploymentVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
}

/// @notice Repeats the Phase One deployment and owner lifecycle entirely inside the Forge VM.
/// @dev This is local execution evidence only. It never selects an RPC endpoint or broadcasts.
contract Phase1DeploymentRehearsalTest {
    Phase1DeploymentVm private constant VM =
        Phase1DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant CREATOR = address(0xC0FFEE);
    address private constant RECIPIENT = address(0xB0B);
    bytes32 private constant STRATEGY_ID = keccak256("phase-one-strategy");
    bytes32 private constant STRATEGY_REF = keccak256("phase-one-strategy-v1");

    function test_RehearseDeploymentAndCompleteOwnerLifecycleWithoutExternalRpc() public {
        StrategyPass pass =
            new StrategyPass("AlphaForge Phase One Pass", "AF-P1", STRATEGY_ID, 100 ether, OWNER);
        AlphaForgeTestUSDC usdc = new AlphaForgeTestUSDC(100e6, OWNER);
        AlphaForgeTestETH afEth = new AlphaForgeTestETH(10 ether, address(this));
        AlphaForgeTestBTC afBtc = new AlphaForgeTestBTC(1 ether, address(this));
        AlphaForgeVault vault = new AlphaForgeVault(
            OWNER,
            CREATOR,
            STRATEGY_ID,
            STRATEGY_REF,
            address(pass),
            address(usdc),
            address(afEth),
            address(afBtc)
        );
        PassLocker locker = PassLocker(vault.passLocker());

        require(address(pass).code.length != 0, "Pass deployment missing code");
        require(address(vault).code.length != 0, "Vault deployment missing code");
        require(address(locker).code.length != 0, "Locker deployment missing code");
        require(vault.owner() == OWNER, "explicit owner mismatch");
        require(vault.strategyCreator() == CREATOR, "creator mismatch");
        require(vault.strategyId() == STRATEGY_ID, "Vault strategy mismatch");
        require(pass.strategyId() == STRATEGY_ID, "Pass strategy mismatch");
        require(locker.vault() == address(vault), "Locker controller mismatch");
        require(locker.owner() == OWNER, "Locker owner mismatch");

        VM.prank(OWNER);
        require(pass.transfer(RECIPIENT, 1), "one-wei Pass transfer failed");
        VM.prank(RECIPIENT);
        require(pass.transfer(OWNER, 1), "one-wei Pass return failed");

        VM.startPrank(OWNER);
        require(usdc.approve(address(vault), 10e6), "USDC approval failed");
        require(pass.approve(address(vault), 10 ether), "Pass approval failed");
        vault.deposit(10e6);
        VM.stopPrank();

        require(usdc.allowance(OWNER, address(vault)) == 0, "USDC approval not finite");
        require(pass.allowance(OWNER, address(vault)) == 0, "Pass approval not finite");
        require(vault.principalBasis() == 10e6, "deposit principal mismatch");
        require(vault.trackedUsdcBalance() == 10e6, "deposit balance mismatch");
        require(locker.lockedBalance() == 10 ether, "deposit Pass lock mismatch");

        require(afEth.transfer(address(vault), 1), "test dust transfer failed");
        require(vault.untrackedExcess(address(afEth)) == 1, "test dust became reserved");

        VM.prank(OWNER);
        vault.withdraw(4e6);
        require(vault.principalBasis() == 6e6, "withdraw principal mismatch");
        require(locker.lockedBalance() == 6 ether, "withdraw Pass release mismatch");

        VM.prank(OWNER);
        vault.close();
        require(vault.closed(), "close did not complete");
        require(vault.principalBasis() == 0, "close retained principal");
        require(vault.trackedUsdcBalance() == 0, "close retained USDC accounting");
        require(locker.lockedBalance() == 0, "close retained Pass lock");
        require(usdc.balanceOf(OWNER) == 100e6, "owner did not recover USDC");
        require(pass.balanceOf(OWNER) == 100 ether, "owner did not recover Pass");

        VM.prank(OWNER);
        require(vault.rescueUntrackedToken(address(afEth)) == 1, "dust rescue mismatch");
        require(afEth.balanceOf(OWNER) == 1, "owner did not receive rescued token");

        VM.deal(address(vault), 1);
        uint256 ownerNativeBefore = OWNER.balance;
        VM.prank(OWNER);
        require(vault.rescueNative() == 1, "native rescue mismatch");
        require(OWNER.balance == ownerNativeBefore + 1, "owner did not receive native rescue");
    }

    function test_DeployerAndCreatorCannotOperateTheOwnerVault() public {
        StrategyPass pass =
            new StrategyPass("AlphaForge Phase One Pass", "AF-P1", STRATEGY_ID, 1 ether, OWNER);
        AlphaForgeTestUSDC usdc = new AlphaForgeTestUSDC(1e6, OWNER);
        AlphaForgeTestETH afEth = new AlphaForgeTestETH(1 ether, address(this));
        AlphaForgeTestBTC afBtc = new AlphaForgeTestBTC(1 ether, address(this));
        AlphaForgeVault vault = new AlphaForgeVault(
            OWNER,
            CREATOR,
            STRATEGY_ID,
            STRATEGY_REF,
            address(pass),
            address(usdc),
            address(afEth),
            address(afBtc)
        );

        (bool deployerDeposit,) = address(vault).call(abi.encodeCall(vault.deposit, (1)));
        VM.prank(CREATOR);
        (bool creatorClose,) = address(vault).call(abi.encodeCall(vault.close, ()));
        require(!deployerDeposit, "deployer acquired owner authority");
        require(!creatorClose, "creator acquired owner authority");
        require(!vault.closed(), "unauthorized operation closed Vault");
    }
}
