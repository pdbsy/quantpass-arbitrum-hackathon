// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AlphaForgeTestUSDC } from "../src/AlphaForgeTestAsset.sol";
import { AlphaForgeTestStock } from "../src/AlphaForgeTestStock.sol";
import { AlphaForgeLiquiditySeeder } from "../src/AlphaForgeLiquiditySeeder.sol";
import { PinnedV3Bytecode } from "./fixtures/PinnedV3Bytecode.sol";

interface SeederVm {
    function chainId(uint256) external;
    function prank(address) external;
}

interface SeederFactory {
    function createPool(address, address, uint24) external returns (address);
}

interface SeederPool {
    function initialize(uint160) external;
}

/// @notice Official pinned V3 liquidity provisioning inside the isolated VM only.
contract AlphaForgeLiquiditySeederTest {
    SeederVm private constant VM =
        SeederVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    AlphaForgeTestUSDC private usdc;
    address[3] private stocks;
    address[3] private pools;
    AlphaForgeLiquiditySeeder private seeder;

    function setUp() public {
        VM.chainId(46630);
        usdc = new AlphaForgeTestUSDC(1e18, address(this));
        bytes memory code = PinnedV3Bytecode.factory();
        address factory;
        assembly { factory := create(0, add(code, 32), mload(code)) }
        require(factory != address(0), "factory");
        for (uint8 i; i < 3; ++i) {
            stocks[i] = address(new AlphaForgeTestStock(i, 1e28, address(this)));
            pools[i] = SeederFactory(factory).createPool(address(usdc), stocks[i], 3000);
            uint160 q96 = uint160(1 << 96);
            SeederPool(pools[i]).initialize(address(usdc) < stocks[i] ? q96 * 100000 : q96 / 100000);
        }
        seeder = new AlphaForgeLiquiditySeeder(address(this), factory, address(usdc), stocks);
    }

    function test_SeedUsesExactCallerBudgetsAndRemovalReturnsLiquidityOnlyToOwner() public {
        uint256 beforeUsdc = usdc.balanceOf(address(this));
        for (uint8 i; i < 3; ++i) {
            usdc.approve(address(seeder), 1e15);
            IERC20(stocks[i]).approve(address(seeder), 1e27);
            (uint256 paidUsdc, uint256 paidStock) =
                seeder.seed(stocks[i], -887220, 887220, 1e19, 1e15, 1e27);
            require(paidUsdc > 0 && paidStock > 0, "actual debts");
            require(
                usdc.balanceOf(address(seeder)) == 0
                    && IERC20(stocks[i]).balanceOf(address(seeder)) == 0,
                "no pooled custody"
            );
            (uint128 received0, uint128 received1) = seeder.remove(stocks[i], -887220, 887220, 1e19);
            require(received0 > 0 && received1 > 0, "actual removal");
        }
        require(beforeUsdc - usdc.balanceOf(address(this)) <= 3, "only rounding dust");
    }

    function test_BudgetFailureRollsBackLiquidityAndDoesNotConsumeApprovals() public {
        usdc.approve(address(seeder), 1e15);
        IERC20(stocks[0]).approve(address(seeder), 1e27);
        uint256 balance = usdc.balanceOf(address(this));
        uint256 allowance = usdc.allowance(address(this), address(seeder));
        (bool ok,) = address(seeder)
            .call(
                abi.encodeCall(
                    seeder.seed,
                    (
                        stocks[0],
                        int24(-887220),
                        int24(887220),
                        uint128(1e19),
                        uint256(1),
                        uint256(1)
                    )
                )
            );
        require(
            !ok && usdc.balanceOf(address(this)) == balance
                && usdc.allowance(address(this), address(seeder)) == allowance,
            "atomic budget rollback"
        );
    }

    function test_OnlyOwnerCanSeedOrRemoveAndCallbacksCannotSpendOutsideASeed() public {
        VM.prank(address(0xBAD));
        (bool ok,) = address(seeder)
            .call(
                abi.encodeCall(
                    seeder.seed,
                    (
                        stocks[0],
                        int24(-887220),
                        int24(887220),
                        uint128(1e19),
                        uint256(1e15),
                        uint256(1e27)
                    )
                )
            );
        require(!ok, "foreign seed");
        VM.prank(address(0xBAD));
        (ok,) = address(seeder)
            .call(
                abi.encodeCall(
                    seeder.remove, (stocks[0], int24(-887220), int24(887220), uint128(1))
                )
            );
        require(!ok, "foreign removal");
        VM.prank(pools[0]);
        (ok,) = address(seeder)
            .call(
                abi.encodeCall(
                    seeder.uniswapV3MintCallback,
                    (uint256(1), uint256(1), abi.encode(stocks[0], uint256(1e15), uint256(1e27)))
                )
            );
        require(!ok, "out of operation callback");
        (ok,) = address(seeder)
            .call(
                abi.encodeCall(
                    seeder.seed,
                    (
                        address(usdc),
                        int24(-887220),
                        int24(887220),
                        uint128(1),
                        uint256(1),
                        uint256(1)
                    )
                )
            );
        require(!ok, "foreign stock");
    }
}
