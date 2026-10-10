// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MarketTypes } from "./MarketTypes.sol";

interface INativeMarketRouterIdentity {
    function reserve() external view returns (address);
    function usdc() external view returns (address);
    function factory() external view returns (address);
}

/// @notice Independently funded native test ETH / AF-USDC reserve; no user Vault custody.
contract AlphaForgeNativeReserve is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "NativeQuote(address router,address payer,bytes32 accountId,uint8 operation,address pass,uint256 amountIn,uint256 usdcAmount,uint256 minOut,uint256 ethAmount,uint256 ethUsdPrice,uint256 nonce,uint64 issuedAt,uint64 deadline,uint64 epoch)"
    );
    uint64 public constant MAX_QUOTE_AGE = 60;
    address public immutable owner;
    address public immutable usdc;
    address public quoteSigner;
    uint64 public quoteEpoch = 1;
    uint16 public immutable conversionFeeBps;
    bool public ethInputPaused;
    bool public ethOutputPaused;
    mapping(address => bool) public authorizedRouter;
    address public tradingRouter;
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonce;
    mapping(bytes32 => mapping(uint256 => uint256)) public accountDaySpent;
    mapping(uint256 => uint256) public globalDaySpent;

    struct RiskLimits {
        uint256 perTransaction;
        uint256 perAccountDaily;
        uint256 globalDaily;
        uint256 minNativeReserve;
    }
    RiskLimits public limits;

    event ReserveFunded(address indexed funder, bool nativeAsset, uint256 amount);
    event ReserveWithdrawn(address indexed recipient, bool nativeAsset, uint256 amount);
    event RouterAuthorized(address indexed router);
    event TradingRouterConfigured(address indexed router);
    event OracleChanged(address indexed signer, uint64 epoch);
    event ConversionPaused(bool ethInputPaused, bool ethOutputPaused);
    event LimitsChanged(
        uint256 perTransaction,
        uint256 perAccountDaily,
        uint256 globalDaily,
        uint256 minNativeReserve
    );
    event Conversion(
        bytes32 indexed accountId,
        address indexed payer,
        uint8 indexed operation,
        uint256 usdcAmount,
        uint256 ethAmount,
        uint256 fee
    );
    event QuoteConsumed(
        bytes32 indexed accountId, uint256 indexed nonce, address indexed router, uint8 operation
    );

    constructor(
        address owner_,
        address usdc_,
        address quoteSigner_,
        uint16 feeBps_,
        RiskLimits memory limits_
    ) EIP712("AlphaForge Native Conversion", "1") {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(
            owner_ != address(0) && quoteSigner_ != address(0) && usdc_.code.length != 0
                && IERC20Metadata(usdc_).decimals() == 6 && feeBps_ <= 500,
            "CONFIGURATION"
        );
        owner = owner_;
        usdc = usdc_;
        quoteSigner = quoteSigner_;
        conversionFeeBps = feeBps_;
        _setLimits(limits_);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_REQUIRED");
        _;
    }

    function authorizeRouter(address router) external onlyOwner {
        require(router.code.length != 0 && !authorizedRouter[router], "ROUTER_ONCE");
        authorizedRouter[router] = true;
        emit RouterAuthorized(router);
    }

    function configureTradingRouter(address router) external onlyOwner {
        require(
            tradingRouter == address(0) && router.code.length != 0 && authorizedRouter[router],
            "TRADING_ROUTER_ONCE"
        );
        require(
            INativeMarketRouterIdentity(router).reserve() == address(this)
                && INativeMarketRouterIdentity(router).usdc() == usdc,
            "TRADING_ROUTER_IDENTITY"
        );
        tradingRouter = router;
        emit TradingRouterConfigured(router);
    }

    function setQuoteSigner(address signer_) external onlyOwner {
        require(signer_ != address(0), "SIGNER");
        quoteSigner = signer_;
        ++quoteEpoch;
        emit OracleChanged(signer_, quoteEpoch);
    }

    function setPaused(bool inputPaused, bool outputPaused) external onlyOwner {
        ethInputPaused = inputPaused;
        ethOutputPaused = outputPaused;
        emit ConversionPaused(inputPaused, outputPaused);
    }

    function setLimits(RiskLimits calldata next) external onlyOwner {
        _setLimits(next);
    }

    function fundNative() external payable onlyOwner {
        require(msg.value != 0, "AMOUNT");
        emit ReserveFunded(msg.sender, true, msg.value);
    }

    function fundUsdc(uint256 amount) external onlyOwner nonReentrant {
        require(amount != 0, "AMOUNT");
        _pullUsdc(msg.sender, amount);
        emit ReserveFunded(msg.sender, false, amount);
    }

    function withdrawNative(address payable recipient, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        require(
            ethOutputPaused && recipient != address(0) && amount != 0
                && address(this).balance >= amount + limits.minNativeReserve,
            "PAUSED_RESERVE_REQUIRED"
        );
        Address.sendValue(recipient, amount);
        emit ReserveWithdrawn(recipient, true, amount);
    }

    function withdrawUsdc(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(
            ethInputPaused && recipient != address(0) && recipient != address(this) && amount != 0,
            "PAUSED_RESERVE_REQUIRED"
        );
        _sendUsdc(recipient, amount);
        emit ReserveWithdrawn(recipient, false, amount);
    }

    function ready() external view returns (bool) {
        return block.chainid == 46630 && !ethInputPaused && !ethOutputPaused
            && tradingRouter != address(0) && authorizedRouter[tradingRouter]
            && quoteSigner != address(0) && IERC20(usdc).balanceOf(address(this)) != 0
            && address(this).balance >= limits.minNativeReserve + limits.perTransaction;
    }

    function quoteDigest(MarketTypes.NativeQuote calldata quote) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, quote)));
    }

    function nativeToUsdc(uint256 nativeAmount, uint256 price)
        public
        view
        returns (uint256 output, uint256 fee)
    {
        uint256 gross = Math.mulDiv(nativeAmount, price, 1e18);
        fee = Math.mulDiv(gross, conversionFeeBps, 10000, Math.Rounding.Ceil);
        output = gross - fee;
    }

    function usdcToNative(uint256 usdcAmount, uint256 price)
        public
        view
        returns (uint256 output, uint256 fee)
    {
        fee = Math.mulDiv(usdcAmount, conversionFeeBps, 10000, Math.Rounding.Ceil);
        output = Math.mulDiv(usdcAmount - fee, 1e18, price);
    }

    /// @dev Mint payments bypass conversion; this only verifies and consumes the oracle quote.
    function consumeMintQuote(
        MarketTypes.NativeQuote calldata quote,
        bytes calldata signature,
        address payer,
        uint256 passAmount
    ) external nonReentrant {
        require(
            !ethInputPaused && quote.operation == MarketTypes.MINT && quote.payer == payer,
            "MINT_ROUTE"
        );
        require(
            passAmount != 0 && passAmount % 2e12 == 0 && quote.usdcAmount == passAmount / 2e12
                && quote.minOut == passAmount,
            "MINT_AMOUNT"
        );
        require(
            quote.amountIn == quote.ethAmount
                && quote.ethAmount
                    == Math.mulDiv(quote.usdcAmount, 1e18, quote.ethUsdPrice, Math.Rounding.Ceil),
            "MINT_PAYMENT"
        );
        _consume(quote, signature);
    }

    function convertBuy(MarketTypes.NativeQuote calldata quote, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (uint256 output)
    {
        require(
            !ethInputPaused && quote.operation == MarketTypes.BUY && quote.amountIn == msg.value
                && quote.ethAmount == msg.value,
            "BUY_PAYMENT"
        );
        _consume(quote, signature);
        uint256 fee;
        (output, fee) = nativeToUsdc(msg.value, quote.ethUsdPrice);
        require(output != 0 && output == quote.usdcAmount, "CONVERSION_AMOUNT");
        _sendUsdc(msg.sender, output);
        emit Conversion(quote.accountId, quote.payer, MarketTypes.BUY, output, msg.value, fee);
    }

    function convertSell(
        MarketTypes.NativeQuote calldata quote,
        bytes calldata signature,
        uint256 actualUsdc
    ) external nonReentrant returns (uint256 output) {
        require(
            !ethOutputPaused && quote.operation == MarketTypes.SELL
                && actualUsdc >= quote.usdcAmount,
            "SELL_ROUTE"
        );
        _consume(quote, signature);
        uint256 fee;
        (output, fee) = usdcToNative(actualUsdc, quote.ethUsdPrice);
        require(output != 0 && output >= quote.minOut, "SLIPPAGE");
        _spendBudget(quote.accountId, output);
        _pullUsdc(msg.sender, actualUsdc);
        Address.sendValue(payable(quote.payer), output);
        emit Conversion(quote.accountId, quote.payer, MarketTypes.SELL, actualUsdc, output, fee);
    }

    function _consume(MarketTypes.NativeQuote calldata quote, bytes calldata signature) private {
        require(
            block.chainid == 46630 && authorizedRouter[msg.sender] && quote.router == msg.sender,
            "QUOTE_ROUTER"
        );
        require(
            quote.payer != address(0) && quote.accountId != bytes32(0)
                && quote.pass.code.length != 0 && quote.amountIn != 0 && quote.ethAmount != 0
                && quote.usdcAmount != 0 && quote.minOut != 0 && quote.ethUsdPrice != 0,
            "QUOTE_IDENTITY"
        );
        require(
            quote.epoch == quoteEpoch && quote.issuedAt <= block.timestamp
                && block.timestamp - quote.issuedAt <= MAX_QUOTE_AGE
                && quote.deadline >= block.timestamp && quote.deadline >= quote.issuedAt
                && quote.deadline - quote.issuedAt <= MAX_QUOTE_AGE,
            "QUOTE_EXPIRED"
        );
        require(!usedNonce[quote.accountId][quote.nonce], "QUOTE_REPLAY");
        require(MarketTypes.signer(quoteDigest(quote), signature) == quoteSigner, "QUOTE_SIGNATURE");
        usedNonce[quote.accountId][quote.nonce] = true;
        emit QuoteConsumed(quote.accountId, quote.nonce, msg.sender, quote.operation);
    }

    function _spendBudget(bytes32 accountId, uint256 amount) private {
        uint256 day = block.timestamp / 1 days;
        require(
            amount <= limits.perTransaction
                && accountDaySpent[accountId][day] + amount <= limits.perAccountDaily
                && globalDaySpent[day] + amount <= limits.globalDaily,
            "ETH_BUDGET"
        );
        require(address(this).balance >= amount + limits.minNativeReserve, "ETH_LIQUIDITY");
        accountDaySpent[accountId][day] += amount;
        globalDaySpent[day] += amount;
    }

    function _setLimits(RiskLimits memory next) private {
        require(
            next.perTransaction != 0 && next.perTransaction <= next.perAccountDaily
                && next.perAccountDaily <= next.globalDaily && next.minNativeReserve != 0,
            "RISK_LIMITS"
        );
        limits = next;
        emit LimitsChanged(
            next.perTransaction, next.perAccountDaily, next.globalDaily, next.minNativeReserve
        );
    }

    function _pullUsdc(address from, uint256 amount) private {
        uint256 beforeBalance = IERC20(usdc).balanceOf(address(this));
        IERC20(usdc).safeTransferFrom(from, address(this), amount);
        require(
            IERC20(usdc).balanceOf(address(this)) - beforeBalance == amount, "TRANSFER_MISMATCH"
        );
    }

    function _sendUsdc(address to, uint256 amount) private {
        uint256 beforeBalance = IERC20(usdc).balanceOf(to);
        uint256 ownBalance = IERC20(usdc).balanceOf(address(this));
        IERC20(usdc).safeTransfer(to, amount);
        require(
            IERC20(usdc).balanceOf(to) - beforeBalance == amount
                && ownBalance - IERC20(usdc).balanceOf(address(this)) == amount,
            "TRANSFER_MISMATCH"
        );
    }
}
