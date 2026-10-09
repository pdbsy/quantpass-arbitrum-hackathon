// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    AlphaForgeStrategyVault,
    AlphaForgeStrategyVaultFactory,
    AlphaForgeStrategyTestStock,
    AlphaForgeStockReserve,
    AlphaForgeStrategyReferenceFeed
} from "../../src/launch-vault/AlphaForgeStrategyVault.sol";
import { AlphaForgeTestUSDC } from "../../src/AlphaForgeTestAsset.sol";
import { StrategyPass } from "../../src/StrategyPass.sol";
import { PassLocker } from "../../src/PassLocker.sol";

interface StrategyVaultVm {
    function chainId(uint256 id) external;
    function warp(uint256 time) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
}

contract StrategyVaultTest {
    StrategyVaultVm private constant vm =
        StrategyVaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant EXECUTOR = address(0xE001);
    AlphaForgeTestUSDC private usdc;
    AlphaForgeStrategyTestStock private tsla;
    AlphaForgeStrategyTestStock private amzn;
    AlphaForgeStrategyReferenceFeed private feed;
    StrategyPass private pass;
    AlphaForgeStrategyVaultFactory private factory;
    AlphaForgeStockReserve private venue;
    AlphaForgeStrategyVault private vault;

    function setUp() public {
        vm.chainId(46630);
        vm.warp(1000);
        usdc = new AlphaForgeTestUSDC(1_000_000e6, address(this));
        tsla = new AlphaForgeStrategyTestStock(true, 1_000_000 ether, address(this));
        amzn = new AlphaForgeStrategyTestStock(false, 1_000_000 ether, address(this));
        feed = new AlphaForgeStrategyReferenceFeed(address(this), keccak256("test-tsla"));
        feed.update(100e6, 1000, keccak256("isolated-test-reference"));
        feed.updateSession(1000, 2000, 1000, keccak256("isolated-test-calendar"));
        venue = new AlphaForgeStockReserve(
            address(this), address(usdc), address(tsla), address(feed), 30
        );
        usdc.approve(address(venue), 100_000e6);
        tsla.approve(address(venue), 1000 ether);
        venue.fund(address(usdc), 100_000e6);
        venue.fund(address(tsla), 1000 ether);
        pass = new StrategyPass(
            "All in TSLA PASS",
            "AF-PASS-TSLA",
            keccak256("all-in-tsla"),
            1_000_000 ether,
            address(this)
        );
        StrategyPass secondPass = new StrategyPass(
            "All in AMZN PASS",
            "AF-PASS-AMZN",
            keccak256("all-in-amzn"),
            1_000_000 ether,
            address(this)
        );
        AlphaForgeStrategyReferenceFeed secondFeed =
            new AlphaForgeStrategyReferenceFeed(address(this), keccak256("test-amzn"));
        secondFeed.update(100e6, 1000, keccak256("isolated-test-reference"));
        secondFeed.updateSession(1000, 2000, 1000, keccak256("isolated-test-calendar"));
        AlphaForgeStockReserve secondVenue = new AlphaForgeStockReserve(
            address(this), address(usdc), address(amzn), address(secondFeed), 30
        );
        AlphaForgeStrategyVaultFactory.Strategy[2] memory configs;
        configs[0] = AlphaForgeStrategyVaultFactory.Strategy(
            address(this),
            address(pass),
            address(usdc),
            address(tsla),
            address(amzn),
            address(venue),
            address(feed),
            keccak256("all-in-tsla-v1"),
            30
        );
        configs[1] = AlphaForgeStrategyVaultFactory.Strategy(
            address(this),
            address(secondPass),
            address(usdc),
            address(amzn),
            address(tsla),
            address(secondVenue),
            address(secondFeed),
            keccak256("all-in-amzn-v1"),
            30
        );
        factory = new AlphaForgeStrategyVaultFactory(configs);
        vm.prank(ALICE);
        vault = AlphaForgeStrategyVault(payable(factory.createVault(0)));
        usdc.transfer(ALICE, 1000e6);
        pass.transfer(ALICE, 1000 ether);
        vm.startPrank(ALICE);
        usdc.approve(address(vault), 1000e6);
        pass.approve(address(vault), 1000 ether);
        vault.deposit(1000e6);
        vm.stopPrank();
    }

    function buy() private {
        uint256 version = vault.executionVersion();
        vm.prank(ALICE);
        vault.execute(true, 100e6, 1 ether, 1030, version);
    }

    function sell() private {
        uint256 version = vault.executionVersion();
        uint256 price = venue.price();
        vm.prank(ALICE);
        vault.execute(false, 1 ether, price, 1030, version);
    }

    function test_FactoryOwnerIsolationAndCodeSize() public {
        require(
            address(factory).code.length <= 24576 && address(vault).code.length <= 24576,
            "runtime size"
        );
        require(vault.owner() == ALICE && factory.vaults(ALICE, 0) == address(vault), "owner");
        vm.prank(BOB);
        address bobVault = factory.createVault(0);
        require(AlphaForgeStrategyVault(payable(bobVault)).owner() == BOB, "isolated owner");
        vm.prank(BOB);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.withdraw, (1e6)));
        require(!ok, "cross owner withdrawal");
        vm.prank(ALICE);
        (ok,) = address(factory).call(abi.encodeCall(factory.createVault, (0)));
        require(!ok, "duplicate active vault");
    }

    function test_ProfitFirstAndPrincipalReleaseUseExistingAccounting() public {
        buy();
        vm.warp(1001);
        feed.update(120e6, 1001, keccak256("isolated-profit"));
        require(vault.equity() == 1020e6 && vault.unrealizedPnl() == 20e6, "stock equity");
        vm.prank(ALICE);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.withdraw, (1e6)));
        require(!ok, "principal withdrawal with tracked stock");
        sell();
        require(vault.realizedTradingPnl() == 20e6, "realized pnl");
        vm.startPrank(ALICE);
        vault.withdraw(20e6);
        require(
            vault.principalBasis() == 1000e6
                && PassLocker(vault.passLocker()).lockedBalance() == 1000 ether,
            "profit release"
        );
        vault.withdraw(100e6);
        require(
            vault.principalBasis() == 900e6 && pass.balanceOf(ALICE) == 100 ether,
            "principal release"
        );
        vault.close();
        vm.stopPrank();
        require(
            pass.balanceOf(ALICE) == 1000 ether && usdc.balanceOf(ALICE) == 1020e6, "close return"
        );
    }

    function test_LossDoesNotUnlockPassAndCloseReleasesRemainder() public {
        buy();
        vm.warp(1001);
        feed.update(80e6, 1001, keccak256("isolated-loss"));
        require(vault.equity() == 980e6 && vault.unrealizedPnl() == -20e6, "loss equity");
        require(PassLocker(vault.passLocker()).lockedBalance() == 1000 ether, "loss auto unlock");
        sell();
        require(vault.realizedTradingPnl() == -20e6, "realized loss");
        vm.prank(ALICE);
        vault.close();
        require(pass.balanceOf(ALICE) == 1000 ether && usdc.balanceOf(ALICE) == 980e6, "loss close");
    }

    function test_TrackedPositionBlocksCloseButUnknownDustDoesNot() public {
        buy();
        vm.prank(ALICE);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.close, ()));
        require(!ok, "open stock close");
        sell();
        amzn.transfer(address(vault), 1 ether);
        tsla.transfer(address(vault), 1);
        vm.prank(ALICE);
        vault.close();
        require(vault.closed() && pass.balanceOf(ALICE) == 1000 ether, "dust close");
        vm.prank(ALICE);
        vault.rescueUntrackedToken(address(amzn));
        require(amzn.balanceOf(ALICE) == 1 ether, "owner dust rescue");
    }

    function test_ExecutorLimitsExpiryAndRevoke() public {
        vm.prank(EXECUTOR);
        (bool ok,) =
            address(vault).call(abi.encodeCall(vault.execute, (true, 100e6, 1 ether, 1030, 0)));
        require(!ok, "unauthorized executor");
        vm.prank(ALICE);
        vault.configureExecutor(
            AlphaForgeStrategyVault.ExecutorGrant(EXECUTOR, 1030, 100e6, 100e6, 100)
        );
        vm.prank(EXECUTOR);
        vault.execute(true, 100e6, 1 ether, 1030, 1);
        vm.prank(EXECUTOR);
        (ok,) = address(vault).call(abi.encodeCall(vault.execute, (true, 100e6, 1 ether, 1030, 2)));
        require(!ok, "cumulative buy cap");
        vm.prank(ALICE);
        vault.revokeExecutor();
        vm.prank(EXECUTOR);
        (ok,) = address(vault).call(abi.encodeCall(vault.execute, (false, 1 ether, 100e6, 1030, 3)));
        require(!ok, "revoke ignored");
        sell();
    }

    function test_StalePriceAndInsolventVenueRollback() public {
        vm.warp(1031);
        vm.prank(ALICE);
        (bool ok,) =
            address(vault).call(abi.encodeCall(vault.execute, (true, 100e6, 1 ether, 1040, 0)));
        require(!ok && vault.trackedUsdcBalance() == 1000e6, "stale accepted");
        feed.update(100e6, 1031, keccak256("fresh-test-price"));
        venue.withdrawReserve(address(tsla), tsla.balanceOf(address(venue)));
        vm.prank(ALICE);
        (ok,) = address(vault).call(abi.encodeCall(vault.execute, (true, 100e6, 1 ether, 1040, 0)));
        require(
            !ok && vault.trackedUsdcBalance() == 1000e6 && usdc.balanceOf(address(vault)) == 1000e6
                && usdc.allowance(address(vault), address(venue)) == 0,
            "partial execution"
        );
    }

    function test_ClosedOrStaleSessionAndRiskPauseRollbackStockTrades() public {
        feed.updateSession(0, 0, 1000, keccak256("confirmed-market-closed"));
        vm.prank(ALICE);
        (bool ok,) =
            address(vault).call(abi.encodeCall(vault.execute, (true, 100e6, 1 ether, 1030, 0)));
        require(
            !ok && vault.trackedUsdcBalance() == 1000e6 && venue.paused() == false,
            "closed market rollback"
        );
        feed.updateSession(1000, 2000, 1000, keccak256("confirmed-regular-session"));
        venue.setPaused(true);
        vm.prank(ALICE);
        (ok,) = address(vault).call(abi.encodeCall(vault.execute, (true, 100e6, 1 ether, 1030, 0)));
        require(!ok && vault.trackedUsdcBalance() == 1000e6, "risk pause rollback");
        venue.setPaused(false);
        buy();
        vm.warp(1061);
        feed.update(100e6, 1061, keccak256("fresh-price-stale-calendar"));
        uint256 version = vault.executionVersion();
        vm.prank(ALICE);
        (ok,) = address(vault)
            .call(abi.encodeCall(vault.execute, (false, 1 ether, 100e6, 1090, version)));
        require(
            !ok && vault.trackedPosition(address(tsla)) == 1 ether,
            "stale calendar blocks exit trade"
        );
        feed.updateSession(1000, 2000, 1061, keccak256("refreshed-calendar"));
        vm.prank(ALICE);
        vault.execute(false, 1 ether, 100e6, 1090, version);
        require(vault.trackedPosition(address(tsla)) == 0, "fresh session resumes");
    }
}
