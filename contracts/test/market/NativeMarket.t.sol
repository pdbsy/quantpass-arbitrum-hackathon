// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { MarketFixture } from "./FairLaunch.t.sol";
import { MarketTypes } from "../../src/market/MarketTypes.sol";
import { AlphaForgePassPool } from "../../src/market/AlphaForgePassPool.sol";
import { AlphaForgeNativeReserve } from "../../src/market/AlphaForgeNativeReserve.sol";

contract RejectingNativeReceiver {
    receive() external payable {
        revert("REJECT_NATIVE");
    }
}

contract ReenteringNativeReceiver {
    address public target;
    bytes public payload;
    bool public reentryBlocked;

    function configure(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    receive() external payable {
        (bool ok, bytes memory reason) = target.call(payload);
        require(
            !ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
            "REENTRY_REJECTED"
        );
        reentryBlocked = true;
    }
}

contract NativeMarketTest is MarketFixture {
    function test_NativeRecipientRejectionRollsBackEverythingAndReentryIsBlocked() public {
        AlphaForgePassPool pool = _launch();
        RejectingNativeReceiver rejecting = new RejectingNativeReceiver();
        VM.prank(ALICE);
        require(pass.transfer(address(rejecting), 100 ether), "contract wallet funds");
        (uint256 out,) = pool.quoteSell(100 ether);
        (uint256 nativeOut,) = reserve.usdcToNative(out, 3_000e6);
        MarketTypes.NativeQuote memory q =
            _quote(2, address(rejecting), BOB_ID, 20, 100 ether, out, nativeOut, nativeOut);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(address(rejecting));
        pass.approve(address(router), 100 ether);
        VM.expectRevert();
        router.sellNative(q, sig);
        VM.stopPrank();
        require(
            pass.balanceOf(address(rejecting)) == 100 ether && !reserve.usedNonce(BOB_ID, 20)
                && pool.reservePass() == 500_000 ether,
            "recipient failure rollback"
        );
        ReenteringNativeReceiver reentering = new ReenteringNativeReceiver();
        VM.prank(ALICE);
        require(pass.transfer(address(reentering), 100 ether), "contract wallet funds");
        q = _quote(2, address(reentering), BOB_ID, 21, 100 ether, out, nativeOut, nativeOut);
        sig = _sign(reserve.quoteDigest(q));
        reentering.configure(address(router), abi.encodeCall(router.sellNative, (q, sig)));
        VM.startPrank(address(reentering));
        pass.approve(address(router), 100 ether);
        router.sellNative(q, sig);
        VM.stopPrank();
        require(
            reentering.reentryBlocked() && address(reentering).balance == nativeOut
                && pass.balanceOf(address(reentering)) == 0,
            "single atomic payout"
        );
    }

    function test_NativeBuyAndSellUsesOneAMMAndExactIndependentReserves() public {
        AlphaForgePassPool pool = _launch();
        MarketTypes.NativeQuote memory buyQ =
            _quote(1, BOB, BOB_ID, 1, 0.1 ether, 300e6, 1 ether, 0.1 ether);
        bytes memory sig = _sign(reserve.quoteDigest(buyQ));
        uint256 beforeNative = address(reserve).balance;
        uint256 beforeUsdc = usdc.balanceOf(address(reserve));
        VM.prank(BOB);
        uint256 output = router.buyNative{ value: 0.1 ether }(buyQ, sig);
        require(
            output == pass.balanceOf(BOB) && pool.reserveUsdc() == 250_300e6, "unified price pool"
        );
        require(
            address(reserve).balance == beforeNative + 0.1 ether
                && usdc.balanceOf(address(reserve)) == beforeUsdc - 300e6,
            "real input conversion"
        );
        (uint256 expectedUsdc,) = pool.quoteSell(output);
        (uint256 expectedNative,) = reserve.usdcToNative(expectedUsdc, 3_000e6);
        MarketTypes.NativeQuote memory sellQ =
            _quote(2, BOB, BOB_ID, 2, output, expectedUsdc, expectedNative, expectedNative);
        sig = _sign(reserve.quoteDigest(sellQ));
        uint256 userNative = BOB.balance;
        VM.startPrank(BOB);
        pass.approve(address(router), output);
        uint256 paid = router.sellNative(sellQ, sig);
        VM.stopPrank();
        require(
            paid == expectedNative && BOB.balance == userNative + paid && pass.balanceOf(BOB) == 0,
            "real output conversion"
        );
        require(
            usdc.balanceOf(address(reserve)) == beforeUsdc - 300e6 + expectedUsdc, "USDC conserved"
        );
        require(address(reserve).balance == beforeNative + 0.1 ether - paid, "ETH conserved");
        _conservation(pool);
    }

    function test_SellUsesFullActualOutputInsteadOfKeepingPositiveSlippage() public {
        AlphaForgePassPool pool = _launch();
        (uint256 actualUsdc,) = pool.quoteSell(100 ether);
        (uint256 actualNative,) = reserve.usdcToNative(actualUsdc, 3_000e6);
        MarketTypes.NativeQuote memory q = _quote(
            2,
            ALICE,
            ALICE_ID,
            10,
            100 ether,
            actualUsdc * 99 / 100,
            actualNative * 99 / 100,
            actualNative * 99 / 100
        );
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(ALICE);
        pass.approve(address(router), 100 ether);
        uint256 received = router.sellNative(q, sig);
        VM.stopPrank();
        require(received == actualNative && received > q.ethAmount, "surplus reaches seller");
        _conservation(pool);
    }

    function test_ETHLiquidityFailurePreservesPASSPoolBalancesAllowanceAndNonce() public {
        AlphaForgePassPool pool = _launch();
        reserve.setLimits(AlphaForgeNativeReserve.RiskLimits(2 ether, 3 ether, 20 ether, 30 ether));
        (uint256 expectedUsdc,) = pool.quoteSell(100 ether);
        (uint256 expectedNative,) = reserve.usdcToNative(expectedUsdc, 3_000e6);
        MarketTypes.NativeQuote memory q =
            _quote(2, ALICE, ALICE_ID, 2, 100 ether, expectedUsdc, expectedNative, expectedNative);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        uint256 beforePass = pass.balanceOf(ALICE);
        VM.startPrank(ALICE);
        pass.approve(address(router), 100 ether);
        VM.expectRevert();
        router.sellNative(q, sig);
        VM.stopPrank();
        require(
            pass.balanceOf(ALICE) == beforePass
                && pass.allowance(ALICE, address(router)) == 100 ether,
            "no PASS debit"
        );
        require(
            !reserve.usedNonce(ALICE_ID, 2) && pool.reservePass() == 500_000 ether
                && pool.reserveUsdc() == 250_000e6,
            "whole swap rollback"
        );
        VM.startPrank(ALICE);
        pass.approve(address(pool), 100 ether);
        pool.sell(100 ether, 1, ALICE, _deadline());
        VM.stopPrank();
        require(usdc.balanceOf(ALICE) != 250_000e6, "USDC still live");
        _conservation(pool);
    }

    function test_DailyLimitUsesStableAccountAcrossReboundWalletsAndResetsNextDay() public {
        AlphaForgePassPool pool = _launch();
        reserve.setLimits(
            AlphaForgeNativeReserve.RiskLimits(0.02 ether, 0.02 ether, 1 ether, 1 ether)
        );
        uint256 amount = 100 ether;
        (uint256 out,) = pool.quoteSell(amount);
        (uint256 nativeOut,) = reserve.usdcToNative(out, 3_000e6);
        MarketTypes.NativeQuote memory q =
            _quote(2, ALICE, ALICE_ID, 1, amount, out, nativeOut, nativeOut);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(ALICE);
        pass.approve(address(router), amount);
        router.sellNative(q, sig);
        require(pass.transfer(BOB, amount), "rebound wallet funds");
        VM.stopPrank();
        (out,) = pool.quoteSell(amount);
        (nativeOut,) = reserve.usdcToNative(out, 3_000e6);
        q = _quote(2, BOB, ALICE_ID, 2, amount, out, nativeOut, nativeOut);
        sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(BOB);
        pass.approve(address(router), amount);
        VM.expectRevert();
        router.sellNative(q, sig);
        VM.stopPrank();
        require(
            pass.balanceOf(BOB) == amount && !reserve.usedNonce(ALICE_ID, 2),
            "stable ID enforces wallet rebind"
        );
        VM.warp(block.timestamp + 1 days);
        q = _quote(2, BOB, ALICE_ID, 2, amount, out, nativeOut, nativeOut);
        sig = _sign(reserve.quoteDigest(q));
        VM.prank(BOB);
        router.sellNative(q, sig);
        _conservation(pool);
    }

    function test_PerTransactionAndGlobalLimitsPreventFreeFundETHDrain() public {
        AlphaForgePassPool pool = _launch();
        reserve.setLimits(
            AlphaForgeNativeReserve.RiskLimits(0.01 ether, 0.02 ether, 0.02 ether, 1 ether)
        );
        (uint256 out,) = pool.quoteSell(100 ether);
        (uint256 nativeOut,) = reserve.usdcToNative(out, 3_000e6);
        MarketTypes.NativeQuote memory q =
            _quote(2, ALICE, ALICE_ID, 1, 100 ether, out, nativeOut, nativeOut);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(ALICE);
        pass.approve(address(router), 100 ether);
        VM.expectRevert();
        router.sellNative(q, sig);
        VM.stopPrank();
        require(!reserve.usedNonce(ALICE_ID, 1), "per tx cap rollback");
        reserve.setLimits(
            AlphaForgeNativeReserve.RiskLimits(0.02 ether, 0.02 ether, 0.02 ether, 1 ether)
        );
        VM.prank(ALICE);
        router.sellNative(q, sig);
        VM.prank(ALICE);
        require(pass.transfer(BOB, 100 ether), "Bob funds");
        (out,) = pool.quoteSell(100 ether);
        (nativeOut,) = reserve.usdcToNative(out, 3_000e6);
        q = _quote(2, BOB, BOB_ID, 1, 100 ether, out, nativeOut, nativeOut);
        sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(BOB);
        pass.approve(address(router), 100 ether);
        VM.expectRevert();
        router.sellNative(q, sig);
        VM.stopPrank();
        require(!reserve.usedNonce(BOB_ID, 1), "global cap shared across accounts");
    }

    function test_ReplayExpirationWrongPayerRouterChainAndSignerRotationFail() public {
        _launch();
        MarketTypes.NativeQuote memory q = _quote(1, BOB, BOB_ID, 1, 0.1 ether, 300e6, 1, 0.1 ether);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.expectRevert();
        VM.prank(ALICE);
        router.buyNative{ value: 0.1 ether }(q, sig);
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        VM.expectRevert();
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        q.nonce = 2;
        sig = _sign(reserve.quoteDigest(q));
        VM.warp(block.timestamp + 61);
        VM.expectRevert();
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        q = _quote(1, BOB, BOB_ID, 2, 0.1 ether, 300e6, 1, 0.1 ether);
        sig = _sign(reserve.quoteDigest(q));
        reserve.setQuoteSigner(signer);
        VM.expectRevert();
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        q = _quote(1, BOB, BOB_ID, 2, 0.1 ether, 300e6, 1, 0.1 ether);
        sig = _sign(reserve.quoteDigest(q));
        VM.chainId(1);
        VM.expectRevert();
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
    }

    function test_ExpiredOrSlippageBuyCannotLeaveConversionOrQuotePartiallyConsumed() public {
        _launch();
        uint256 beforeUsdc = usdc.balanceOf(address(reserve));
        uint256 beforeEth = address(reserve).balance;
        MarketTypes.NativeQuote memory q =
            _quote(1, BOB, BOB_ID, 1, 0.1 ether, 300e6, 500_001 ether, 0.1 ether);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.expectRevert();
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        require(
            !reserve.usedNonce(BOB_ID, 1) && usdc.balanceOf(address(reserve)) == beforeUsdc
                && address(reserve).balance == beforeEth,
            "slippage atomic conversion"
        );
    }

    function test_ConversionFeeAccountingAndPricePrecision() public {
        AlphaForgeNativeReserve feeReserve = new AlphaForgeNativeReserve(
            address(this),
            address(usdc),
            signer,
            30,
            AlphaForgeNativeReserve.RiskLimits(1 ether, 2 ether, 10 ether, 1 ether)
        );
        (uint256 output, uint256 fee) = feeReserve.nativeToUsdc(0.1 ether, 3000e6);
        require(output == 299_100_000 && fee == 900_000, "buy fee after valuation");
        (output, fee) = feeReserve.usdcToNative(300e6, 3000e6);
        require(output == 0.0997 ether && fee == 900_000, "sell fee before valuation");
        (output, fee) = feeReserve.nativeToUsdc(1, 1);
        require(output == 0 && fee == 0, "cannot manufacture smallest USDC");
    }

    function test_PrivilegedFundingPauseWithdrawalAndRouterAreNotUserCallable() public {
        VM.expectRevert();
        VM.prank(BOB);
        reserve.authorizeRouter(address(router));
        VM.expectRevert();
        VM.prank(BOB);
        reserve.configureTradingRouter(address(router));
        VM.expectRevert();
        reserve.configureTradingRouter(address(router));
        VM.expectRevert();
        VM.prank(BOB);
        reserve.setPaused(true, true);
        VM.expectRevert();
        VM.prank(BOB);
        reserve.setQuoteSigner(BOB);
        VM.expectRevert();
        VM.prank(BOB);
        reserve.fundNative{ value: 1 ether }();
        VM.expectRevert();
        VM.prank(BOB);
        reserve.withdrawNative(payable(BOB), 1 ether);
        VM.expectRevert();
        reserve.withdrawNative(payable(BOB), 1 ether);
        reserve.setPaused(true, true);
        uint256 beforeEth = BOB.balance;
        reserve.withdrawNative(payable(BOB), 1 ether);
        reserve.withdrawUsdc(BOB, 1e6);
        require(BOB.balance == beforeEth + 1 ether, "auditable operator withdrawal");
        VM.expectRevert();
        reserve.withdrawNative(payable(BOB), 29 ether);
    }

    function test_ETHInputAndOutputPauseIndependentlyAndAMMRemainsLive() public {
        AlphaForgePassPool pool = _launch();
        reserve.setPaused(true, false);
        MarketTypes.NativeQuote memory q = _quote(1, BOB, BOB_ID, 1, 0.1 ether, 300e6, 1, 0.1 ether);
        bytes memory sig = _sign(reserve.quoteDigest(q));
        VM.expectRevert();
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        (uint256 out,) = pool.quoteSell(100 ether);
        (uint256 nativeOut,) = reserve.usdcToNative(out, 3_000e6);
        q = _quote(2, ALICE, ALICE_ID, 1, 100 ether, out, nativeOut, nativeOut);
        sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(ALICE);
        pass.approve(address(router), 100 ether);
        router.sellNative(q, sig);
        VM.stopPrank();
        reserve.setPaused(false, true);
        q = _quote(1, BOB, BOB_ID, 1, 0.1 ether, 300e6, 1, 0.1 ether);
        sig = _sign(reserve.quoteDigest(q));
        VM.prank(BOB);
        router.buyNative{ value: 0.1 ether }(q, sig);
        _conservation(pool);
    }

    function test_FuzzBuySellConservesSupplyAndNeverDecreasesProduct(uint64 seed) public {
        AlphaForgePassPool pool = _launch();
        uint256 input = uint256(seed) % 100_000e6 + 100;
        uint256 kBefore = pool.reservePass() * pool.reserveUsdc();
        VM.startPrank(BOB);
        usdc.approve(address(pool), input);
        uint256 output = pool.buy(input, 1, BOB, _deadline());
        uint256 kAfterBuy = pool.reservePass() * pool.reserveUsdc();
        pass.approve(address(pool), output);
        uint256 returned = pool.sell(output, 1, BOB, _deadline());
        VM.stopPrank();
        require(
            kAfterBuy >= kBefore && pool.reservePass() * pool.reserveUsdc() >= kAfterBuy
                && returned < input,
            "fees retained product monotonic"
        );
        _conservation(pool);
    }

    function test_LPRedemptionPermissionAndRoundingRemainWithActualShareHolder() public {
        AlphaForgePassPool pool = _launch();
        VM.expectRevert();
        VM.prank(BOB);
        pool.removeLiquidity(1, 0, 0, BOB, _deadline());
        uint256 shares = pool.balanceOf(LP_OWNER) / 10;
        VM.prank(LP_OWNER);
        (uint256 returnedPass, uint256 returnedUsdc) =
            pool.removeLiquidity(shares, 1, 1, LP_OWNER, _deadline());
        require(
            returnedPass != 0 && returnedUsdc != 0 && pass.balanceOf(LP_OWNER) == returnedPass
                && usdc.balanceOf(LP_OWNER) == returnedUsdc,
            "LP only actual holder"
        );
        // Redemption floors, while adding rounds upwards; provide a small independent dust budget.
        VM.prank(ALICE);
        require(pass.transfer(LP_OWNER, 100), "LP precision dust");
        require(usdc.transfer(LP_OWNER, 100), "LP precision dust");
        VM.startPrank(LP_OWNER);
        pass.approve(address(pool), returnedPass + 100);
        usdc.approve(address(pool), returnedUsdc + 100);
        pool.addLiquidity(shares, returnedPass + 100, returnedUsdc + 100, LP_OWNER, _deadline());
        VM.stopPrank();
        require(pool.balanceOf(LP_OWNER) == launch.lpShares(), "proportional LP restored");
    }
}
