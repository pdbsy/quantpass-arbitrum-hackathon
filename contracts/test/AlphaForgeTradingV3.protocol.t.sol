// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AlphaForgeTradingVault } from "../src/AlphaForgeTradingVault.sol";
import { AlphaForgeTestStock, AlphaForgeTestReferenceFeed } from "../src/AlphaForgeTestStock.sol";
import { AlphaForgeTestUSDC } from "../src/AlphaForgeTestAsset.sol";
import { StrategyPass } from "../src/StrategyPass.sol";
import { PinnedV3Bytecode } from "./fixtures/PinnedV3Bytecode.sol";

interface ProtocolVm {
    function chainId(uint256 id) external;
    function warp(uint256 timestamp) external;
    function startPrank(address who) external;
    function stopPrank() external;
}

interface ProtocolFactory {
    function createPool(address a, address b, uint24 fee) external returns (address);
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface ProtocolPool {
    function initialize(uint160 price) external;
    function mint(
        address recipient,
        int24 lower,
        int24 upper,
        uint128 liquidity,
        bytes calldata data
    ) external returns (uint256, uint256);
}

interface ProtocolQuoter {
    struct Params {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }
    function quoteExactInputSingle(Params calldata p)
        external
        returns (uint256, uint160, uint32, uint256);
}

/// @notice Real pinned V3 core/router/quoter behavior, executed only inside the local test VM.
contract AlphaForgeTradingV3ProtocolTest {
    ProtocolVm private constant VM =
        ProtocolVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant OWNER = address(0xA11CE);
    address private constant EXECUTOR = address(0xE111);
    address private expectedPool;
    AlphaForgeTestUSDC private usdc;
    address[3] private stocks;
    address[3] private feeds;
    AlphaForgeTradingVault private vault;
    address private router;
    ProtocolQuoter private quoter;

    function _deploy(bytes memory code, bytes memory args) private returns (address deployed) {
        bytes memory init = bytes.concat(code, args);
        assembly { deployed := create(0, add(init, 32), mload(init)) }
        require(deployed != address(0), "official artifact deployment failed");
    }

    function setUp() public {
        VM.chainId(46630);
        VM.warp(1000);
        usdc = new AlphaForgeTestUSDC(1e18, address(this));
        address factory = _deploy(PinnedV3Bytecode.factory(), "");
        // V2, NFT positions and native wrapping are unused in the approved ERC20 single-pool path.
        router = _deploy(
            PinnedV3Bytecode.router(), abi.encode(address(0), factory, address(0), address(0))
        );
        quoter = ProtocolQuoter(_deploy(PinnedV3Bytecode.quoter(), abi.encode(factory, address(0))));
        for (uint8 i; i < 3; ++i) {
            stocks[i] = address(new AlphaForgeTestStock(i, 1e28, address(this)));
            AlphaForgeTestReferenceFeed feed =
                new AlphaForgeTestReferenceFeed(address(this), keccak256(abi.encode(i)));
            feed.update(100e6, 1000, keccak256("local-reference-fixture"));
            feeds[i] = address(feed);
            expectedPool = ProtocolFactory(factory).createPool(address(usdc), stocks[i], 3000);
            require(
                ProtocolFactory(factory).getPool(stocks[i], address(usdc), 3000) == expectedPool,
                "pool identity"
            );
            uint160 q96 = uint160(1 << 96);
            // Includes the 6/18 decimals difference; 100 AF-USDC per stock.
            uint160 sqrtPrice = address(usdc) < stocks[i] ? q96 * 100000 : q96 / 100000;
            ProtocolPool(expectedPool).initialize(sqrtPrice);
            // A large isolated fixture reduces price impact; this is NOT a deployment liquidity default.
            ProtocolPool(expectedPool).mint(address(this), -887220, 887220, 1e19, "");
        }
        expectedPool = address(0);
        bytes32 id = keccak256("ema-three-stock");
        StrategyPass pass = new StrategyPass(
            "AlphaForge Protocol Test Pass", "AF-TEST-PASS", id, 1000 ether, OWNER
        );
        vault = new AlphaForgeTradingVault(
            AlphaForgeTradingVault.Configuration(
                OWNER,
                address(0xC123),
                id,
                keccak256("ema-v1"),
                address(pass),
                address(usdc),
                router,
                stocks,
                feeds,
                30
            )
        );
        usdc.transfer(OWNER, 1000e6);
        VM.startPrank(OWNER);
        usdc.approve(address(vault), 1000e6);
        pass.approve(address(vault), 1000 ether);
        vault.deposit(1000e6);
        vault.allocate(900e6);
        vault.authorizeExecutor(AlphaForgeTradingVault.Grant(EXECUTOR, 1100, 60, 300e6, 900e6, 40));
        VM.stopPrank();
    }

    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == expectedPool && expectedPool != address(0), "callback provenance");
        // Identify the exact fixture pool's tokens, independent of mint caller data.
        (bool ok0, bytes memory data0) = msg.sender.staticcall(abi.encodeWithSignature("token0()"));
        (bool ok1, bytes memory data1) = msg.sender.staticcall(abi.encodeWithSignature("token1()"));
        require(ok0 && ok1, "pool tokens");
        if (amount0 != 0) {
            require(
                IERC20(abi.decode(data0, (address))).transfer(msg.sender, amount0), "token0 payment"
            );
        }
        if (amount1 != 0) {
            require(
                IERC20(abi.decode(data1, (address))).transfer(msg.sender, amount1), "token1 payment"
            );
        }
    }

    function test_ActualThreePoolsQuoteBuyAndStopLiquidationReconcileExactBalances() public {
        for (uint8 i; i < 3; ++i) {
            (uint256 expected,,,) = quoter.quoteExactInputSingle(
                ProtocolQuoter.Params(address(usdc), stocks[i], 100e6, 3000, 0)
            );
            require(expected > 996e15 && expected < 1 ether, "fee or decimal model wrong");
            uint256 version = vault.stateVersion();
            VM.startPrank(EXECUTOR);
            uint256 output = vault.execute(
                AlphaForgeTradingVault.Swap(
                    address(usdc), stocks[i], 100e6, expected, 1030, version
                )
            );
            VM.stopPrank();
            require(
                output == expected && IERC20(stocks[i]).balanceOf(address(vault)) == expected
                    && vault.trackedPosition(stocks[i]) == expected,
                "quote/fill/position mismatch"
            );
            require(usdc.allowance(address(vault), router) == 0, "approval retained");
        }
        VM.startPrank(OWNER);
        vault.stop();
        VM.stopPrank();
        for (uint8 i; i < 3; ++i) {
            uint256 amount = vault.trackedPosition(stocks[i]);
            (uint256 expected,,,) = quoter.quoteExactInputSingle(
                ProtocolQuoter.Params(stocks[i], address(usdc), amount, 3000, 0)
            );
            uint256 beforeCash = vault.runtimeCash();
            uint256 version = vault.stateVersion();
            VM.startPrank(EXECUTOR);
            uint256 output = vault.execute(
                AlphaForgeTradingVault.Swap(
                    stocks[i], address(usdc), amount, expected, 1030, version
                )
            );
            VM.stopPrank();
            require(
                output == expected && vault.runtimeCash() == beforeCash + expected
                    && vault.trackedPosition(stocks[i]) == 0,
                "sell reconciliation"
            );
            require(
                IERC20(stocks[i]).allowance(address(vault), router) == 0, "sell approval retained"
            );
        }
        require(
            vault.openTrackedPositionCount() == 0 && vault.runtimeCash() < 900e6, "fees disappeared"
        );
        VM.startPrank(OWNER);
        vault.close();
        VM.stopPrank();
        require(vault.closed(), "loss close blocked");
    }
}
