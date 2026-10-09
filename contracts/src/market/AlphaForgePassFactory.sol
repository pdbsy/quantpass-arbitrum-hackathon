// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { AlphaForgePassPool } from "./AlphaForgePassPool.sol";

/// @notice Permissioned initial launch; swaps and proportional LP operations are permissionless.
contract AlphaForgePassFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable owner;
    address public immutable usdc;
    mapping(address => address) public initializer;
    mapping(address => address) public getPool;
    event InitializerConfigured(address indexed pass, address indexed initializer);
    event PoolCreated(
        address indexed pass, address indexed pool, address indexed lpRecipient, uint256 shares
    );

    constructor(address owner_, address usdc_) {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(
            owner_ != address(0) && usdc_.code.length != 0 && IERC20Metadata(usdc_).decimals() == 6,
            "IDENTITY"
        );
        owner = owner_;
        usdc = usdc_;
    }

    function configureInitializer(address pass, address launcher) external {
        require(
            msg.sender == owner && initializer[pass] == address(0) && getPool[pass] == address(0),
            "OWNER_ONCE"
        );
        require(
            pass.code.length != 0 && pass != usdc && launcher != address(0)
                && IERC20Metadata(pass).decimals() == 18
                && IERC20(pass).totalSupply() == 1_000_000 ether,
            "PASS_IDENTITY"
        );
        initializer[pass] = launcher;
        emit InitializerConfigured(pass, launcher);
    }

    function createPool(address pass, address lpRecipient)
        external
        nonReentrant
        returns (address pool, uint256 shares)
    {
        require(
            block.chainid == 46630 && msg.sender == initializer[pass]
                && getPool[pass] == address(0),
            "INITIALIZER_ONCE"
        );
        require(lpRecipient != address(0) && lpRecipient != address(this), "LP_RECIPIENT");
        pool = address(new AlphaForgePassPool(pass, usdc, lpRecipient));
        getPool[pass] = pool;
        _pull(pass, pool, 500_000 ether);
        _pull(usdc, pool, 250_000e6);
        shares = AlphaForgePassPool(pool).initialize(500_000 ether, 250_000e6);
        require(
            shares != 0 && AlphaForgePassPool(pool).balanceOf(lpRecipient) == shares,
            "LP_INITIALIZATION"
        );
        emit PoolCreated(pass, pool, lpRecipient, shares);
    }

    function _pull(address token, address pool, uint256 amount) private {
        uint256 beforeBalance = IERC20(token).balanceOf(pool);
        IERC20(token).safeTransferFrom(msg.sender, pool, amount);
        require(IERC20(token).balanceOf(pool) - beforeBalance == amount, "TRANSFER_MISMATCH");
    }
}
