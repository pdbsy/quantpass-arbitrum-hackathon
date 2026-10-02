// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISeederFactory {
    function getPool(address, address, uint24) external view returns (address);
}

interface ISeederPool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function mint(address, int24, int24, uint128, bytes calldata)
        external
        returns (uint256, uint256);
    function burn(int24, int24, uint128) external returns (uint256, uint256);
    function collect(address, int24, int24, uint128, uint128) external returns (uint128, uint128);
}

/// @notice Testnet operator LP only; never holds user Vault capital or grants.
contract AlphaForgeLiquiditySeeder is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable owner;
    address public immutable factory;
    address public immutable usdc;
    address[3] public stocks;

    constructor(address owner_, address factory_, address usdc_, address[3] memory stocks_) {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(
            owner_ != address(0) && factory_.code.length != 0 && usdc_.code.length != 0, "IDENTITY"
        );
        require(IERC20Metadata(usdc_).decimals() == 6, "USDC_DECIMALS");
        for (uint256 i; i < 3; ++i) {
            require(stocks_[i] != usdc_ && stocks_[i].code.length != 0, "STOCK_IDENTITY");
            for (uint256 j; j < i; ++j) {
                require(stocks_[j] != stocks_[i], "DUPLICATE_STOCK");
            }
        }
        require(
            IERC20Metadata(stocks_[0]).decimals() == 18
                && IERC20Metadata(stocks_[1]).decimals() == 18
                && IERC20Metadata(stocks_[2]).decimals() == 18,
            "STOCK_DECIMALS"
        );
        owner = owner_;
        factory = factory_;
        usdc = usdc_;
        stocks = stocks_;
    }

    function _pool(address stock) private view returns (ISeederPool pool) {
        require(stock == stocks[0] || stock == stocks[1] || stock == stocks[2], "UNSUPPORTED_STOCK");
        address target = ISeederFactory(factory).getPool(usdc, stock, 3000);
        require(target.code.length != 0, "POOL_MISSING");
        pool = ISeederPool(target);
        require(pool.factory() == factory && pool.fee() == 3000, "POOL_IDENTITY");
        require(
            pool.token0() == (usdc < stock ? usdc : stock)
                && pool.token1() == (usdc < stock ? stock : usdc),
            "POOL_TOKENS"
        );
    }

    function seed(
        address stock,
        int24 lower,
        int24 upper,
        uint128 liquidity,
        uint256 maxUsdc,
        uint256 maxStock
    ) external nonReentrant returns (uint256 paidUsdc, uint256 paidStock) {
        require(msg.sender == owner, "OWNER_REQUIRED");
        require(
            lower >= -887220 && upper <= 887220 && lower < upper && lower % 60 == 0
                && upper % 60 == 0,
            "TICKS"
        );
        require(liquidity != 0 && maxUsdc != 0 && maxStock != 0, "BUDGET");
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), maxUsdc);
        IERC20(stock).safeTransferFrom(msg.sender, address(this), maxStock);
        (uint256 amount0, uint256 amount1) = _pool(stock)
            .mint(address(this), lower, upper, liquidity, abi.encode(stock, maxUsdc, maxStock));
        (paidUsdc, paidStock) = usdc < stock ? (amount0, amount1) : (amount1, amount0);
        require(paidUsdc <= maxUsdc && paidStock <= maxStock, "BUDGET_EXCEEDED");
        if (maxUsdc > paidUsdc) IERC20(usdc).safeTransfer(owner, maxUsdc - paidUsdc);
        if (maxStock > paidStock) IERC20(stock).safeTransfer(owner, maxStock - paidStock);
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata data) external {
        require(_reentrancyGuardEntered() && data.length == 96, "CALLBACK_OUTSIDE_OPERATION");
        (address stock, uint256 maxUsdc, uint256 maxStock) =
            abi.decode(data, (address, uint256, uint256));
        require(keccak256(data) == keccak256(abi.encode(stock, maxUsdc, maxStock)), "CALLBACK_DATA");
        require(msg.sender == address(_pool(stock)), "CALLBACK_POOL");
        (uint256 amountUsdc, uint256 amountStock) =
            usdc < stock ? (amount0, amount1) : (amount1, amount0);
        require(amountUsdc <= maxUsdc && amountStock <= maxStock, "BUDGET_EXCEEDED");
        if (amountUsdc != 0) IERC20(usdc).safeTransfer(msg.sender, amountUsdc);
        if (amountStock != 0) IERC20(stock).safeTransfer(msg.sender, amountStock);
    }

    function remove(address stock, int24 lower, int24 upper, uint128 liquidity)
        external
        nonReentrant
        returns (uint128 received0, uint128 received1)
    {
        require(msg.sender == owner && liquidity != 0, "OWNER_LIQUIDITY_REQUIRED");
        ISeederPool pool = _pool(stock);
        (uint256 owed0, uint256 owed1) = pool.burn(lower, upper, liquidity);
        (received0, received1) =
            pool.collect(owner, lower, upper, type(uint128).max, type(uint128).max);
        require(received0 >= owed0 && received1 >= owed1, "INCOMPLETE_REMOVAL");
    }
}
