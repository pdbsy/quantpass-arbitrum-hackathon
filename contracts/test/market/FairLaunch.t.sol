// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StrategyPass } from "../../src/StrategyPass.sol";
import { AlphaForgeTestUSDC } from "../../src/AlphaForgeTestAsset.sol";
import { MarketTypes } from "../../src/market/MarketTypes.sol";
import { AlphaForgePassPool } from "../../src/market/AlphaForgePassPool.sol";
import { AlphaForgePassFactory } from "../../src/market/AlphaForgePassFactory.sol";
import { AlphaForgeNativeReserve } from "../../src/market/AlphaForgeNativeReserve.sol";
import { AlphaForgeMarketRouter } from "../../src/market/AlphaForgeMarketRouter.sol";
import { AlphaForgeFairLaunch } from "../../src/market/AlphaForgeFairLaunch.sol";
import { AlphaForgeClaimReserve } from "../../src/market/AlphaForgeClaimReserve.sol";
import { ConfigurableAsset } from "../mocks/ConfigurableAsset.sol";

interface MarketVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function expectRevert() external;
    function mockCallRevert(address, bytes calldata, bytes calldata) external;
    function clearMockedCalls() external;
}

/// @notice All signing/funding/deployments exist exclusively inside Foundry's isolated EVM.
abstract contract MarketFixture {
    MarketVm internal constant VM =
        MarketVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant ORACLE_KEY = 0xA11CE;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant LP_OWNER = address(0x1F);
    bytes32 internal constant ALICE_ID = keccak256("test-account-alice");
    bytes32 internal constant BOB_ID = keccak256("test-account-bob");
    AlphaForgeTestUSDC internal usdc;
    StrategyPass internal pass;
    AlphaForgePassFactory internal factory;
    AlphaForgeNativeReserve internal reserve;
    AlphaForgeMarketRouter internal router;
    AlphaForgeFairLaunch internal launch;
    AlphaForgeClaimReserve internal claims;
    address internal signer;
    event FinalMintGas(uint256 measuredGas, uint256 configuredBudget);

    function setUp() public {
        VM.chainId(46630);
        VM.warp(1_800_000_000);
        VM.deal(address(this), 1_000 ether);
        VM.deal(ALICE, 100 ether);
        VM.deal(BOB, 100 ether);
        signer = VM.addr(ORACLE_KEY);
        usdc = new AlphaForgeTestUSDC(5_000_000e6, address(this));
        pass = new StrategyPass(
            "All in TSLA", "TSLA-PASS", keccak256("all-in-tsla"), 1_000_000 ether, address(this)
        );
        factory = new AlphaForgePassFactory(address(this), address(usdc));
        reserve = new AlphaForgeNativeReserve(
            address(this),
            address(usdc),
            signer,
            0,
            AlphaForgeNativeReserve.RiskLimits(2 ether, 3 ether, 20 ether, 1 ether)
        );
        router = new AlphaForgeMarketRouter(factory, reserve);
        launch = new AlphaForgeFairLaunch(
            AlphaForgeFairLaunch.Configuration(
                address(this),
                address(pass),
                address(usdc),
                address(factory),
                address(reserve),
                LP_OWNER
            )
        );
        claims = new AlphaForgeClaimReserve(address(this), address(usdc), signer);
        factory.configureInitializer(address(pass), address(launch));
        reserve.authorizeRouter(address(launch));
        reserve.authorizeRouter(address(router));
        reserve.configureTradingRouter(address(router));
        usdc.approve(address(reserve), 500_000e6);
        reserve.fundUsdc(500_000e6);
        reserve.fundNative{ value: 30 ether }();
        require(pass.transfer(address(launch), 1_000_000 ether), "fund pass");
        require(usdc.transfer(address(launch), 250_000e6), "fund launch LP");
        require(usdc.transfer(ALICE, 500_000e6) && usdc.transfer(BOB, 500_000e6), "test balances");
        VM.startPrank(ALICE);
        usdc.approve(address(launch), type(uint256).max);
        VM.stopPrank();
        VM.startPrank(BOB);
        usdc.approve(address(launch), type(uint256).max);
        VM.stopPrank();
        launch.openMint();
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 60);
    }

    function _sign(bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(ORACLE_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _quote(
        uint8 operation,
        address payer,
        bytes32 accountId,
        uint256 nonce,
        uint256 amountIn,
        uint256 usdcAmount,
        uint256 minOut,
        uint256 nativeAmount
    ) internal view returns (MarketTypes.NativeQuote memory q) {
        q = MarketTypes.NativeQuote(
            operation == 0 ? address(launch) : address(router),
            payer,
            accountId,
            operation,
            address(pass),
            amountIn,
            usdcAmount,
            minOut,
            nativeAmount,
            3_000e6,
            nonce,
            uint64(block.timestamp),
            _deadline(),
            reserve.quoteEpoch()
        );
    }

    function _launch() internal returns (AlphaForgePassPool pool) {
        VM.prank(ALICE);
        launch.subscribeUsdc(500_000 ether, _deadline());
        pool = AlphaForgePassPool(launch.pool());
    }

    function _conservation(AlphaForgePassPool pool) internal view {
        require(
            pass.totalSupply() == 1_000_000 ether
                && pass.balanceOf(ALICE) + pass.balanceOf(BOB) + pass.balanceOf(address(launch))
                        + pass.balanceOf(address(pool)) == pass.totalSupply(),
            "PASS supply conservation"
        );
        require(
            pass.balanceOf(address(pool)) == pool.reservePass()
                && usdc.balanceOf(address(pool)) == pool.reserveUsdc(),
            "AMM exact reserves"
        );
        require(
            pass.balanceOf(address(router)) == 0 && usdc.balanceOf(address(router)) == 0
                && address(router).balance == 0,
            "router no custody"
        );
    }
}

contract FairLaunchTest is MarketFixture {
    function test_FinalMintCreatesPoolAndImmediatelyAllowsBothDirections() public {
        VM.prank(ALICE);
        launch.subscribeUsdc(499_999 ether, _deadline());
        require(
            launch.sold() == 499_999 ether && launch.pool() == address(0), "minting before final"
        );
        uint256 gasBefore = gasleft();
        VM.prank(BOB);
        launch.subscribeUsdc(1 ether, _deadline());
        uint256 measured = gasBefore - gasleft();
        emit FinalMintGas(measured, 6_000_000);
        require(measured < 6_000_000, "local configured launch gas budget");
        AlphaForgePassPool pool = AlphaForgePassPool(launch.pool());
        require(
            launch.state() == AlphaForgeFairLaunch.State.LAUNCHED && pool.initialized(),
            "live atomically"
        );
        require(
            pool.reservePass() == 500_000 ether && pool.reserveUsdc() == 250_000e6,
            "initial exact price"
        );
        require(usdc.balanceOf(launch.PROCEEDS_RECIPIENT()) == 250_000e6, "separate proceeds");
        require(
            pool.balanceOf(LP_OWNER) == launch.lpShares() && pool.balanceOf(address(this)) == 0,
            "explicit LP owner"
        );
        require(
            pass.balanceOf(address(launch)) == 0 && usdc.balanceOf(address(launch)) == 0,
            "no duplicate reserve"
        );
        VM.startPrank(BOB);
        usdc.approve(address(pool), 100e6);
        uint256 bought = pool.buy(100e6, 1, BOB, _deadline());
        pass.approve(address(pool), bought);
        uint256 returned = pool.sell(bought, 1, BOB, _deadline());
        VM.stopPrank();
        require(returned < 100e6 && returned > 99e6, "two LP retained fees");
        _conservation(pool);
    }

    function test_FinalLaunchFailureRollsBackPaymentDeliveryInventoryAndState() public {
        VM.prank(ALICE);
        launch.subscribeUsdc(499_999 ether, _deadline());
        uint256 beforeUsdc = usdc.balanceOf(BOB);
        uint256 proceeds = usdc.balanceOf(launch.PROCEEDS_RECIPIENT());
        VM.mockCallRevert(
            address(factory),
            abi.encodeWithSelector(factory.createPool.selector),
            abi.encodeWithSignature("Error(string)", "INJECTED_POOL_FAILURE")
        );
        VM.expectRevert();
        VM.prank(BOB);
        launch.subscribeUsdc(1 ether, _deadline());
        require(
            launch.state() == AlphaForgeFairLaunch.State.MINTING && launch.sold() == 499_999 ether
                && launch.pool() == address(0),
            "state rollback"
        );
        require(
            usdc.balanceOf(BOB) == beforeUsdc
                && usdc.balanceOf(launch.PROCEEDS_RECIPIENT()) == proceeds
                && pass.balanceOf(BOB) == 0,
            "user rollback"
        );
        require(
            pass.balanceOf(address(launch)) == 500_001 ether
                && usdc.balanceOf(address(launch)) == 250_000e6,
            "LP stays separate"
        );
        require(factory.getPool(address(pass)) == address(0), "no partial pool");
        VM.clearMockedCalls();
        VM.prank(BOB);
        launch.subscribeUsdc(1 ether, _deadline());
        require(launch.state() == AlphaForgeFairLaunch.State.LAUNCHED, "retry after cause fixed");
    }

    function test_TwoCompetingFinalPurchasesOnlyFirstSerializedTransactionSucceeds() public {
        VM.prank(ALICE);
        launch.subscribeUsdc(499_999 ether, _deadline());
        VM.prank(BOB);
        launch.subscribeUsdc(1 ether, _deadline());
        uint256 beforeBalance = usdc.balanceOf(ALICE);
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeUsdc(1 ether, _deadline());
        require(
            usdc.balanceOf(ALICE) == beforeBalance && launch.sold() == 500_000 ether,
            "serialized race no debit"
        );
        VM.expectRevert();
        launch.openMint();
        VM.expectRevert();
        factory.createPool(address(pass), LP_OWNER);
    }

    function test_RejectOversellPrecisionDeadlineAndZeroWithoutPayment() public {
        uint256 beforeBalance = usdc.balanceOf(ALICE);
        uint256[3] memory invalidAmounts = [uint256(0), uint256(1), uint256(500_001 ether)];
        for (uint256 i; i < 3; ++i) {
            VM.expectRevert();
            VM.prank(ALICE);
            launch.subscribeUsdc(invalidAmounts[i], _deadline());
        }
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeUsdc(1 ether, uint64(block.timestamp - 1));
        require(usdc.balanceOf(ALICE) == beforeBalance && launch.sold() == 0, "strict amounts");
        VM.prank(ALICE);
        launch.subscribeUsdc(2e12, _deadline());
        require(
            launch.sold() == 2e12 && usdc.balanceOf(ALICE) == beforeBalance - 1,
            "smallest exact fractional amount"
        );
    }

    function test_NativeMintForwardsOnlyNativeProceedsAndDoesNotTouchConversionInventory() public {
        uint256 nativeAmount = (uint256(500e6) * 1e18 + 3_000e6 - 1) / 3_000e6;
        MarketTypes.NativeQuote memory q =
            _quote(0, ALICE, ALICE_ID, 1, nativeAmount, 500e6, 1000 ether, nativeAmount);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        uint256 beforeEth = launch.PROCEEDS_RECIPIENT().balance;
        uint256 reserveEth = address(reserve).balance;
        uint256 reserveUsdc = usdc.balanceOf(address(reserve));
        VM.prank(ALICE);
        launch.subscribeEth{ value: nativeAmount }(1000 ether, q, sig);
        require(
            launch.PROCEEDS_RECIPIENT().balance == beforeEth + nativeAmount
                && pass.balanceOf(ALICE) == 1000 ether,
            "direct ETH mint"
        );
        require(
            usdc.balanceOf(launch.PROCEEDS_RECIPIENT()) == 0
                && address(reserve).balance == reserveEth
                && usdc.balanceOf(address(reserve)) == reserveUsdc,
            "native never pretends USDC proceeds"
        );
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeEth{ value: nativeAmount }(1000 ether, q, sig);
    }

    function test_NativeFinalMintFailureRollsBackETHAndOracleNonce() public {
        VM.prank(ALICE);
        launch.subscribeUsdc(499_999 ether, _deadline());
        uint256 nativeAmount = (uint256(500_000) * 1e18 + 3_000e6 - 1) / 3_000e6;
        MarketTypes.NativeQuote memory q =
            _quote(0, BOB, BOB_ID, 1, nativeAmount, 500_000, 1 ether, nativeAmount);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.mockCallRevert(
            address(factory),
            abi.encodeWithSelector(factory.createPool.selector),
            abi.encodeWithSignature("Error(string)", "INJECTED_POOL_FAILURE")
        );
        uint256 beforeEth = BOB.balance;
        uint256 proceeds = launch.PROCEEDS_RECIPIENT().balance;
        VM.expectRevert();
        VM.prank(BOB);
        launch.subscribeEth{ value: nativeAmount }(1 ether, q, sig);
        require(
            BOB.balance == beforeEth && launch.PROCEEDS_RECIPIENT().balance == proceeds
                && !reserve.usedNonce(BOB_ID, 1),
            "atomic ETH rollback"
        );
        require(launch.sold() == 499_999 ether && pass.balanceOf(BOB) == 0, "inventory unchanged");
    }

    function test_NativeUnderOverpayAndAlteredSignedAmountFailAtomically() public {
        uint256 nativeAmount = (uint256(500_000) * 1e18 + 3_000e6 - 1) / 3_000e6;
        MarketTypes.NativeQuote memory q =
            _quote(0, ALICE, ALICE_ID, 9, nativeAmount, 500_000, 1 ether, nativeAmount);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeEth{ value: nativeAmount - 1 }(1 ether, q, sig);
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeEth{ value: nativeAmount + 1 }(1 ether, q, sig);
        q.accountId = BOB_ID;
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeEth{ value: nativeAmount }(1 ether, q, sig);
        require(launch.sold() == 0 && !reserve.usedNonce(ALICE_ID, 9), "no partial success");
    }

    function test_OracleFailureAfterOpenDoesNotPreventUSDCFinalLaunchOrTrading() public {
        reserve.setPaused(true, true);
        AlphaForgePassPool pool = _launch();
        VM.startPrank(BOB);
        usdc.approve(address(pool), 100e6);
        pool.buy(100e6, 1, BOB, _deadline());
        VM.stopPrank();
        require(
            launch.state() == AlphaForgeFairLaunch.State.LAUNCHED && pass.balanceOf(BOB) != 0,
            "USDC independent"
        );
    }

    function test_OpenMintRequiresIndependentFundingLPIdentityAndReadyConversion() public {
        StrategyPass newPass = new StrategyPass(
            "TSLA test", "PASS", keccak256("test"), 1_000_000 ether, address(this)
        );
        AlphaForgeFairLaunch next = new AlphaForgeFairLaunch(
            AlphaForgeFairLaunch.Configuration(
                address(this),
                address(newPass),
                address(usdc),
                address(factory),
                address(reserve),
                LP_OWNER
            )
        );
        factory.configureInitializer(address(newPass), address(next));
        reserve.authorizeRouter(address(next));
        VM.expectRevert();
        next.openMint();
        require(newPass.transfer(address(next), 1_000_000 ether), "fund");
        VM.expectRevert();
        next.openMint();
        require(usdc.transfer(address(next), 250_000e6), "fund");
        reserve.setPaused(true, false);
        VM.expectRevert();
        next.openMint();
        reserve.setPaused(false, false);
        next.openMint();
        VM.expectRevert();
        VM.prank(BOB);
        next.openMint();
        VM.expectRevert();
        new AlphaForgeFairLaunch(
            AlphaForgeFairLaunch.Configuration(
                address(this),
                address(newPass),
                address(usdc),
                address(factory),
                address(reserve),
                address(0)
            )
        );
    }

    function test_DonationCannotCreatePoolOrTakeLPAllocation() public {
        VM.expectRevert();
        VM.prank(BOB);
        factory.createPool(address(pass), BOB);
        VM.expectRevert();
        factory.configureInitializer(address(pass), BOB);
        AlphaForgePassPool pool = _launch();
        VM.expectRevert();
        VM.prank(BOB);
        pool.initialize(500_000 ether, 250_000e6);
        require(
            pool.balanceOf(BOB) == 0 && pool.balanceOf(LP_OWNER) == launch.lpShares(),
            "ownership cannot be seized"
        );
    }

    function test_MarketCreationAndFundsRejectOtherChain() public {
        VM.chainId(1);
        VM.expectRevert();
        new AlphaForgePassFactory(address(this), address(usdc));
        VM.expectRevert();
        VM.prank(ALICE);
        launch.subscribeUsdc(1 ether, _deadline());
        VM.expectRevert();
        new AlphaForgeClaimReserve(address(this), address(usdc), signer);
    }
}
