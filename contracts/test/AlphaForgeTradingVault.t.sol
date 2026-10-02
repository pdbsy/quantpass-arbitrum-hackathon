// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AlphaForgeTradingVault } from "../src/AlphaForgeTradingVault.sol";
import { AlphaForgeTestStock, AlphaForgeTestReferenceFeed } from "../src/AlphaForgeTestStock.sol";
import { AlphaForgeTestUSDC } from "../src/AlphaForgeTestAsset.sol";
import { StrategyPass } from "../src/StrategyPass.sol";
import { PassLocker } from "../src/PassLocker.sol";
import { ISinglePoolRouter02 } from "../src/interfaces/ISinglePoolRouter02.sol";

interface TradingVm {
    function prank(address who) external;
    function startPrank(address who) external;
    function stopPrank() external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 chainId) external;
}

/// @dev Unit boundary only; official V3 artifacts have their own protocol qualification test.
contract Router02Boundary is ISinglePoolRouter02 {
    address public immutable usdc;
    uint8 public mode;

    function setMode(uint8 next) external {
        mode = next;
    }

    constructor(address usdc_) {
        usdc = usdc_;
    }

    function exactInputSingle(ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 out)
    {
        require(
            p.recipient == msg.sender && p.fee == 3000 && p.sqrtPriceLimitX96 == 0,
            "route constraint"
        );
        out = p.tokenIn == usdc ? p.amountIn * 1e12 / 100 : p.amountIn * 100 / 1e12;
        require(out >= p.amountOutMinimum, "minimum output");
        if (mode == 1) {
            (bool entered, bytes memory reason) =
                msg.sender.call(abi.encodeWithSignature("checkRisk()"));
            require(
                !entered && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
                "reentrant risk mutation"
            );
        }
        require(
            IERC20(p.tokenIn)
                .transferFrom(msg.sender, address(this), mode == 4 ? p.amountIn - 1 : p.amountIn),
            "input"
        );
        if (mode != 3) require(IERC20(p.tokenOut).transfer(p.recipient, out), "output");
        if (mode == 2) ++out;
    }
}

