// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { AlphaForgeVault } from "../src/AlphaForgeVault.sol";
import { IAlphaForgeVault } from "../src/interfaces/IAlphaForgeVault.sol";
import { PassLocker } from "../src/PassLocker.sol";
import { StrategyPass } from "../src/StrategyPass.sol";
import { AlphaForgeVaultHarness } from "./harness/AlphaForgeVaultHarness.sol";
import { ConfigurableAsset, ConfigurableStrategyPass } from "./mocks/ConfigurableAsset.sol";
import { VaultCustodyFactory } from "./AlphaForgeVault.custody.t.sol";
import { StrategyPassHolder } from "./StrategyPass.invariant.t.sol";

interface ReachableVm {
    function prank(address sender) external;
}

contract AlphaForgeHarnessReachableTest {
    ReachableVm private constant VM =
        ReachableVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OTHER = address(0xB0B);
    bytes32 private constant STRATEGY = keccak256("reachable-guards");
    ConfigurableAsset private usdc;
    ConfigurableAsset private eth;
    ConfigurableAsset private btc;
    StrategyPass private pass;
    AlphaForgeVaultHarness private vault;

    function setUp() public {
        usdc = new ConfigurableAsset("USDC", "USDC", 6, 1_000e6, address(this));
        eth = new ConfigurableAsset("ETH", "ETH", 18, 1_000 ether, address(this));
        btc = new ConfigurableAsset("BTC", "BTC", 18, 1_000 ether, address(this));
        pass = new StrategyPass("Reachable", "REACH", STRATEGY, 1_000 ether, address(this));
        vault = new AlphaForgeVaultHarness(
            address(this),
            OTHER,
            STRATEGY,
            keccak256("ref"),
            address(pass),
            address(usdc),
            address(eth),
            address(btc)
        );
        usdc.approve(address(vault), 100e6);
        pass.approve(address(vault), 100 ether);
        eth.approve(address(vault), 100 ether);
        btc.approve(address(vault), 100 ether);
    }

    // These gates protect the validity of accounting tests; they are not production entry points.
    function test_NonControllerCannotMutateAnyHarnessAccountingSurface() public {
        bytes[6] memory calls = [
            abi.encodeCall(vault.recordRealizedProfit, (1)),
            abi.encodeCall(vault.recordRealizedLoss, (1)),
            abi.encodeCall(vault.seedAccountingForTest, (1, 1)),
            abi.encodeCall(vault.setTrackedPositionForTest, (address(eth), 1)),
            abi.encodeCall(vault.openPosition, (address(eth), 1)),
            abi.encodeCall(vault.settlePosition, (address(eth), 1))
        ];
        for (uint256 i; i < calls.length; i++) {
            VM.prank(OTHER);
            _reject(
                calls[i],
                abi.encodeWithSelector(AlphaForgeVaultHarness.HarnessUnauthorized.selector)
            );
        }
        _emptyAccounting();
        require(vault.harnessController() == address(this), "controller changed");
        require(vault.owner() == address(this) && vault.strategyCreator() == OTHER, "roles changed");
    }

    function test_TerminalCloseBlocksAllHarnessSettlementTransitions() public {
        vault.close();
        _reject(
            abi.encodeCall(vault.recordRealizedProfit, (1)),
            abi.encodeWithSelector(IAlphaForgeVault.VaultClosed.selector)
        );
        _reject(
            abi.encodeCall(vault.recordRealizedLoss, (1)),
            abi.encodeWithSelector(IAlphaForgeVault.VaultClosed.selector)
        );
        _reject(
            abi.encodeCall(vault.openPosition, (address(eth), 1)),
            abi.encodeWithSelector(IAlphaForgeVault.VaultClosed.selector)
        );
        _reject(
            abi.encodeCall(vault.settlePosition, (address(eth), 1)),
            abi.encodeWithSelector(IAlphaForgeVault.VaultClosed.selector)
        );
        require(vault.closed(), "terminal state reverted");
        _emptyAccounting();
        _unspentInventory();
    }

    function test_ZeroSettlementDoesNotChangeAccountingOrConsumeApproval() public {
        bytes memory expected = abi.encodeWithSelector(IAlphaForgeVault.ZeroAmount.selector);
        _reject(abi.encodeCall(vault.recordRealizedProfit, (0)), expected);
        _reject(abi.encodeCall(vault.recordRealizedLoss, (0)), expected);
        _reject(abi.encodeCall(vault.openPosition, (address(eth), 0)), expected);
        _reject(abi.encodeCall(vault.settlePosition, (address(btc), 0)), expected);
        _emptyAccounting();
        _unspentInventory();
    }

    function test_ProfitOverflowIsRejectedBeforeAnyTransfer() public {
        vault.seedAccountingForTest(0, type(uint256).max);
        _reject(
            abi.encodeCall(vault.recordRealizedProfit, (1)),
            abi.encodeWithSelector(IAlphaForgeVault.AmountOverflow.selector, 1)
        );
        require(vault.trackedUsdcBalance() == type(uint256).max, "overflow changed accounting");
        require(vault.principalBasis() == 0, "overflow created principal");
        _unspentInventory();
    }

    function test_UnderfundedProfitRollsBackAllowanceAndBurnedSupply() public {
        usdc.configure(false, false, false, 1);
        _reject(
            abi.encodeCall(vault.recordRealizedProfit, (10e6)),
            abi.encodeWithSelector(
                IAlphaForgeVault.TrackedBalanceDeficit.selector, address(usdc), 10e6 - 1, 10e6
            )
        );
        _emptyAccounting();
        _unspentInventory();
        require(usdc.totalSupply() == 1_000e6, "failed profit left burned supply");
        usdc.configure(false, false, false, 0);
        vault.recordRealizedProfit(10e6);
        require(
            vault.trackedUsdcBalance() == 10e6 && vault.realizedProfit() == 10e6,
            "valid profit retry failed"
        );
    }

    function test_ExcessLossCannotReducePrincipalOrReleasePass() public {
        vault.deposit(10e6);
        _reject(
            abi.encodeCall(vault.recordRealizedLoss, (10e6 + 1)),
            abi.encodeWithSelector(
                IAlphaForgeVault.InsufficientTrackedUsdc.selector, 10e6, 10e6 + 1
            )
        );
        require(
            vault.trackedUsdcBalance() == 10e6 && vault.principalBasis() == 10e6,
            "failed loss changed accounting"
        );
        require(
            PassLocker(vault.passLocker()).lockedBalance() == 10 ether, "failed loss unlocked Pass"
        );
        require(usdc.balanceOf(address(vault)) == 10e6, "failed loss moved settlement balance");
        vault.recordRealizedLoss(10e6);
        require(
            vault.trackedUsdcBalance() == 0 && vault.principalBasis() == 10e6,
            "full loss erased principal"
        );
        require(
            PassLocker(vault.passLocker()).lockedBalance() == 10 ether,
            "loss automatically released capacity"
        );
    }

    function test_UnsupportedAndOversizePositionSettlementPreserveFundedPosition() public {
        vault.openPosition(address(eth), 10 ether);
        _reject(
            abi.encodeCall(vault.settlePosition, (address(usdc), 1)),
            abi.encodeWithSelector(IAlphaForgeVault.UnsupportedTrackedAsset.selector, address(usdc))
        );
        _reject(
            abi.encodeCall(vault.settlePosition, (address(eth), 10 ether + 1)),
            abi.encodeWithSelector(
                IAlphaForgeVault.TrackedBalanceDeficit.selector,
                address(eth),
                10 ether,
                10 ether + 1
            )
        );
        require(
            vault.trackedPosition(address(eth)) == 10 ether
                && vault.openTrackedPositionCount() == 1,
            "rejected settlement changed position"
        );
        require(
            eth.balanceOf(address(vault)) == 10 ether && eth.balanceOf(address(this)) == 990 ether,
            "rejected settlement moved tokens"
        );
        vault.settlePosition(address(eth), 10 ether);
        require(
            vault.trackedPosition(address(eth)) == 0 && vault.openTrackedPositionCount() == 0,
            "valid close did not clear position"
        );
        require(
            eth.balanceOf(address(this)) == 1_000 ether, "valid settlement did not return funds"
        );
    }

    function test_BalanceReadFailureRestoresDepositAccountingAndAllowsRetry() public {
        usdc.configure(false, false, true, 0);
        _reject(
            abi.encodeCall(vault.deposit, (10e6)),
            abi.encodeWithSelector(ConfigurableAsset.ConfiguredFailure.selector)
        );
        usdc.configure(false, false, false, 0);
        _emptyAccounting();
        _unspentInventory();
        vault.deposit(10e6);
        require(
            vault.principalBasis() == 10e6
                && PassLocker(vault.passLocker()).lockedBalance() == 10 ether,
            "retry lost capacity binding"
        );
    }

    function test_TransferFromFailureRestoresDepositAccountingAndAllowsRetry() public {
        usdc.configure(false, true, false, 0);
        _reject(
            abi.encodeCall(vault.deposit, (10e6)),
            abi.encodeWithSelector(ConfigurableAsset.ConfiguredFailure.selector)
        );
        _emptyAccounting();
        _unspentInventory();
        usdc.configure(false, false, false, 0);
        vault.deposit(10e6);
        require(
            vault.principalBasis() == 10e6 && usdc.balanceOf(address(vault)) == 10e6,
            "retry failed after token rejection"
        );
    }

    function test_PassTransferFromFailureRestoresEarlierUsdcLegAndBothApprovals() public {
        ConfigurableStrategyPass failingPass =
            new ConfigurableStrategyPass("External pass", "EXT", STRATEGY, 10 ether, address(this));
        AlphaForgeVault target = new AlphaForgeVault(
            address(this),
            OTHER,
            STRATEGY,
            keccak256("ref"),
            address(failingPass),
            address(usdc),
            address(eth),
            address(btc)
        );
        failingPass.approve(address(target), 10 ether);
        usdc.approve(address(target), 10e6);
        failingPass.configure(false, true, false, 0);
        (bool ok, bytes memory reason) =
            address(target).call(abi.encodeCall(target.deposit, (10e6)));
        require(
            !ok
                && keccak256(reason)
                    == keccak256(
                        abi.encodeWithSelector(ConfigurableAsset.ConfiguredFailure.selector)
                    ),
            "wrong late failure"
        );
        require(
            target.principalBasis() == 0 && target.trackedUsdcBalance() == 0,
            "late failure retained principal"
        );
        require(
            usdc.balanceOf(address(this)) == 1_000e6 && usdc.balanceOf(address(target)) == 0,
            "earlier USDC transfer survived"
        );
        require(
            usdc.allowance(address(this), address(target)) == 10e6
                && failingPass.allowance(address(this), address(target)) == 10 ether,
            "late failure consumed approvals"
        );
        require(
            failingPass.balanceOf(target.passLocker()) == 0
                && PassLocker(target.passLocker()).lockedBalance() == 0,
            "late failure locked capacity"
        );
        failingPass.configure(false, false, false, 0);
        target.deposit(10e6);
        require(
            target.principalBasis() == 10e6
                && PassLocker(target.passLocker()).lockedBalance() == 10 ether,
            "valid late-failure retry blocked"
        );
    }

    function test_FactoryAdministrationDoesNotPermitUnapprovedCreation() public {
        VaultCustodyFactory factory = new VaultCustodyFactory(OTHER);
        StrategyPass factoryPass = new StrategyPass(
            "Factory fixture", "FACTORY", keccak256("trend"), 1 ether, address(this)
        );
        address[4] memory tokens = [address(factoryPass), address(usdc), address(eth), address(btc)];
        (bool ok, bytes memory reason) =
            address(factory).call(abi.encodeCall(factory.create, (address(this), OTHER, tokens)));
        require(
            !ok
                && keccak256(reason)
                    == keccak256(
                        abi.encodeWithSignature("Error(string)", "factory owner required")
                    ),
            "unauthorized factory call accepted"
        );
        VM.prank(OTHER);
        AlphaForgeVault created = factory.create(address(this), OTHER, tokens);
        require(
            created.owner() == address(this) && created.strategyCreator() == OTHER,
            "factory collapsed custody roles"
        );
        VM.prank(OTHER);
        (ok, reason) = address(created).call(abi.encodeCall(created.close, ()));
        require(
            !ok
                && keccak256(reason)
                    == keccak256(
                        abi.encodeWithSelector(IAlphaForgeVault.Unauthorized.selector, OTHER)
                    ),
            "factory admin acquired custody"
        );
    }

    function test_HolderRejectsOutsiderAndPreservesFractionalHandlerTransfer() public {
        StrategyPassHolder holder = new StrategyPassHolder(address(this));
        pass.transfer(address(holder), 3);
        VM.prank(OTHER);
        (bool ok, bytes memory reason) =
            address(holder).call(abi.encodeCall(holder.move, (pass, OTHER, 1)));
        require(
            !ok
                && keccak256(reason)
                    == keccak256(abi.encodeWithSignature("Error(string)", "only handler")),
            "outsider moved holder tokens"
        );
        require(
            pass.balanceOf(address(holder)) == 3 && pass.balanceOf(OTHER) == 0,
            "failed move changed balances"
        );
        holder.move(pass, OTHER, 1);
        require(
            pass.balanceOf(address(holder)) == 2 && pass.balanceOf(OTHER) == 1,
            "handler transfer rounded base units"
        );
        require(pass.totalSupply() == 1_000 ether, "holder move changed fixed supply");
    }

    function _reject(bytes memory data, bytes memory expected) private {
        (bool ok, bytes memory reason) = address(vault).call(data);
        require(!ok && keccak256(reason) == keccak256(expected), "wrong guard rejected call");
    }

    function _emptyAccounting() private view {
        require(
            vault.principalBasis() == 0 && vault.trackedUsdcBalance() == 0,
            "unexpected settlement accounting"
        );
        require(
            vault.openTrackedPositionCount() == 0 && vault.trackedPosition(address(eth)) == 0
                && vault.trackedPosition(address(btc)) == 0,
            "unexpected tracked positions"
        );
        require(PassLocker(vault.passLocker()).lockedBalance() == 0, "unexpected Pass obligation");
    }

    function _unspentInventory() private view {
        require(
            usdc.balanceOf(address(this)) == 1_000e6 && usdc.balanceOf(address(vault)) == 0,
            "USDC moved on rejection"
        );
        require(
            pass.balanceOf(address(this)) == 1_000 ether && pass.balanceOf(vault.passLocker()) == 0,
            "Pass moved on rejection"
        );
        require(
            usdc.allowance(address(this), address(vault)) == 100e6
                && pass.allowance(address(this), address(vault)) == 100 ether,
            "approval consumed on rejection"
        );
    }
}
