// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { PassLocker } from "./PassLocker.sol";
import { StrategyPass } from "./StrategyPass.sol";
import { IAlphaForgeReferenceFeed } from "./AlphaForgeTestStock.sol";
import { ISinglePoolRouter02 } from "./interfaces/ISinglePoolRouter02.sol";

/// @notice Testnet-only, owner-controlled three-stock custody and bounded V3 execution.
/// @dev Separate ABI from phase-one Vault. Router and asset identities cannot be changed.
contract AlphaForgeTradingVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Configuration {
        address owner;
        address strategyCreator;
        bytes32 strategyId;
        bytes32 strategyRef;
        address pass;
        address usdc;
        address router;
        address[3] stocks;
        address[3] feeds;
        uint32 maxPriceAge;
    }

    struct Grant {
        address executor;
        uint64 expiresAt;
        uint32 liquidationWindow;
        uint256 maxOrderUsdc;
        uint256 maxTotalBuyUsdc;
        uint16 maxSlippageBps;
    }

    struct Swap {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint64 deadline;
        uint256 expectedVersion;
    }
    address public immutable owner;
    address public immutable strategyCreator;
    bytes32 public immutable strategyId;
    bytes32 public immutable strategyRef;
    address public immutable pass;
    address public immutable afUsdc;
    address public immutable router;
    address public immutable passLocker;
    uint32 public immutable maxPriceAge;
    address[3] public stocks;
    address[3] public feeds;
    Grant public grant;
    uint256 public grantVersion;
    uint256 public stateVersion;
    uint256 public principalBasis;
    uint256 public idleCash;
    uint256 public runtimeCash;
    uint256 public runtimeUnits;
    uint256 public totalBuyUsdc;
    mapping(address => uint256) public trackedPosition;
    uint256 public openTrackedPositionCount;
    bool public closed;
    bool public liquidating;
    uint64 public liquidationUntil;
    uint256 public lowerUnitNav;
    uint256 public upperUnitNav;
    uint256[3] public lowerPrice;
    uint256[3] public upperPrice;

    error InvalidConfiguration();
    error Unauthorized();
    error InvalidState();
    error InvalidAmount();
    error StalePrice();
    error UnsupportedRoute();
    error RiskLimit();
    error TransferMismatch();
    event Deposited(uint256 amountUsdc, uint256 principalBasis, uint256 lockedPass);
    event CapitalChanged(bool allocated, uint256 amountUsdc, uint256 units, uint256 stateVersion);
    event Withdrawn(uint256 amountUsdc, uint256 principalExited, uint256 principalBasis);
    event GrantAuthorized(uint256 indexed grantVersion, address indexed executor, uint64 expiresAt);
    event LiquidationStarted(uint64 until, uint256 stateVersion);
    event RiskOrderCancelled(uint256 indexed stateVersion);
    event SwapExecuted(
        uint256 indexed stateVersion,
        uint256 indexed grantVersion,
        address indexed stock,
        bool buy,
        uint256 input,
        uint256 output
    );
    event BoundsChanged(uint256 stateVersion);
    event Closed(uint256 returnedUsdc, uint256 unlockedPass);
    event DustRescued(address indexed token, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    modifier active() {
        if (closed || block.chainid != 46630) revert InvalidState();
        _;
    }

    constructor(Configuration memory c) {
        if (
            block.chainid != 46630 || c.owner == address(0) || c.strategyCreator == address(0)
                || c.strategyId == bytes32(0) || c.strategyRef == bytes32(0) || c.maxPriceAge == 0
                || c.router.code.length == 0
        ) revert InvalidConfiguration();
        if (
            c.pass == c.usdc || IERC20Metadata(c.pass).decimals() != 18
                || IERC20Metadata(c.usdc).decimals() != 6
                || StrategyPass(c.pass).strategyId() != c.strategyId
        ) revert InvalidConfiguration();
        _verifyStock(c, 0);
        _verifyStock(c, 1);
        _verifyStock(c, 2);
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < i; ++j) {
                if (c.stocks[j] == c.stocks[i] || c.feeds[j] == c.feeds[i]) {
                    revert InvalidConfiguration();
                }
            }
        }
        owner = c.owner;
        strategyCreator = c.strategyCreator;
        strategyId = c.strategyId;
        strategyRef = c.strategyRef;
        pass = c.pass;
        afUsdc = c.usdc;
        router = c.router;
        maxPriceAge = c.maxPriceAge;
        stocks = c.stocks;
        feeds = c.feeds;
        passLocker = address(new PassLocker(address(this), c.owner, IERC20(c.pass)));
    }
    receive() external payable { }

    function usdcToPassRaw(uint256 raw) public pure returns (uint256) {
        return raw * 1e12;
    }

    function passToUsdcRaw(uint256 raw) external pure returns (uint256) {
        if (raw % 1e12 != 0) revert InvalidAmount();
        return raw / 1e12;
    }

    function deposit(uint256 amount) external onlyOwner active nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 passAmount = usdcToPassRaw(amount);
        principalBasis += amount;
        idleCash += amount;
        ++stateVersion;
        _pull(afUsdc, address(this), amount);
        _pull(pass, passLocker, passAmount);
        PassLocker(passLocker).lock(passAmount);
        emit Deposited(amount, principalBasis, PassLocker(passLocker).lockedBalance());
    }

    function allocate(uint256 amount) external onlyOwner active nonReentrant {
        if (amount == 0 || amount > idleCash || liquidating) revert InvalidAmount();
        uint256 equity = runtimeEquity();
        uint256 units =
            runtimeUnits == 0 ? amount * 1e12 : Math.mulDiv(amount, runtimeUnits, equity);
        if (units == 0) revert InvalidAmount();
        idleCash -= amount;
        runtimeCash += amount;
        runtimeUnits += units;
        ++stateVersion;
        emit CapitalChanged(true, amount, units, stateVersion);
    }

    function deallocate(uint256 amount) external onlyOwner active nonReentrant {
        if (amount == 0 || amount > runtimeCash) revert InvalidAmount();
        uint256 equity = runtimeEquity();
        uint256 units = Math.mulDiv(amount, runtimeUnits, equity, Math.Rounding.Ceil);
        if (
            units == 0
                || (units == runtimeUnits
                    && (openTrackedPositionCount != 0 || amount != runtimeCash))
        ) revert InvalidAmount();
        runtimeCash -= amount;
        idleCash += amount;
        runtimeUnits -= units;
        ++stateVersion;
        emit CapitalChanged(false, amount, units, stateVersion);
    }

    function realizedProfit() public view returns (uint256) {
        uint256 cash = idleCash + runtimeCash;
        return cash > principalBasis ? cash - principalBasis : 0;
    }

    function withdraw(uint256 amount) external onlyOwner active nonReentrant {
        if (amount == 0 || amount > idleCash) revert InvalidAmount();
        uint256 profit = realizedProfit();
        uint256 exited = amount > profit ? amount - profit : 0;
        if (exited != 0 && openTrackedPositionCount != 0) revert InvalidState();
        idleCash -= amount;
        principalBasis -= exited;
        ++stateVersion;
        _send(afUsdc, amount);
        if (exited != 0) PassLocker(passLocker).unlock(usdcToPassRaw(exited));
        emit Withdrawn(amount, exited, principalBasis);
    }

    function authorizeExecutor(Grant calldata next) external onlyOwner active nonReentrant {
        if (
            next.executor == address(0) || next.executor == owner
                || next.expiresAt <= block.timestamp || next.liquidationWindow == 0
                || next.maxOrderUsdc == 0 || next.maxTotalBuyUsdc == 0
                || next.maxSlippageBps >= 10000 || runtimeUnits == 0
                || (liquidating && openTrackedPositionCount != 0)
        ) revert InvalidConfiguration();
        grant = next;
        totalBuyUsdc = 0;
        liquidating = false;
        liquidationUntil = 0;
        ++grantVersion;
        ++stateVersion;
        emit GrantAuthorized(grantVersion, next.executor, next.expiresAt);
    }

    function revokeExecutor() external onlyOwner active nonReentrant {
        grant.executor = address(0);
        ++stateVersion;
        _beginLiquidation();
    }

    function stop() external onlyOwner active nonReentrant {
        _beginLiquidation();
    }

    function setBounds(
        uint256 lower,
        uint256 upper,
        uint256[3] calldata priceLower,
        uint256[3] calldata priceUpper
    ) external onlyOwner active nonReentrant {
        if (lower != 0 && upper != 0 && lower >= upper) {
            revert InvalidConfiguration();
        }
        for (uint256 i; i < 3; ++i) {
            if (priceLower[i] != 0 && priceUpper[i] != 0 && priceLower[i] >= priceUpper[i]) {
                revert InvalidConfiguration();
            }
        }
        lowerUnitNav = lower;
        upperUnitNav = upper;
        lowerPrice = priceLower;
        upperPrice = priceUpper;
        ++stateVersion;
        emit BoundsChanged(stateVersion);
        if (_riskReached()) _beginLiquidation();
    }

    function checkRisk() external active nonReentrant returns (bool) {
        if (
            !liquidating
                && ((grant.executor != address(0) && block.timestamp >= grant.expiresAt)
                    || _riskReached())
        ) _beginLiquidation();
        return liquidating;
    }

    function execute(Swap calldata action) external active nonReentrant returns (uint256 output) {
        Grant memory permission = grant;
        if (msg.sender != owner && msg.sender != permission.executor) revert Unauthorized();
        if (
            action.expectedVersion != stateVersion || action.amountIn == 0
                || action.deadline < block.timestamp
        ) revert InvalidState();
        bool buy = action.tokenIn == afUsdc;
        uint256 index = _stockIndex(buy ? action.tokenOut : action.tokenIn);
        if ((!buy && action.tokenOut != afUsdc) || action.tokenIn == action.tokenOut) {
            revert UnsupportedRoute();
        }
        _validateAuthority(action, buy, permission);
        uint256 price = _price(index);
        if (buy && _riskReached()) {
            _beginLiquidation();
            emit RiskOrderCancelled(stateVersion);
            return 0;
        }
        _validateOrder(action, buy, index, price, permission);
        output = _swap(action);
        uint256 previous = trackedPosition[stocks[index]];
        if (buy) {
            runtimeCash -= action.amountIn;
            totalBuyUsdc += action.amountIn;
            trackedPosition[stocks[index]] = previous + output;
            if (previous == 0) ++openTrackedPositionCount;
            if (Math.mulDiv(trackedPosition[stocks[index]], price, 1e18) * 3 > runtimeEquity()) {
                revert RiskLimit();
            }
        } else {
            runtimeCash += output;
            trackedPosition[stocks[index]] = previous - action.amountIn;
            if (previous == action.amountIn) --openTrackedPositionCount;
        }
        ++stateVersion;
        emit SwapExecuted(stateVersion, grantVersion, stocks[index], buy, action.amountIn, output);
    }

    function _validateAuthority(Swap calldata action, bool buy, Grant memory permission)
        private
        view
    {
        bool expiry = block.timestamp >= permission.expiresAt;
        if (buy && (liquidating || expiry || permission.executor == address(0))) {
            revert InvalidState();
        }
        if (msg.sender != owner) {
            uint256 last = liquidating
                ? liquidationUntil
                : expiry
                    ? uint256(permission.expiresAt) + permission.liquidationWindow
                    : permission.expiresAt;
            if (block.timestamp > last || action.deadline > last) revert Unauthorized();
        }
    }

    function _validateOrder(
        Swap calldata action,
        bool buy,
        uint256 index,
        uint256 price,
        Grant memory permission
    ) private view {
        uint256 notional = buy ? action.amountIn : Math.mulDiv(action.amountIn, price, 1e18);
        if (permission.maxOrderUsdc == 0 || notional > permission.maxOrderUsdc) revert RiskLimit();
        uint256 referenceOutput = buy ? Math.mulDiv(action.amountIn, 1e18, price) : notional;
        uint256 floor = Math.mulDiv(referenceOutput, 10000 - permission.maxSlippageBps, 10000);
        if (action.minAmountOut < floor || (buy && action.minAmountOut == 0)) revert RiskLimit();
        if (buy) {
            if (
                action.amountIn > runtimeCash
                    || totalBuyUsdc + action.amountIn > permission.maxTotalBuyUsdc
                    || (Math.mulDiv(trackedPosition[stocks[index]], price, 1e18) + action.amountIn)
                            * 3 > runtimeEquity()
            ) revert RiskLimit();
        } else if (action.amountIn > trackedPosition[stocks[index]]) {
            revert InvalidAmount();
        }
    }

    function runtimeEquity() public view returns (uint256) {
        return runtimeCash + _positionValue(0) + _positionValue(1) + _positionValue(2);
    }

    function _positionValue(uint256 index) private view returns (uint256) {
        uint256 amount = trackedPosition[stocks[index]];
        return amount == 0 ? 0 : Math.mulDiv(amount, _price(index), 1e18);
    }

    function _verifyStock(Configuration memory c, uint256 i) private view {
        if (
            c.stocks[i] == c.pass || c.stocks[i] == c.usdc || c.stocks[i].code.length == 0
                || c.feeds[i].code.length == 0 || IERC20Metadata(c.stocks[i]).decimals() != 18
        ) revert InvalidConfiguration();
    }

    /// @notice AF-USDC raw units per full risk-accounting unit; initial value 1e6.
    /// @dev Internal units are not transferable shares. Round allocation down, deallocation up.
    function unitNav() public view returns (uint256) {
        return runtimeUnits == 0 ? 0 : Math.mulDiv(runtimeEquity(), 1e18, runtimeUnits);
    }

    function close() external onlyOwner active nonReentrant {
        if (openTrackedPositionCount != 0) revert InvalidState();
        uint256 returned = idleCash + runtimeCash;
        uint256 unlocked = PassLocker(passLocker).lockedBalance();
        idleCash = 0;
        runtimeCash = 0;
        runtimeUnits = 0;
        principalBasis = 0;
        closed = true;
        grant.executor = address(0);
        ++stateVersion;
        if (returned != 0) _send(afUsdc, returned);
        if (unlocked != 0) unlocked = PassLocker(passLocker).releaseAll();
        emit Closed(returned, unlocked);
    }

    function rescueUntrackedToken(address token) external onlyOwner nonReentrant {
        if (!closed || token == address(0)) revert InvalidState();
        uint256 rescuedPass = token == pass ? PassLocker(passLocker).rescueUntrackedPass() : 0;
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount != 0) _send(token, amount);
        amount += rescuedPass;
        emit DustRescued(token, amount);
    }

    function rescueNative() external onlyOwner nonReentrant {
        if (!closed) revert InvalidState();
        uint256 amount = address(this).balance;
        Address.sendValue(payable(owner), amount);
        emit DustRescued(address(0), amount);
    }

    function _beginLiquidation() private {
        if (liquidating) return;
        liquidating = true;
        uint256 until = block.timestamp + grant.liquidationWindow;
        uint256 expiryUntil = uint256(grant.expiresAt) + grant.liquidationWindow;
        if (until > expiryUntil) until = expiryUntil;
        liquidationUntil = uint64(until);
        ++stateVersion;
        emit LiquidationStarted(liquidationUntil, stateVersion);
    }

    function _riskReached() private view returns (bool) {
        if (runtimeUnits == 0) return false;
        uint256 nav = unitNav();
        if (
            (lowerUnitNav != 0 && nav <= lowerUnitNav) || (upperUnitNav != 0 && nav >= upperUnitNav)
        ) return true;
        return _assetBoundHit(0) || _assetBoundHit(1) || _assetBoundHit(2);
    }

    function _assetBoundHit(uint256 i) private view returns (bool) {
        if (trackedPosition[stocks[i]] == 0 || (lowerPrice[i] == 0 && upperPrice[i] == 0)) {
            return false;
        }
        uint256 quote = _price(i);
        return (lowerPrice[i] != 0 && quote <= lowerPrice[i])
            || (upperPrice[i] != 0 && quote >= upperPrice[i]);
    }

    function _stockIndex(address token) private view returns (uint256) {
        for (uint256 i; i < 3; ++i) {
            if (stocks[i] == token) return i;
        }
        revert UnsupportedRoute();
    }

    function _price(uint256 index) private view returns (uint256 quote) {
        uint64 observedAt;
        bytes32 digest;
        (quote, observedAt, digest) = IAlphaForgeReferenceFeed(feeds[index]).price();
        if (
            quote == 0 || digest == bytes32(0) || observedAt > block.timestamp
                || block.timestamp - observedAt > maxPriceAge
        ) revert StalePrice();
    }

    function _swap(Swap calldata action) private returns (uint256 output) {
        uint256 beforeInput = IERC20(action.tokenIn).balanceOf(address(this));
        uint256 beforeOutput = IERC20(action.tokenOut).balanceOf(address(this));
        if (
            beforeInput
                < (action.tokenIn == afUsdc
                        ? idleCash + runtimeCash
                        : trackedPosition[action.tokenIn])
        ) revert TransferMismatch();
        IERC20(action.tokenIn).forceApprove(router, action.amountIn);
        output = ISinglePoolRouter02(router)
            .exactInputSingle(
                ISinglePoolRouter02.ExactInputSingleParams(
                    action.tokenIn,
                    action.tokenOut,
                    3000,
                    address(this),
                    action.amountIn,
                    action.minAmountOut,
                    0
                )
            );
        IERC20(action.tokenIn).forceApprove(router, 0);
        uint256 afterInput = IERC20(action.tokenIn).balanceOf(address(this));
        uint256 afterOutput = IERC20(action.tokenOut).balanceOf(address(this));
        if (
            afterInput > beforeInput || beforeInput - afterInput != action.amountIn
                || afterOutput < beforeOutput || afterOutput - beforeOutput != output
                || output < action.minAmountOut || (action.tokenIn == afUsdc && output == 0)
        ) revert TransferMismatch();
    }

    function _pull(address token, address recipient, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(recipient);
        IERC20(token).safeTransferFrom(msg.sender, recipient, amount);
        if (IERC20(token).balanceOf(recipient) - beforeBalance != amount) {
            revert TransferMismatch();
        }
    }

    function _send(address token, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(owner);
        IERC20(token).safeTransfer(owner, amount);
        if (IERC20(token).balanceOf(owner) - beforeBalance != amount) revert TransferMismatch();
    }
}
