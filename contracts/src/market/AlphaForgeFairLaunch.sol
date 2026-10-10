// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { MarketTypes } from "./MarketTypes.sol";
import { AlphaForgePassFactory } from "./AlphaForgePassFactory.sol";
import { AlphaForgePassPool } from "./AlphaForgePassPool.sol";
import {
    AlphaForgeNativeReserve,
    INativeMarketRouterIdentity
} from "./AlphaForgeNativeReserve.sol";

/// @notice Final TSLA subscription atomically creates and funds the shared secondary market.
/// @dev No owner call, proceeds conversion, or additional signature is needed after sellout.
contract AlphaForgeFairLaunch is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant TOTAL_SUPPLY = 1_000_000 ether;
    uint256 public constant PUBLIC_SUPPLY = 500_000 ether;
    uint256 public constant LP_PASS = 500_000 ether;
    uint256 public constant LP_USDC = 250_000e6;
    address public constant PROCEEDS_RECIPIENT = 0x86767116cd40bf6b4f8cf88E08D11E38B04364Cf;
    enum State {
        PREPARING,
        MINTING,
        SOLD_OUT,
        LAUNCHED
    }

    struct Configuration {
        address owner;
        address pass;
        address usdc;
        address factory;
        address conversionReserve;
        address lpRecipient;
    }
    address public immutable owner;
    address public immutable pass;
    address public immutable usdc;
    AlphaForgePassFactory public immutable factory;
    AlphaForgeNativeReserve public immutable conversionReserve;
    address public immutable lpRecipient;
    State public state;
    uint256 public sold;
    address public pool;
    uint256 public lpShares;
    event MintOpened(
        uint256 publicInventory, uint256 lpPass, uint256 lpUsdc, address indexed lpRecipient
    );
    event Subscription(
        address indexed payer,
        uint256 passAmount,
        uint256 usdcAmount,
        uint256 ethAmount,
        uint256 totalSold
    );
    event SoldOut(uint256 totalSold);
    event Launch(
        address indexed pool,
        address indexed lpRecipient,
        uint256 passAmount,
        uint256 usdcAmount,
        uint256 lpShares
    );

    constructor(Configuration memory c) {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(
            c.owner != address(0) && c.pass.code.length != 0 && c.usdc.code.length != 0
                && c.factory.code.length != 0 && c.conversionReserve.code.length != 0,
            "IDENTITY"
        );
        require(
            c.lpRecipient != address(0) && c.lpRecipient != address(this)
                && c.lpRecipient != c.factory && c.lpRecipient != c.conversionReserve,
            "EXPLICIT_LP_RECIPIENT"
        );
        require(
            c.pass != c.usdc && IERC20Metadata(c.pass).decimals() == 18
                && IERC20(c.pass).totalSupply() == TOTAL_SUPPLY
                && IERC20Metadata(c.usdc).decimals() == 6,
            "TOKEN_IDENTITY"
        );
        require(
            AlphaForgePassFactory(c.factory).usdc() == c.usdc
                && AlphaForgeNativeReserve(c.conversionReserve).usdc() == c.usdc,
            "USDC_IDENTITY"
        );
        owner = c.owner;
        pass = c.pass;
        usdc = c.usdc;
        factory = AlphaForgePassFactory(c.factory);
        conversionReserve = AlphaForgeNativeReserve(c.conversionReserve);
        lpRecipient = c.lpRecipient;
    }

    function remaining() external view returns (uint256) {
        return PUBLIC_SUPPLY - sold;
    }

    function mintCost(uint256 passAmount) public pure returns (uint256) {
        require(passAmount != 0 && passAmount % 2e12 == 0, "MINT_PRECISION");
        return passAmount / 2e12;
    }

    function openMint() external {
        require(
            block.chainid == 46630 && msg.sender == owner && state == State.PREPARING,
            "OWNER_OPEN_ONCE"
        );
        require(
            factory.initializer(pass) == address(this) && factory.getPool(pass) == address(0),
            "FACTORY_READY"
        );
        require(
            IERC20(pass).balanceOf(address(this)) >= TOTAL_SUPPLY
                && IERC20(usdc).balanceOf(address(this)) >= LP_USDC,
            "LP_PREFUND_REQUIRED"
        );
        require(
            conversionReserve.authorizedRouter(address(this)) && conversionReserve.ready(),
            "CONVERSION_NOT_READY"
        );
        require(
            INativeMarketRouterIdentity(conversionReserve.tradingRouter()).factory()
                == address(factory),
            "TRADING_FACTORY_IDENTITY"
        );
        state = State.MINTING;
        emit MintOpened(PUBLIC_SUPPLY, LP_PASS, LP_USDC, lpRecipient);
    }

    function subscribeUsdc(uint256 passAmount, uint64 deadline) external nonReentrant {
        _validate(passAmount, deadline);
        uint256 cost = mintCost(passAmount);
        uint256 beforeBalance = IERC20(usdc).balanceOf(PROCEEDS_RECIPIENT);
        IERC20(usdc).safeTransferFrom(msg.sender, PROCEEDS_RECIPIENT, cost);
        require(
            IERC20(usdc).balanceOf(PROCEEDS_RECIPIENT) - beforeBalance == cost, "PAYMENT_MISMATCH"
        );
        _deliver(passAmount, cost, 0);
    }

    function subscribeEth(
        uint256 passAmount,
        MarketTypes.NativeQuote calldata quote,
        bytes calldata signature
    ) external payable nonReentrant {
        _validate(passAmount, quote.deadline);
        require(
            quote.pass == pass && quote.router == address(this) && quote.payer == msg.sender
                && msg.value == quote.ethAmount,
            "NATIVE_PAYMENT"
        );
        conversionReserve.consumeMintQuote(quote, signature, msg.sender, passAmount);
        Address.sendValue(payable(PROCEEDS_RECIPIENT), msg.value);
        _deliver(passAmount, mintCost(passAmount), msg.value);
    }

    function _validate(uint256 passAmount, uint64 deadline) private view {
        require(
            block.chainid == 46630 && state == State.MINTING && block.timestamp <= deadline,
            "MINT_CLOSED_OR_EXPIRED"
        );
        mintCost(passAmount);
        require(passAmount <= PUBLIC_SUPPLY - sold, "OVERSELL");
        require(msg.sender != address(this), "BUYER");
    }

    function _deliver(uint256 passAmount, uint256 cost, uint256 nativeAmount) private {
        sold += passAmount;
        uint256 beforeBalance = IERC20(pass).balanceOf(msg.sender);
        uint256 ownBalance = IERC20(pass).balanceOf(address(this));
        IERC20(pass).safeTransfer(msg.sender, passAmount);
        require(
            IERC20(pass).balanceOf(msg.sender) - beforeBalance == passAmount
                && ownBalance - IERC20(pass).balanceOf(address(this)) == passAmount,
            "DELIVERY_MISMATCH"
        );
        emit Subscription(msg.sender, passAmount, cost, nativeAmount, sold);
        if (sold == PUBLIC_SUPPLY) _launch();
    }

    function _launch() private {
        state = State.SOLD_OUT;
        emit SoldOut(sold);
        IERC20(pass).forceApprove(address(factory), LP_PASS);
        IERC20(usdc).forceApprove(address(factory), LP_USDC);
        (pool, lpShares) = factory.createPool(pass, lpRecipient);
        IERC20(pass).forceApprove(address(factory), 0);
        IERC20(usdc).forceApprove(address(factory), 0);
        AlphaForgePassPool market = AlphaForgePassPool(pool);
        (uint256 actualPass, uint256 actualUsdc) = market.getReserves();
        require(
            market.initialized() && actualPass == LP_PASS && actualUsdc == LP_USDC
                && market.balanceOf(lpRecipient) == lpShares && lpShares != 0
                && market.initialLpRecipient() == lpRecipient,
            "LAUNCH_VALIDATION"
        );
        state = State.LAUNCHED;
        emit Launch(pool, lpRecipient, actualPass, actualUsdc, lpShares);
    }
}
