// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { MarketTypes } from "./MarketTypes.sol";
import { AlphaForgeNativeReserve } from "./AlphaForgeNativeReserve.sol";
import { AlphaForgePassFactory } from "./AlphaForgePassFactory.sol";
import { AlphaForgePassPool } from "./AlphaForgePassPool.sol";

/// @notice Atomic native settlement over the same PASS/AF-USDC pool used by direct ERC-20 swaps.
contract AlphaForgeMarketRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    AlphaForgePassFactory public immutable factory;
    AlphaForgeNativeReserve public immutable reserve;
    address public immutable usdc;
    event NativeTrade(
        bytes32 indexed accountId,
        address indexed payer,
        address indexed pass,
        bool buy,
        uint256 passAmount,
        uint256 usdcAmount,
        uint256 ethAmount
    );

    constructor(AlphaForgePassFactory factory_, AlphaForgeNativeReserve reserve_) {
        require(
            block.chainid == 46630 && address(factory_).code.length != 0
                && address(reserve_).code.length != 0 && factory_.usdc() == reserve_.usdc(),
            "IDENTITY"
        );
        factory = factory_;
        reserve = reserve_;
        usdc = factory_.usdc();
    }

    function buyNative(MarketTypes.NativeQuote calldata quote, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (uint256 output)
    {
        require(
            quote.payer == msg.sender && quote.router == address(this)
                && quote.operation == MarketTypes.BUY,
            "BUY_OWNER"
        );
        AlphaForgePassPool pool = _pool(quote.pass);
        uint256 beforeBalance = IERC20(usdc).balanceOf(address(this));
        uint256 amount = reserve.convertBuy{ value: msg.value }(quote, signature);
        require(
            IERC20(usdc).balanceOf(address(this)) - beforeBalance == amount, "TRANSFER_MISMATCH"
        );
        IERC20(usdc).forceApprove(address(pool), amount);
        output = pool.buy(amount, quote.minOut, msg.sender, quote.deadline);
        IERC20(usdc).forceApprove(address(pool), 0);
        require(IERC20(usdc).balanceOf(address(this)) == beforeBalance, "RESIDUAL_USDC");
        emit NativeTrade(quote.accountId, msg.sender, quote.pass, true, output, amount, msg.value);
    }

    function sellNative(MarketTypes.NativeQuote calldata quote, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 output)
    {
        require(
            quote.payer == msg.sender && quote.router == address(this)
                && quote.operation == MarketTypes.SELL,
            "SELL_OWNER"
        );
        AlphaForgePassPool pool = _pool(quote.pass);
        uint256 beforePass = IERC20(quote.pass).balanceOf(address(this));
        uint256 beforeUsdc = IERC20(usdc).balanceOf(address(this));
        IERC20(quote.pass).safeTransferFrom(msg.sender, address(this), quote.amountIn);
        require(
            IERC20(quote.pass).balanceOf(address(this)) - beforePass == quote.amountIn,
            "TRANSFER_MISMATCH"
        );
        IERC20(quote.pass).forceApprove(address(pool), quote.amountIn);
        uint256 actualUsdc =
            pool.sell(quote.amountIn, quote.usdcAmount, address(this), quote.deadline);
        IERC20(quote.pass).forceApprove(address(pool), 0);
        require(
            IERC20(usdc).balanceOf(address(this)) - beforeUsdc == actualUsdc
                && IERC20(quote.pass).balanceOf(address(this)) == beforePass,
            "TRANSFER_MISMATCH"
        );
        IERC20(usdc).forceApprove(address(reserve), actualUsdc);
        output = reserve.convertSell(quote, signature, actualUsdc);
        IERC20(usdc).forceApprove(address(reserve), 0);
        require(IERC20(usdc).balanceOf(address(this)) == beforeUsdc, "RESIDUAL_USDC");
        emit NativeTrade(
            quote.accountId, msg.sender, quote.pass, false, quote.amountIn, actualUsdc, output
        );
    }

    function _pool(address pass) private view returns (AlphaForgePassPool pool) {
        require(block.chainid == 46630, "TESTNET_ONLY");
        address target = factory.getPool(pass);
        require(target.code.length != 0, "POOL_NOT_LIVE");
        pool = AlphaForgePassPool(target);
        require(
            pool.factory() == address(factory) && pool.pass() == pass && pool.usdc() == usdc
                && pool.initialized(),
            "POOL_IDENTITY"
        );
    }
}