contract AlphaForgeTradingVaultTest {
    TradingVm private constant VM =
        TradingVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OWNER = address(0xA11CE);
    address private constant EXECUTOR = address(0xE111);
    bytes32 private constant ID = keccak256("ema-three-stock");
    AlphaForgeTestUSDC private usdc;
    StrategyPass private pass;
    AlphaForgeTradingVault private vault;
    Router02Boundary private router;
    address[3] private stocks;
    address[3] private feeds;

    function setUp() public {
        VM.chainId(46630);
        VM.warp(1000);
        usdc = new AlphaForgeTestUSDC(1_000_000e6, OWNER);
        pass = new StrategyPass("AlphaForge Test EMA Pass", "AF-PASS", ID, 1_000_000 ether, OWNER);
        router = new Router02Boundary(address(usdc));
        for (uint8 i; i < 3; ++i) {
            stocks[i] = address(new AlphaForgeTestStock(i, 10_000 ether, address(router)));
            AlphaForgeTestReferenceFeed feed =
                new AlphaForgeTestReferenceFeed(address(this), keccak256(abi.encode(i)));
            feed.update(100e6, 1000, keccak256("source-observation"));
            feeds[i] = address(feed);
        }
        vault = new AlphaForgeTradingVault(
            AlphaForgeTradingVault.Configuration({
                owner: OWNER,
                strategyCreator: address(0xC123),
                strategyId: ID,
                strategyRef: keccak256("ema15-30-v1"),
                pass: address(pass),
                usdc: address(usdc),
                router: address(router),
                stocks: stocks,
                feeds: feeds,
                maxPriceAge: 30
            })
        );
        VM.startPrank(OWNER);
        usdc.approve(address(vault), type(uint256).max);
        pass.approve(address(vault), type(uint256).max);
        vault.deposit(1000e6);
        vault.allocate(900e6);
        vault.authorizeExecutor(
            AlphaForgeTradingVault.Grant({
                executor: EXECUTOR,
                expiresAt: 1100,
                liquidationWindow: 60,
                maxOrderUsdc: 300e6,
                maxTotalBuyUsdc: 900e6,
                maxSlippageBps: 40
            })
        );
        VM.stopPrank();
    }

    function test_RouterCannotReenterPublicRiskMutation() public {
        router.setMode(1);
        buy(0, 200e6);
        require(
            vault.runtimeCash() == 700e6 && vault.trackedPosition(stocks[0]) == 2 ether,
            "outer trade"
        );
        require(!vault.liquidating(), "unexpected liquidation");
    }

    function test_RouterMismatchRollsBackMovementAccountingAndApproval() public {
        for (uint8 mode = 2; mode <= 4; ++mode) {
            router.setMode(mode);
            uint256 version = vault.stateVersion();
            VM.startPrank(EXECUTOR);
            (bool ok,) = address(vault)
                .call(
                    abi.encodeCall(
                        vault.execute, (action(address(usdc), stocks[0], 200e6, 2 ether))
                    )
                );
            VM.stopPrank();
            require(!ok, "bad router accepted");
            require(
                vault.stateVersion() == version && vault.runtimeCash() == 900e6
                    && vault.trackedPosition(stocks[0]) == 0,
                "accounting changed"
            );
            require(
                usdc.balanceOf(address(vault)) == 1000e6
                    && IERC20(stocks[0]).balanceOf(address(vault)) == 0,
                "movement not reverted"
            );
            require(usdc.allowance(address(vault), address(router)) == 0, "approval leaked");
        }
    }

    function testFuzz_CashReallocationNeverUnlocksCapacityOrCreatesReturns(uint96 seed) public {
        uint256 amount = uint256(seed) % 899e6 + 1;
        uint256 nav = vault.unitNav();
        VM.startPrank(OWNER);
        vault.deallocate(amount);
        vault.allocate(amount);
        VM.stopPrank();
        require(
            vault.unitNav() == nav && vault.runtimeUnits() == 900 ether, "artificial performance"
        );
        require(
            vault.principalBasis() == 1000e6
                && PassLocker(vault.passLocker()).lockedBalance() == 1000 ether,
            "capacity drift"
        );
    }

    function action(address input, address output, uint256 amount, uint256 minimum)
        private
        view
        returns (AlphaForgeTradingVault.Swap memory)
    {
        return
            AlphaForgeTradingVault.Swap(input, output, amount, minimum, 1030, vault.stateVersion());
    }

    function buy(uint8 i, uint256 amount) private {
        VM.startPrank(EXECUTOR);
        vault.execute(action(address(usdc), stocks[i], amount, amount * 1e12 / 100));
        VM.stopPrank();
    }

    function test_ThreeStockAccountingAndDustCannotGrantCustody() public {
        buy(2, 200e6);
        require(vault.trackedPosition(stocks[2]) == 2 ether, "third asset lost");
        require(vault.runtimeCash() == 700e6 && vault.idleCash() == 100e6, "cash mismatch");
        require(vault.runtimeEquity() == 900e6, "equity mismatch");
        require(
            IERC20(address(usdc)).allowance(address(vault), address(router)) == 0,
            "residual allowance"
        );
        VM.startPrank(EXECUTOR);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.withdraw, (1e6)));
        VM.stopPrank();
        require(!ok, "executor acquired withdrawal");
        VM.startPrank(OWNER);
        usdc.transfer(address(vault), 17e6);
        VM.stopPrank();
        require(
            vault.runtimeEquity() == 900e6 && vault.idleCash() == 100e6, "dust changed accounting"
        );
    }

    function test_CashOnlyDeallocationDoesNotSellOrUnlockPass() public {
        buy(0, 200e6);
        VM.startPrank(OWNER);
        vault.deallocate(200e6);
        VM.stopPrank();
        require(vault.runtimeCash() == 500e6 && vault.idleCash() == 300e6, "deallocation failed");
        require(vault.trackedPosition(stocks[0]) == 2 ether, "implicit sale");
        require(
            PassLocker(vault.passLocker()).lockedBalance() == 1000 ether,
            "allocation unlocked capacity"
        );
        VM.startPrank(OWNER);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.deallocate, (501e6)));
        VM.stopPrank();
        require(!ok && vault.runtimeCash() == 500e6, "cash insufficiency changed state");
        VM.startPrank(OWNER);
        (ok,) = address(vault).call(abi.encodeCall(vault.withdraw, (1e6)));
        VM.stopPrank();
        require(!ok, "principal escaped with position");
    }

    function test_StopLatchesSellOnlyAndCloseReleasesAllCapacity() public {
        buy(0, 200e6);
        VM.startPrank(OWNER);
        vault.stop();
        VM.stopPrank();
        VM.startPrank(EXECUTOR);
        (bool ok,) = address(vault)
            .call(abi.encodeCall(vault.execute, (action(address(usdc), stocks[1], 1e6, 1e16))));
        VM.stopPrank();
        require(!ok, "buy after stop");
        VM.startPrank(EXECUTOR);
        vault.execute(action(stocks[0], address(usdc), 2 ether, 200e6));
        VM.stopPrank();
        VM.startPrank(OWNER);
        vault.close();
        VM.stopPrank();
        require(
            vault.closed() && vault.principalBasis() == 0 && vault.runtimeUnits() == 0,
            "close incomplete"
        );
        require(
            PassLocker(vault.passLocker()).lockedBalance() == 0
                && pass.balanceOf(OWNER) == 1_000_000 ether,
            "capacity stuck"
        );
        require(usdc.balanceOf(OWNER) == 1_000_000e6, "wrong recipient");
    }

    function test_ExpiryUsesPreauthorizedWindowWithoutReopeningBuys() public {
        buy(1, 200e6);
        VM.warp(1100);
        for (uint8 i; i < 3; ++i) {
            AlphaForgeTestReferenceFeed(feeds[i]).update(100e6, 1100, keccak256("later"));
        }
        VM.startPrank(EXECUTOR);
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.execute,
                    (AlphaForgeTradingVault.Swap(
                            address(usdc), stocks[0], 1e6, 1e16, 1120, vault.stateVersion()
                        ))
                )
            );
        VM.stopPrank();
        require(!ok, "expiry buy");
        VM.warp(1161);
        for (uint8 i; i < 3; ++i) {
            AlphaForgeTestReferenceFeed(feeds[i]).update(100e6, 1161, keccak256("last"));
        }
        VM.startPrank(EXECUTOR);
        (ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.execute,
                    (AlphaForgeTradingVault.Swap(
                            stocks[1], address(usdc), 2 ether, 200e6, 1162, vault.stateVersion()
                        ))
                )
            );
        VM.stopPrank();
        require(!ok && vault.trackedPosition(stocks[1]) == 2 ether, "expired executor authority");
    }

    function test_ExpiryWindowAllowsLastSecondSellAndStopCannotExtendIt() public {
        buy(0, 200e6);
        VM.warp(1120);
        VM.startPrank(OWNER);
        vault.stop();
        VM.stopPrank();
        require(vault.liquidationUntil() == 1160, "window extended beyond grant");
        VM.warp(1160);
        for (uint8 i; i < 3; ++i) {
            AlphaForgeTestReferenceFeed(feeds[i])
                .update(100e6, 1160, keccak256("last permitted second"));
        }
        VM.startPrank(OWNER);
        vault.stop();
        VM.stopPrank();
        require(vault.liquidationUntil() == 1160, "repeat stop extended authority");
        VM.startPrank(EXECUTOR);
        vault.execute(
            AlphaForgeTradingVault.Swap(
                stocks[0], address(usdc), 2 ether, 200e6, 1160, vault.stateVersion()
            )
        );
        VM.stopPrank();
        require(vault.openTrackedPositionCount() == 0, "last-second liquidation blocked");
    }

    function test_FutureDuplicateAndZeroReferenceUpdatesReject() public {
        AlphaForgeTestReferenceFeed feed = AlphaForgeTestReferenceFeed(feeds[0]);
        (bool future,) =
            address(feed).call(abi.encodeCall(feed.update, (100e6, 1001, keccak256("future"))));
        (bool duplicate,) =
            address(feed).call(abi.encodeCall(feed.update, (100e6, 1000, keccak256("duplicate"))));
        VM.warp(1001);
        (bool zero,) = address(feed).call(abi.encodeCall(feed.update, (0, 1001, keccak256("zero"))));
        require(!future && !duplicate && !zero, "invalid reference accepted");
        (uint256 price, uint64 observed,) = feed.price();
        require(price == 100e6 && observed == 1000, "invalid update changed state");
    }

    function test_ExpiredGrantAndPastOrderDeadlineNeverMoveFunds() public {
        VM.startPrank(OWNER);
        (bool grantOk,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.authorizeExecutor,
                    (AlphaForgeTradingVault.Grant(EXECUTOR, 1000, 60, 300e6, 900e6, 40))
                )
            );
        VM.stopPrank();
        VM.startPrank(EXECUTOR);
        (bool orderOk,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.execute,
                    (AlphaForgeTradingVault.Swap(
                            address(usdc), stocks[0], 1e6, 1e16, 999, vault.stateVersion()
                        ))
                )
            );
        VM.stopPrank();
        require(
            !grantOk && !orderOk && vault.runtimeCash() == 900e6, "expired authority or deadline"
        );
    }

    function test_OverweightAndDuplicateVersionRejectBeforeTokenMovement() public {
        buy(0, 300e6);
        uint256 version = vault.stateVersion();
        AlphaForgeTradingVault.Swap memory stale =
            AlphaForgeTradingVault.Swap(address(usdc), stocks[1], 1e6, 1e16, 1030, version - 1);
        VM.startPrank(EXECUTOR);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.execute, (stale)));
        VM.stopPrank();
        require(!ok, "stale version accepted");
        VM.startPrank(EXECUTOR);
        (ok,) = address(vault)
            .call(abi.encodeCall(vault.execute, (action(address(usdc), stocks[0], 1e6, 1e16))));
        VM.stopPrank();
        require(!ok && vault.runtimeCash() == 600e6, "overweight buy");
    }

    function test_StalePriceAndForeignAssetNeverMoveFunds() public {
        VM.warp(1031);
        VM.startPrank(EXECUTOR);
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.execute,
                    (AlphaForgeTradingVault.Swap(
                            address(usdc), stocks[0], 100e6, 1 ether, 1032, vault.stateVersion()
                        ))
                )
            );
        VM.stopPrank();
        require(!ok && vault.runtimeCash() == 900e6, "stale feed trade");
        VM.warp(1000);
        VM.startPrank(EXECUTOR);
        (ok,) = address(vault)
            .call(abi.encodeCall(vault.execute, (action(address(usdc), address(pass), 1e6, 1))));
        VM.stopPrank();
        require(!ok, "unsupported asset");
    }

    function test_RevocationInvalidatesAlreadyPreparedOwnerSellAndPreservesOwnerRecovery() public {
        buy(0, 200e6);
        VM.startPrank(OWNER);
        vault.stop();
        VM.stopPrank();
        AlphaForgeTradingVault.Swap memory prepared =
            action(stocks[0], address(usdc), 2 ether, 200e6);
        VM.startPrank(OWNER);
        vault.revokeExecutor();
        (bool ok,) = address(vault).call(abi.encodeCall(vault.execute, (prepared)));
        require(
            !ok && vault.trackedPosition(stocks[0]) == 2 ether,
            "revocation did not invalidate prepared action"
        );
        vault.execute(action(stocks[0], address(usdc), 2 ether, 200e6));
        VM.stopPrank();
        require(vault.trackedPosition(stocks[0]) == 0, "owner recovery disabled");
    }

    function test_RuntimeFlowsKeepUnitNavNeutralAndNeverReleaseCapacity() public {
        buy(0, 200e6);
        VM.warp(1001);
        AlphaForgeTestReferenceFeed(feeds[0]).update(110e6, 1001, keccak256("gain"));
        require(vault.unitNav() == 1022222, "initial net value");
        VM.startPrank(OWNER);
        vault.allocate(100e6);
        uint256 afterDeposit = vault.unitNav();
        vault.deallocate(300e6);
        VM.stopPrank();
        require(afterDeposit == 1022222 && vault.unitNav() == 1022222, "cash flow created return");
        require(
            PassLocker(vault.passLocker()).lockedBalance() == 1000 ether,
            "runtime cash movement unlocked pass"
        );
    }

    function test_TouchedBoundsLatchAndCannotRecoverToBuyingWhenPriceRecovers() public {
        buy(2, 200e6);
        uint256[3] memory lowers;
        uint256[3] memory uppers;
        lowers[2] = 99e6;
        VM.startPrank(OWNER);
        vault.setBounds(0, 0, lowers, uppers);
        VM.stopPrank();
        VM.warp(1001);
        AlphaForgeTestReferenceFeed(feeds[2]).update(99e6, 1001, keccak256("touch"));
        require(vault.checkRisk() && vault.liquidating(), "touch failed to latch");
        VM.warp(1002);
        AlphaForgeTestReferenceFeed(feeds[2]).update(101e6, 1002, keccak256("rebound"));
        VM.startPrank(EXECUTOR);
        (bool ok,) = address(vault)
            .call(abi.encodeCall(vault.execute, (action(address(usdc), stocks[1], 1e6, 1e16))));
        VM.stopPrank();
        require(!ok && vault.runtimeCash() == 700e6, "rebound reopened buy");
    }

    function test_InexactPassAndWrongKeeperCannotChangeCapacityOrPrices() public {
        (bool ok,) = address(vault).call(abi.encodeCall(vault.passToUsdcRaw, (1e12 + 1)));
        require(!ok, "pass precision truncated");
        VM.startPrank(EXECUTOR);
        (ok,) = feeds[0].call(
            abi.encodeCall(
                AlphaForgeTestReferenceFeed.update, (1e6, uint64(1001), keccak256("forged"))
            )
        );
        VM.stopPrank();
        require(!ok && vault.unitNav() == 1e6, "untrusted price accepted");
    }
}
