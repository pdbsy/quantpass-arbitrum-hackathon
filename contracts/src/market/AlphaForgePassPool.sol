// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice One PASS/AF-USDC constant-product market. The 30 bps fee remains with LPs.
/// @dev Initializer owns no LP; shares are delivered only to the explicitly configured recipient.
contract AlphaForgePassPool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;
    address public immutable factory;
    address public immutable pass;
    address public immutable usdc;
    address public immutable initialLpRecipient;
    uint256 public reservePass;
    uint256 public reserveUsdc;
    bool public initialized;

    event LiquidityAdded(
        address indexed recipient, uint256 passAmount, uint256 usdcAmount, uint256 shares
    );
    event LiquidityRemoved(
        address indexed recipient, uint256 passAmount, uint256 usdcAmount, uint256 shares
    );
    event Swap(
        address indexed payer,
        address indexed recipient,
        bool buy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    event Sync(uint256 reservePass, uint256 reserveUsdc);

    constructor(address pass_, address usdc_, address lpRecipient_)
        ERC20("AlphaForge PASS LP", "AF-PASS-LP")
    {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(
            pass_ != usdc_ && pass_.code.length != 0 && usdc_.code.length != 0
                && lpRecipient_ != address(0),
            "IDENTITY"
        );
        factory = msg.sender;
        pass = pass_;
        usdc = usdc_;
        initialLpRecipient = lpRecipient_;
    }

    function initialize(uint256 passAmount, uint256 usdcAmount)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(msg.sender == factory && !initialized, "INITIALIZER_ONLY");
        require(passAmount == 500_000 ether && usdcAmount == 250_000e6, "INITIAL_RESERVES");
        // Donation dust is excluded from authoritative reserves and cannot seize LP ownership.
        require(
            IERC20(pass).balanceOf(address(this)) >= passAmount
                && IERC20(usdc).balanceOf(address(this)) >= usdcAmount,
            "FUNDING"
        );
        initialized = true;
        reservePass = passAmount;
        reserveUsdc = usdcAmount;
        shares = Math.sqrt(passAmount * usdcAmount);
        _mint(initialLpRecipient, shares);
        emit LiquidityAdded(initialLpRecipient, passAmount, usdcAmount, shares);
        emit Sync(reservePass, reserveUsdc);
    }

    function getReserves() external view returns (uint256 passAmount, uint256 usdcAmount) {
        return (reservePass, reserveUsdc);
    }

    function quoteBuy(uint256 amount) public view returns (uint256 output, uint256 fee) {
        return _quote(reserveUsdc, reservePass, amount);
    }

    function quoteSell(uint256 amount) public view returns (uint256 output, uint256 fee) {
        return _quote(reservePass, reserveUsdc, amount);
    }

    function buy(uint256 amount, uint256 minOut, address recipient, uint64 deadline)
        external
        nonReentrant
        returns (uint256 output)
    {
        _validate(recipient, deadline);
        uint256 fee;
        (output, fee) = quoteBuy(amount);
        require(output >= minOut && minOut != 0, "SLIPPAGE");
        reserveUsdc += amount;
        reservePass -= output;
        _pull(usdc, amount);
        _send(pass, recipient, output);
        emit Swap(msg.sender, recipient, true, amount, output, fee);
        emit Sync(reservePass, reserveUsdc);
    }

    function sell(uint256 amount, uint256 minOut, address recipient, uint64 deadline)
        external
        nonReentrant
        returns (uint256 output)
    {
        _validate(recipient, deadline);
        uint256 fee;
        (output, fee) = quoteSell(amount);
        require(output >= minOut && minOut != 0, "SLIPPAGE");
        reservePass += amount;
        reserveUsdc -= output;
        _pull(pass, amount);
        _send(usdc, recipient, output);
        emit Swap(msg.sender, recipient, false, amount, output, fee);
        emit Sync(reservePass, reserveUsdc);
    }

    function addLiquidity(
        uint256 shares,
        uint256 maxPass,
        uint256 maxUsdc,
        address recipient,
        uint64 deadline
    ) external nonReentrant returns (uint256 passAmount, uint256 usdcAmount) {
        _validate(recipient, deadline);
        require(shares != 0 && totalSupply() != 0, "SHARES");
        passAmount = Math.mulDiv(shares, reservePass, totalSupply(), Math.Rounding.Ceil);
        usdcAmount = Math.mulDiv(shares, reserveUsdc, totalSupply(), Math.Rounding.Ceil);
        require(passAmount <= maxPass && usdcAmount <= maxUsdc, "BUDGET");
        reservePass += passAmount;
        reserveUsdc += usdcAmount;
        _pull(pass, passAmount);
        _pull(usdc, usdcAmount);
        _mint(recipient, shares);
        emit LiquidityAdded(recipient, passAmount, usdcAmount, shares);
        emit Sync(reservePass, reserveUsdc);
    }

    function removeLiquidity(
        uint256 shares,
        uint256 minPass,
        uint256 minUsdc,
        address recipient,
        uint64 deadline
    ) external nonReentrant returns (uint256 passAmount, uint256 usdcAmount) {
        _validate(recipient, deadline);
        require(shares != 0 && shares < totalSupply(), "SHARES");
        passAmount = Math.mulDiv(shares, reservePass, totalSupply());
        usdcAmount = Math.mulDiv(shares, reserveUsdc, totalSupply());
        require(passAmount >= minPass && usdcAmount >= minUsdc, "SLIPPAGE");
        _burn(msg.sender, shares);
        reservePass -= passAmount;
        reserveUsdc -= usdcAmount;
        _send(pass, recipient, passAmount);
        _send(usdc, recipient, usdcAmount);
        emit LiquidityRemoved(recipient, passAmount, usdcAmount, shares);
        emit Sync(reservePass, reserveUsdc);
    }

    function _quote(uint256 reserveIn, uint256 reserveOut, uint256 amount)
        private
        view
        returns (uint256 output, uint256 fee)
    {
        require(initialized && amount != 0 && reserveIn != 0 && reserveOut != 0, "LIQUIDITY");
        // Round fee upwards to avoid fee-free tiny swaps; positive output remains mandatory.
        fee = Math.mulDiv(amount, FEE_BPS, 10000, Math.Rounding.Ceil);
        uint256 net = amount - fee;
        output = Math.mulDiv(reserveOut, net, reserveIn + net);
        require(output != 0 && output < reserveOut, "ZERO_OUTPUT");
    }

    function _validate(address recipient, uint64 deadline) private view {
        require(
            block.chainid == 46630 && initialized && block.timestamp <= deadline,
            "NOT_LIVE_OR_EXPIRED"
        );
        require(recipient != address(0) && recipient != address(this), "RECIPIENT");
        require(
            IERC20(pass).balanceOf(address(this)) >= reservePass
                && IERC20(usdc).balanceOf(address(this)) >= reserveUsdc,
            "RESERVE_DEFICIT"
        );
    }

    function _pull(address token, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        require(
            IERC20(token).balanceOf(address(this)) - beforeBalance == amount, "TRANSFER_MISMATCH"
        );
    }

    function _send(address token, address recipient, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(recipient);
        uint256 ownBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(recipient, amount);
        require(
            IERC20(token).balanceOf(recipient) - beforeBalance == amount
                && ownBalance - IERC20(token).balanceOf(address(this)) == amount,
            "TRANSFER_MISMATCH"
        );
    }
}
