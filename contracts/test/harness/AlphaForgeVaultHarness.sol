// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AlphaForgeVault } from "../../src/AlphaForgeVault.sol";

/// @notice Test-only settlement surface. Production AlphaForgeVault exposes none of these methods.
contract AlphaForgeVaultHarness is AlphaForgeVault {
    using SafeERC20 for IERC20;

    address public immutable harnessController;

    error HarnessUnauthorized();

    modifier onlyHarnessController() {
        if (msg.sender != harnessController) revert HarnessUnauthorized();
        _;
    }

    constructor(
        address owner_,
        address strategyCreator_,
        bytes32 strategyId_,
        bytes32 strategyRef_,
        address pass_,
        address afUsdc_,
        address afEth_,
        address afBtc_
    )
        AlphaForgeVault(
            owner_, strategyCreator_, strategyId_, strategyRef_, pass_, afUsdc_, afEth_, afBtc_
        )
    {
        harnessController = msg.sender;
    }

    function recordRealizedProfit(uint256 amount) external onlyHarnessController nonReentrant {
        if (closed) revert VaultClosed();
        if (amount == 0) revert ZeroAmount();
        uint256 previous = trackedUsdcBalance;
        if (previous > type(uint256).max - amount) revert AmountOverflow(amount);
        IERC20(afUsdc).safeTransferFrom(msg.sender, address(this), amount);
        uint256 updated = previous + amount;
        if (IERC20(afUsdc).balanceOf(address(this)) < updated) {
            revert TrackedBalanceDeficit(afUsdc, IERC20(afUsdc).balanceOf(address(this)), updated);
        }
        trackedUsdcBalance = updated;
        emit TrackedUsdcBalanceChanged(previous, updated);
    }

    function recordRealizedLoss(uint256 amount) external onlyHarnessController nonReentrant {
        if (closed) revert VaultClosed();
        if (amount == 0) revert ZeroAmount();
        uint256 previous = trackedUsdcBalance;
        if (amount > previous) revert InsufficientTrackedUsdc(previous, amount);
        uint256 updated = previous - amount;
        trackedUsdcBalance = updated;
        IERC20(afUsdc).safeTransfer(msg.sender, amount);
        emit TrackedUsdcBalanceChanged(previous, updated);
    }

    function seedAccountingForTest(uint256 principal, uint256 tracked)
        external
        onlyHarnessController
    {
        principalBasis = principal;
        trackedUsdcBalance = tracked;
    }

    function setTrackedPositionForTest(address token, uint256 amount)
        external
        onlyHarnessController
    {
        _setTrackedPosition(token, amount);
    }

    function openPosition(address token, uint256 amount)
        external
        onlyHarnessController
        nonReentrant
    {
        if (closed) revert VaultClosed();
        if (token != afEth && token != afBtc) revert UnsupportedTrackedAsset(token);
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 previous = trackedPosition[token];
        if (previous > type(uint256).max - amount) revert AmountOverflow(amount);
        uint256 updated = previous + amount;
        _setTrackedPosition(token, updated);
    }

    function settlePosition(address token, uint256 amount)
        external
        onlyHarnessController
        nonReentrant
    {
        if (closed) revert VaultClosed();
        if (token != afEth && token != afBtc) revert UnsupportedTrackedAsset(token);
        if (amount == 0) revert ZeroAmount();
        uint256 current = trackedPosition[token];
        if (amount > current) revert TrackedBalanceDeficit(token, current, amount);
        uint256 updated = current - amount;
        _setTrackedPosition(token, updated);
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
