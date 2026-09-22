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
import { ConfigurableAsset, ConfigurableStrategyPass } from "./mocks/ConfigurableAsset.sol";
import { ReentrantAsset } from "./mocks/ReentrantAsset.sol";

interface VaultRescueVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
}

contract AlphaForgeVaultRescueTest {
    VaultRescueVm private constant VM =
        VaultRescueVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CREATOR = address(0xC0FFEE);
    bytes32 private constant STRATEGY_ID = keccak256("trend");
    bytes32 private constant STRATEGY_REF = keccak256("ipfs://trend-v1");

    StrategyPass private pass;
    AlphaForgeTestUSDC private usdc;
    AlphaForgeTestETH private eth;
    AlphaForgeTestBTC private btc;
    ConfigurableAsset private dust;
    AlphaForgeVault private vault;

    AlphaForgeVault private callbackVault;
    bool private nativeCallbackEnabled;
    bool private nativeCallbackAttempted;
    bool private nativeCallbackSucceeded;

    receive() external payable {
        if (nativeCallbackEnabled && !nativeCallbackAttempted) {
            nativeCallbackAttempted = true;
            (nativeCallbackSucceeded,) =
                address(callbackVault).call(abi.encodeCall(callbackVault.rescueNative, ()));
        }
    }

    function setUp() public {
        pass = new StrategyPass(
            "AlphaForge Trend Pass", "AF-TREND", STRATEGY_ID, 1_000_000 ether, ALICE
        );
        usdc = new AlphaForgeTestUSDC(1_000_000e6, ALICE);
        eth = new AlphaForgeTestETH(10_000 ether, address(this));
        btc = new AlphaForgeTestBTC(1_000 ether, address(this));
        dust = new ConfigurableAsset("Unknown Dust", "DUST", 18, 1_000 ether, address(this));
        vault = _deploy(ALICE, address(pass), address(usdc));
        _approveAndDeposit(vault, pass, usdc, ALICE, 100e6);
    }

    // Catches rescue being used as an active-Vault privileged withdrawal path.
    function test_ActiveVaultCannotRescueTokenOrNative() public {
        require(dust.transfer(address(vault), 1 ether), "dust transfer failed");
        VM.deal(address(vault), 1 wei);
        VM.prank(ALICE);
        (bool tokenSuccess,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(dust))));
        VM.prank(ALICE);
        (bool nativeSuccess,) = address(vault).call(abi.encodeCall(vault.rescueNative, ()));
        require(!tokenSuccess && !nativeSuccess, "active rescue accepted");
        require(dust.balanceOf(address(vault)) == 1 ether, "active token rescue moved dust");
        require(address(vault).balance == 1 wei, "active native rescue moved dust");
    }

    // Catches rescue authority or recipient drifting from the immutable owner.
    function test_OnlyOwnerCanRescueAndRecipientIsFixedOwner() public {
        require(dust.transfer(address(vault), 3 ether), "dust transfer failed");
        VM.prank(ALICE);
        vault.close();
        VM.prank(BOB);
        (bool unauthorized,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(dust))));
        require(!unauthorized, "non-owner rescue accepted");
        uint256 ownerBefore = dust.balanceOf(ALICE);
        VM.prank(ALICE);
        uint256 rescued = vault.rescueUntrackedToken(address(dust));
        require(rescued == 3 ether, "wrong rescue amount");
        require(dust.balanceOf(ALICE) == ownerBefore + 3 ether, "owner did not receive rescue");
        require(dust.balanceOf(BOB) == 0, "third party received rescue");
    }

    // Catches subtracting one token's accounting units from another token's excess.
    function test_RescueUsesEachTokenRawUnitsAndOnlyActualMinusReserved() public {
        require(dust.transfer(address(vault), 7), "dust transfer failed");
        VM.prank(ALICE);
        require(usdc.transfer(address(vault), 25e6), "USDC dust transfer failed");
        require(vault.untrackedExcess(address(dust)) == 7, "dust excess mismatch");
        require(vault.untrackedExcess(address(usdc)) == 25e6, "USDC excess mismatch");
        VM.prank(ALICE);
        vault.close();
        VM.prank(ALICE);
        require(vault.rescueUntrackedToken(address(dust)) == 7, "dust rescue mismatch");
        VM.prank(ALICE);
        require(vault.rescueUntrackedToken(address(usdc)) == 25e6, "USDC rescue mismatch");
    }

    // Catches direct Vault Pass dust being used to reach the Locker's reserved Pass obligation.
    function test_LockedPassIsReservedAndCannotBeClassifiedAsActiveExcess() public {
        VM.prank(ALICE);
        require(pass.transfer(address(vault), 50 ether), "Pass dust transfer failed");
        require(vault.reservedTrackedBalance(address(pass)) == 100 ether, "lock not reserved");
        require(vault.untrackedExcess(address(pass)) == 0, "locked Pass treated as excess");
        VM.prank(ALICE);
        vault.close();
        require(vault.reservedTrackedBalance(address(pass)) == 0, "closed lock remained reserved");
        require(vault.untrackedExcess(address(pass)) == 50 ether, "closed Pass dust not excess");
    }

    // Direct Locker dust is not a recorded lock and needs a separate post-close exit.
    function test_PostCloseRescueReturnsDirectLockerPassAndVaultDust() public {
        VM.startPrank(ALICE);
        require(pass.transfer(vault.passLocker(), 1), "Locker dust transfer failed");
        require(pass.transfer(address(vault), 7), "Vault dust transfer failed");
        (bool active,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(pass))));
        require(!active, "active Locker rescue accepted");
        vault.close();
        VM.stopPrank();
        require(PassLocker(vault.passLocker()).lockedBalance() == 0, "close retained recorded lock");
        require(pass.balanceOf(vault.passLocker()) == 1, "close consumed untracked Locker dust");
        require(vault.untrackedExcess(address(pass)) == 8, "Locker dust missing from excess");
        VM.prank(BOB);
        (bool unauthorized,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(pass))));
        require(!unauthorized, "non-owner rescued Locker dust");
        uint256 beforeBalance = pass.balanceOf(ALICE);
        VM.prank(ALICE);
        require(vault.rescueUntrackedToken(address(pass)) == 8, "wrong combined rescue amount");
        require(pass.balanceOf(ALICE) == beforeBalance + 8, "wrong rescue recipient or raw units");
        require(pass.balanceOf(vault.passLocker()) == 0, "Locker dust remained");
        require(pass.balanceOf(address(vault)) == 0, "Vault dust remained");
        VM.prank(ALICE);
        (bool replay,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(pass))));
        require(!replay, "empty rescue replay accepted");
    }

    function testFuzz_PostCloseLockerOnlyRescueUsesExactRawUnits(uint256 candidate) public {
        uint256 dustAmount = (candidate % 1 ether) + 1;
        VM.startPrank(ALICE);
        require(pass.transfer(vault.passLocker(), dustAmount), "Locker dust transfer failed");
        vault.close();
        uint256 beforeBalance = pass.balanceOf(ALICE);
        require(vault.untrackedExcess(address(pass)) == dustAmount, "wrong Locker-only excess");
        require(vault.rescueUntrackedToken(address(pass)) == dustAmount, "wrong Locker-only rescue");
        require(pass.balanceOf(ALICE) == beforeBalance + dustAmount, "raw rescue amount changed");
        require(pass.balanceOf(vault.passLocker()) == 0, "Locker dust remained");
        require(pass.transfer(vault.passLocker(), 1), "post-close transfer failed");
        require(vault.rescueUntrackedToken(address(pass)) == 1, "later post-close dust stuck");
        VM.stopPrank();
        require(vault.principalBasis() == 0, "rescue changed principal");
        require(vault.trackedUsdcBalance() == 0, "rescue changed tracked assets");
    }

    // A failed excess transfer must not undo the already completed close or move part of the dust.
    function test_FailedLockerExcessRescuePreservesCompletedClose() public {
        ConfigurableStrategyPass feePass =
            new ConfigurableStrategyPass("Fee Pass", "FEE-PASS", STRATEGY_ID, 1_000 ether, ALICE);
        AlphaForgeVault feeVault = _deploy(ALICE, address(feePass), address(usdc));
        _approveAndDeposit(feeVault, feePass, usdc, ALICE, 10e6);
        VM.startPrank(ALICE);
        require(feePass.transfer(feeVault.passLocker(), 3), "Locker funding failed");
        require(feePass.transfer(address(feeVault), 5), "Vault funding failed");
        feeVault.close();
        VM.stopPrank();
        uint256 beforeBalance = feePass.balanceOf(ALICE);
        feePass.setTransferFee(1);
        VM.prank(ALICE);
        (bool success,) = address(feeVault)
            .call(abi.encodeCall(feeVault.rescueUntrackedToken, (address(feePass))));
        require(!success, "short Locker rescue accepted");
        require(feeVault.closed(), "failed rescue reopened Vault");
        require(feeVault.principalBasis() == 0, "failed rescue restored principal");
        require(
            PassLocker(feeVault.passLocker()).lockedBalance() == 0, "failed rescue restored lock"
        );
        require(feePass.balanceOf(ALICE) == beforeBalance, "failed rescue moved owner funds");
        require(feePass.balanceOf(feeVault.passLocker()) == 3, "failed rescue moved Locker dust");
        require(feePass.balanceOf(address(feeVault)) == 5, "failed rescue moved Vault dust");
        feePass.setTransferFee(0);
        VM.prank(ALICE);
        require(feeVault.rescueUntrackedToken(address(feePass)) == 8, "healthy retry failed");
    }

    // Catches a zero-value rescue emitting success or changing closed accounting.
    function test_ZeroExcessRescueRevertsWithoutAccountingMutation() public {
        VM.prank(ALICE);
        vault.close();
        VM.prank(ALICE);
        (bool success,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(dust))));
        require(!success, "zero excess rescue accepted");
        require(vault.principalBasis() == 0, "rescue changed principal");
        require(vault.trackedUsdcBalance() == 0, "rescue changed tracked USDC");
    }

    // Catches a malicious unknown token retroactively invalidating a completed close.
    function test_FailedTokenRescueDoesNotUndoEarlierClose() public {
        require(dust.transfer(address(vault), 1 ether), "dust transfer failed");
        VM.prank(ALICE);
        vault.close();
        dust.configure(true, false, false, 0);
        VM.prank(ALICE);
        (bool success,) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(dust))));
        require(!success, "malicious rescue succeeded");
        require(vault.closed(), "failed rescue reopened Vault");
        require(vault.principalBasis() == 0, "failed rescue restored principal");
    }

    // Catches unknown balanceOf behavior entering the close path.
    function test_RevertingUnknownBalanceReadDoesNotBlockClose() public {
        require(dust.transfer(address(vault), 1 ether), "dust transfer failed");
        dust.configure(false, false, true, 0);
        VM.prank(ALICE);
        vault.close();
        require(vault.closed(), "unknown balanceOf blocked close");
    }

    // Catches close marking success when required AF-USDC settlement fails.
    function test_UsdcSettlementFailureRevertsEntireClose() public {
        ConfigurableAsset badUsdc = new ConfigurableAsset("Bad USDC", "BAD-USDC", 6, 1_000e6, ALICE);
        AlphaForgeVault badVault = _deploy(ALICE, address(pass), address(badUsdc));
        _approveAndDeposit(badVault, pass, badUsdc, ALICE, 10e6);
        badUsdc.configure(true, false, false, 0);
        VM.prank(ALICE);
        (bool success,) = address(badVault).call(abi.encodeCall(badVault.close, ()));
        require(!success, "failed USDC settlement reported close success");
        require(!badVault.closed(), "failed close set closed state");
        require(badVault.principalBasis() == 10e6, "failed close cleared principal");
        require(badVault.trackedUsdcBalance() == 10e6, "failed close cleared tracked USDC");
    }

    // Catches close clearing state when required locked Pass return fails.
    function test_PassReturnFailureRevertsEntireClose() public {
        ConfigurableStrategyPass badPass =
            new ConfigurableStrategyPass("Bad Pass", "BAD-PASS", STRATEGY_ID, 1_000 ether, ALICE);
        AlphaForgeVault badVault = _deploy(ALICE, address(badPass), address(usdc));
        _approveAndDeposit(badVault, badPass, usdc, ALICE, 10e6);
        badPass.configure(true, false, false, 0);
        VM.prank(ALICE);
        (bool success,) = address(badVault).call(abi.encodeCall(badVault.close, ()));
        require(!success, "failed Pass return reported close success");
        require(!badVault.closed(), "failed close set closed state");
        require(PassLocker(badVault.passLocker()).lockedBalance() == 10 ether, "lock cleared");
    }

    // Catches a fee/no-op Pass transfer reporting success while the owner receives too little.
    function test_PassReturnAmountMismatchRevertsEntireClose() public {
        ConfigurableStrategyPass feePass =
            new ConfigurableStrategyPass("Fee Pass", "FEE-PASS", STRATEGY_ID, 1_000 ether, ALICE);
        AlphaForgeVault feeVault = _deploy(ALICE, address(feePass), address(usdc));
        VM.startPrank(ALICE);
        feePass.approve(address(feeVault), type(uint256).max);
        usdc.approve(address(feeVault), type(uint256).max);
        feeVault.deposit(10e6);
        VM.stopPrank();
        feePass.setTransferFee(1);
        VM.prank(ALICE);
        (bool success,) = address(feeVault).call(abi.encodeCall(feeVault.close, ()));
        require(!success, "short Pass return reported close success");
        require(!feeVault.closed(), "short Pass return closed Vault");
        require(feeVault.principalBasis() == 10e6, "short Pass return cleared principal");
        require(
            PassLocker(feeVault.passLocker()).lockedBalance() == 10 ether,
            "short Pass return cleared lock"
        );
    }

    // Catches fee-on-transfer deposits creating unfunded principal or capacity.
    function test_DepositRejectsTransferAmountMismatchAtomically() public {
        ConfigurableAsset feeUsdc = new ConfigurableAsset("Fee USDC", "FEE-USDC", 6, 1_000e6, ALICE);
        AlphaForgeVault feeVault = _deploy(ALICE, address(pass), address(feeUsdc));
        VM.startPrank(ALICE);
        feeUsdc.approve(address(feeVault), type(uint256).max);
        pass.approve(address(feeVault), type(uint256).max);
        VM.stopPrank();
        feeUsdc.configure(false, false, false, 1);
        VM.prank(ALICE);
        (bool success,) = address(feeVault).call(abi.encodeCall(feeVault.deposit, (1e6)));
        require(!success, "fee deposit accepted");
        require(feeVault.principalBasis() == 0, "failed deposit changed principal");
        require(feeUsdc.balanceOf(address(feeVault)) == 0, "failed deposit retained USDC");
        require(
            PassLocker(feeVault.passLocker()).lockedBalance() == 0, "failed deposit locked Pass"
        );
    }

    // Catches a short Pass transfer rolling back the AF-USDC transfer that happened first.
    function test_PassDepositAmountMismatchRollsBackEntireDeposit() public {
        ConfigurableStrategyPass feePass =
            new ConfigurableStrategyPass("Fee Pass", "FEE-PASS", STRATEGY_ID, 1_000 ether, ALICE);
        AlphaForgeVault feeVault = _deploy(ALICE, address(feePass), address(usdc));
        VM.startPrank(ALICE);
        feePass.approve(address(feeVault), type(uint256).max);
        usdc.approve(address(feeVault), type(uint256).max);
        VM.stopPrank();
        feePass.configure(false, false, false, 1);

        uint256 ownerUsdcBefore = usdc.balanceOf(ALICE);
        uint256 ownerPassBefore = feePass.balanceOf(ALICE);
        VM.prank(ALICE);
        (bool success,) = address(feeVault).call(abi.encodeCall(feeVault.deposit, (10e6)));

        require(!success, "short Pass deposit accepted");
        require(feeVault.principalBasis() == 0, "failed deposit changed principal");
        require(feeVault.trackedUsdcBalance() == 0, "failed deposit changed tracked USDC");
        require(usdc.balanceOf(ALICE) == ownerUsdcBefore, "failed deposit retained owner USDC");
        require(usdc.balanceOf(address(feeVault)) == 0, "failed deposit retained Vault USDC");
        require(feePass.balanceOf(ALICE) == ownerPassBefore, "failed deposit retained owner Pass");
        require(
            PassLocker(feeVault.passLocker()).lockedBalance() == 0,
            "failed deposit created Pass lock"
        );
    }

    // Catches an outgoing fee token committing accounting or Pass unlock before settlement fails.
    function test_WithdrawAmountMismatchRollsBackAccountingAndPassUnlock() public {
        ConfigurableAsset feeUsdc = new ConfigurableAsset("Fee USDC", "FEE-USDC", 6, 1_000e6, ALICE);
        AlphaForgeVault feeVault = _deploy(ALICE, address(pass), address(feeUsdc));
        _approveAndDeposit(feeVault, pass, feeUsdc, ALICE, 10e6);
        feeUsdc.setTransferFee(1);

        uint256 ownerUsdcBefore = feeUsdc.balanceOf(ALICE);
        VM.prank(ALICE);
        (bool success,) = address(feeVault).call(abi.encodeCall(feeVault.withdraw, (1e6)));

        require(!success, "short withdrawal accepted");
        require(feeVault.principalBasis() == 10e6, "failed withdrawal changed principal");
        require(feeVault.trackedUsdcBalance() == 10e6, "failed withdrawal changed balance");
        require(feeUsdc.balanceOf(ALICE) == ownerUsdcBefore, "failed withdrawal paid owner");
        require(feeUsdc.balanceOf(address(feeVault)) == 10e6, "failed withdrawal lost Vault USDC");
        require(
            PassLocker(feeVault.passLocker()).lockedBalance() == 10 ether,
            "failed withdrawal unlocked Pass"
        );
    }

    // Catches a Pass return failure preserving the earlier AF-USDC transfer in the same withdrawal.
    function test_PassUnlockFailureRollsBackUsdcWithdrawalAndAccounting() public {
        ConfigurableStrategyPass badPass =
            new ConfigurableStrategyPass("Bad Pass", "BAD-PASS", STRATEGY_ID, 1_000 ether, ALICE);
        AlphaForgeVault badVault = _deploy(ALICE, address(badPass), address(usdc));
        _approveAndDeposit(badVault, badPass, usdc, ALICE, 10e6);
        badPass.configure(true, false, false, 0);

        uint256 ownerUsdcBefore = usdc.balanceOf(ALICE);
        VM.prank(ALICE);
        (bool success,) = address(badVault).call(abi.encodeCall(badVault.withdraw, (1e6)));

        require(!success, "failed Pass unlock accepted");
        require(badVault.principalBasis() == 10e6, "failed withdrawal changed principal");
        require(badVault.trackedUsdcBalance() == 10e6, "failed withdrawal changed balance");
        require(usdc.balanceOf(ALICE) == ownerUsdcBefore, "failed withdrawal paid owner");
        require(usdc.balanceOf(address(badVault)) == 10e6, "failed withdrawal lost Vault USDC");
        require(
            PassLocker(badVault.passLocker()).lockedBalance() == 10 ether,
            "failed withdrawal changed Pass lock"
        );
    }

    // Catches an owner callback re-entering withdraw or close during AF-USDC settlement.
    function test_WithdrawAndCloseRejectReentrancy() public {
        ReentrantAsset callbackUsdc =
            new ReentrantAsset("Callback USDC", "CB-USDC", 6, 1_000e6, ALICE);
        AlphaForgeVault reentrantVault = _deploy(ALICE, address(pass), address(callbackUsdc));
        _approveAndDeposit(reentrantVault, pass, callbackUsdc, ALICE, 10e6);
        callbackVault = reentrantVault;

        callbackUsdc.configureCallback(address(this), abi.encodeCall(this.reenterWithdraw, ()));
        VM.prank(ALICE);
        reentrantVault.withdraw(1e6);
        require(callbackUsdc.callbackAttempted(), "withdraw callback not attempted");
        require(!callbackUsdc.callbackSucceeded(), "withdraw reentrancy succeeded");

        callbackUsdc.configureCallback(address(this), abi.encodeCall(this.reenterClose, ()));
        VM.prank(ALICE);
        reentrantVault.close();
        require(callbackUsdc.callbackAttempted(), "close callback not attempted");
        require(!callbackUsdc.callbackSucceeded(), "close reentrancy succeeded");
    }

    // Catches token rescue re-entry under the correct immutable owner identity.
    function test_TokenRescueRejectsReentrancy() public {
        ReentrantAsset callbackDust =
            new ReentrantAsset("Callback Dust", "CB-DUST", 18, 1 ether, address(this));
        require(callbackDust.transfer(address(vault), 1 ether), "callback dust transfer failed");
        VM.prank(ALICE);
        vault.close();
        callbackVault = vault;
        callbackDust.configureCallback(
            address(this), abi.encodeCall(this.reenterTokenRescue, (address(callbackDust)))
        );
        VM.prank(ALICE);
        vault.rescueUntrackedToken(address(callbackDust));
        require(callbackDust.callbackAttempted(), "rescue callback not attempted");
        require(!callbackDust.callbackSucceeded(), "token rescue reentrancy succeeded");
    }

    // Catches native rescue re-entry by a contract that is itself the immutable owner.
    function test_NativeRescueRejectsOwnerReentrancy() public {
        callbackVault = _deploy(address(this), address(pass), address(usdc));
        callbackVault.close();
        VM.deal(address(callbackVault), 1 ether);
        nativeCallbackEnabled = true;
        uint256 rescued = callbackVault.rescueNative();
        nativeCallbackEnabled = false;
        require(rescued == 1 ether, "native rescue amount mismatch");
        require(nativeCallbackAttempted, "native callback not attempted");
        require(!nativeCallbackSucceeded, "native rescue reentrancy succeeded");
    }

    function reenterWithdraw() external {
        VM.prank(ALICE);
        callbackVault.withdraw(1);
    }

    function reenterClose() external {
        VM.prank(ALICE);
        callbackVault.close();
    }

    function reenterTokenRescue(address token) external {
        VM.prank(ALICE);
        callbackVault.rescueUntrackedToken(token);
    }

    function _deploy(address owner_, address pass_, address usdc_)
        private
        returns (AlphaForgeVault)
    {
        return new AlphaForgeVault(
            owner_, CREATOR, STRATEGY_ID, STRATEGY_REF, pass_, usdc_, address(eth), address(btc)
        );
    }

    function _approveAndDeposit(
        AlphaForgeVault target,
        StrategyPass passToken,
        AlphaForgeTestUSDC usdcToken,
        address owner_,
        uint256 amount
    ) private {
        VM.startPrank(owner_);
        passToken.approve(address(target), type(uint256).max);
        usdcToken.approve(address(target), type(uint256).max);
        target.deposit(amount);
        VM.stopPrank();
    }

    function _approveAndDeposit(
        AlphaForgeVault target,
        ConfigurableStrategyPass passToken,
        AlphaForgeTestUSDC usdcToken,
        address owner_,
        uint256 amount
    ) private {
        VM.startPrank(owner_);
        passToken.approve(address(target), type(uint256).max);
        usdcToken.approve(address(target), type(uint256).max);
        target.deposit(amount);
        VM.stopPrank();
    }

    function _approveAndDeposit(
        AlphaForgeVault target,
        StrategyPass passToken,
        ConfigurableAsset usdcToken,
        address owner_,
        uint256 amount
    ) private {
        VM.startPrank(owner_);
        passToken.approve(address(target), type(uint256).max);
        usdcToken.approve(address(target), type(uint256).max);
        target.deposit(amount);
        VM.stopPrank();
    }

    function _approveAndDeposit(
        AlphaForgeVault target,
        StrategyPass passToken,
        ReentrantAsset usdcToken,
        address owner_,
        uint256 amount
    ) private {
        VM.startPrank(owner_);
        passToken.approve(address(target), type(uint256).max);
        usdcToken.approve(address(target), type(uint256).max);
        target.deposit(amount);
        VM.stopPrank();
    }
}
