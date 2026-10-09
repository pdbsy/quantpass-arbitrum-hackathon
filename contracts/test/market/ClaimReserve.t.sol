// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { MarketFixture } from "./FairLaunch.t.sol";
import { AlphaForgeClaimReserve } from "../../src/market/AlphaForgeClaimReserve.sol";
import { AlphaForgePassPool } from "../../src/market/AlphaForgePassPool.sol";
import { MarketTypes } from "../../src/market/MarketTypes.sol";
import { ConfigurableAsset } from "../mocks/ConfigurableAsset.sol";

contract ClaimReserveTest is MarketFixture {
    function test_BadTokenDeliveryCannotConsumeClaimEntitlement() public {
        ConfigurableAsset token =
            new ConfigurableAsset("Bad USDC test", "TEST", 6, 100_000e6, address(this));
        AlphaForgeClaimReserve badClaims =
            new AlphaForgeClaimReserve(address(this), address(token), signer);
        token.approve(address(badClaims), 100_000e6);
        badClaims.fund(100_000e6);
        badClaims.openClaims();
        token.setTransferFee(1);
        AlphaForgeClaimReserve.ClaimVoucher memory v = AlphaForgeClaimReserve.ClaimVoucher(
            ALICE_ID, ALICE, 1, uint64(block.timestamp), _deadline(), 1
        );
        bytes memory sig = _sign(badClaims.voucherDigest(v));
        VM.expectRevert();
        VM.prank(ALICE);
        badClaims.claim(v, sig);
        require(
            !badClaims.claimedAccount(ALICE_ID) && badClaims.totalClaims() == 0
                && token.balanceOf(ALICE) == 0 && token.balanceOf(address(badClaims)) == 100_000e6,
            "token failure atomic entitlement"
        );
    }

    function _openClaims() internal {
        usdc.approve(address(claims), 100_000e6);
        claims.fund(100_000e6);
        claims.openClaims();
    }

    function _voucher(bytes32 id, address wallet, uint256 nonce)
        internal
        view
        returns (AlphaForgeClaimReserve.ClaimVoucher memory)
    {
        return AlphaForgeClaimReserve.ClaimVoucher(
            id, wallet, nonce, uint64(block.timestamp), _deadline(), claims.claimEpoch()
        );
    }

    function test_ClaimRequiresIssuerApprovalWalletOwnershipAndPrefunding() public {
        AlphaForgeClaimReserve.ClaimVoucher memory v = _voucher(ALICE_ID, ALICE, 1);
        bytes memory sig = _sign(claims.voucherDigest(v));
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(v, sig);
        VM.expectRevert();
        claims.openClaims();
        _openClaims();
        VM.expectRevert();
        VM.prank(BOB);
        claims.claim(v, sig);
        uint256 beforeBalance = usdc.balanceOf(ALICE);
        VM.prank(ALICE);
        claims.claim(v, sig);
        require(
            usdc.balanceOf(ALICE) == beforeBalance + 1000e6 && claims.claimedAccount(ALICE_ID)
                && claims.totalClaims() == 1,
            "real claim state"
        );
        require(usdc.balanceOf(address(claims)) == 99_000e6, "separate reserve accounting");
    }

    function test_WalletRebindingAndReloginDoNotResetStableAccountClaim() public {
        _openClaims();
        AlphaForgeClaimReserve.ClaimVoucher memory v = _voucher(ALICE_ID, ALICE, 1);
        bytes memory sig = _sign(claims.voucherDigest(v));
        VM.prank(ALICE);
        claims.claim(v, sig);
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(v, sig);
        v = _voucher(ALICE_ID, BOB, 2);
        sig = _sign(claims.voucherDigest(v));
        VM.expectRevert();
        VM.prank(BOB);
        claims.claim(v, sig);
        require(
            claims.totalClaims() == 1 && usdc.balanceOf(address(claims)) == 99_000e6,
            "stable entitlement"
        );
    }

    function test_Exactly100ClaimsAnd101stRejectedEvenWithMoreFunds() public {
        _openClaims();
        for (uint256 i; i < 100; ++i) {
            bytes32 id = keccak256(abi.encode("isolated verified account", i));
            address wallet = address(uint160(i + 100));
            AlphaForgeClaimReserve.ClaimVoucher memory v = _voucher(id, wallet, i);
            bytes memory sig = _sign(claims.voucherDigest(v));
            VM.prank(wallet);
            claims.claim(v, sig);
            require(usdc.balanceOf(wallet) == 1000e6, "each exact payout");
        }
        require(claims.totalClaims() == 100 && usdc.balanceOf(address(claims)) == 0, "100 maximum");
        usdc.approve(address(claims), 1000e6);
        claims.fund(1000e6);
        AlphaForgeClaimReserve.ClaimVoucher memory extra = _voucher(ALICE_ID, ALICE, 101);
        bytes memory extraSig = _sign(claims.voucherDigest(extra));
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(extra, extraSig);
        require(
            claims.totalClaims() == 100 && !claims.claimedAccount(ALICE_ID), "no 101st entitlement"
        );
    }

    function test_ClaimSignatureDomainTamperingExpiryEpochAndUnauthorizedControls() public {
        _openClaims();
        AlphaForgeClaimReserve.ClaimVoucher memory v = _voucher(ALICE_ID, ALICE, 1);
        bytes memory sig = _sign(claims.voucherDigest(v));
        v.accountId = BOB_ID;
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(v, sig);
        v = _voucher(ALICE_ID, ALICE, 1);
        sig = _sign(claims.voucherDigest(v));
        VM.warp(block.timestamp + 61);
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(v, sig);
        v = _voucher(ALICE_ID, ALICE, 2);
        sig = _sign(claims.voucherDigest(v));
        claims.setSigner(signer);
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(v, sig);
        VM.expectRevert();
        VM.prank(BOB);
        claims.setPaused(true);
        VM.expectRevert();
        VM.prank(BOB);
        claims.setSigner(BOB);
        VM.expectRevert();
        VM.prank(BOB);
        claims.openClaims();
        v = _voucher(ALICE_ID, ALICE, 3);
        sig = _sign(claims.voucherDigest(v));
        VM.chainId(1);
        VM.expectRevert();
        VM.prank(ALICE);
        claims.claim(v, sig);
    }

    function test_CompleteSharedMarketFlowClaimMintAndNativeBuySellForTwoAccounts() public {
        _openClaims();
        AlphaForgeClaimReserve.ClaimVoucher memory v = _voucher(ALICE_ID, ALICE, 1);
        bytes memory sig = _sign(claims.voucherDigest(v));
        VM.prank(ALICE);
        claims.claim(v, sig);
        v = _voucher(BOB_ID, BOB, 1);
        sig = _sign(claims.voucherDigest(v));
        VM.prank(BOB);
        claims.claim(v, sig);
        VM.prank(ALICE);
        launch.subscribeUsdc(2000 ether, _deadline());
        VM.prank(BOB);
        launch.subscribeUsdc(498_000 ether, _deadline());
        AlphaForgePassPool pool = AlphaForgePassPool(launch.pool());
        MarketTypes.NativeQuote memory q =
            _quote(1, ALICE, ALICE_ID, 1, 0.1 ether, 300e6, 1, 0.1 ether);
        sig = _sign(reserve.quoteDigest(q));
        VM.prank(ALICE);
        uint256 bought = router.buyNative{ value: 0.1 ether }(q, sig);
        require(pool.reserveUsdc() == 250_300e6, "shared state visible to Bob");
        (uint256 out,) = pool.quoteSell(bought);
        (uint256 nativeOut,) = reserve.usdcToNative(out, 3000e6);
        q = _quote(2, ALICE, ALICE_ID, 2, bought, out, nativeOut, nativeOut);
        sig = _sign(reserve.quoteDigest(q));
        VM.startPrank(ALICE);
        pass.approve(address(router), bought);
        router.sellNative(q, sig);
        VM.stopPrank();
        require(
            claims.totalClaims() == 2 && usdc.balanceOf(address(claims)) == 98_000e6
                && pass.balanceOf(ALICE) == 2000 ether,
            "claims separate from LP and conversion"
        );
        _conservation(pool);
    }
}
