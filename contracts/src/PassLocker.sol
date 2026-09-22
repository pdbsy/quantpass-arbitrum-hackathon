// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Escrows one Strategy Pass while an immutable Vault uses principal capacity.
/// @dev The Vault transfers the owner's Pass here before calling lock in the same transaction.
contract PassLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error EscrowBalanceDeficit(uint256 balance, uint256 accounted);
    error InsufficientUnaccountedPass(uint256 available, uint256 requested);
    error InsufficientLockedPass(uint256 available, uint256 requested);
    error PassTransferAmountMismatch(uint256 expected, uint256 actual);

    event PassLocked(address indexed owner, uint256 amount);
    event PassUnlocked(address indexed owner, uint256 amount);
    event UntrackedPassRescued(address indexed owner, uint256 amount);

    address public immutable vault;
    address public immutable owner;
    IERC20 public immutable pass;
    uint256 public lockedBalance;

    modifier onlyVault() {
        _checkVault();
        _;
    }

    constructor(address vault_, address owner_, IERC20 pass_) {
        if (vault_ == address(0) || owner_ == address(0) || address(pass_) == address(0)) {
            revert ZeroAddress();
        }
        vault = vault_;
        owner = owner_;
        pass = pass_;
    }

    function lock(uint256 amount) external onlyVault nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = pass.balanceOf(address(this));
        uint256 accounted = lockedBalance;
        if (balance < accounted) revert EscrowBalanceDeficit(balance, accounted);
        uint256 available = balance - accounted;
        if (amount > available) revert InsufficientUnaccountedPass(available, amount);
        lockedBalance += amount;
        emit PassLocked(owner, amount);
    }

    function unlock(uint256 amount) external onlyVault nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = lockedBalance;
        if (amount > available) revert InsufficientLockedPass(available, amount);
        lockedBalance = available - amount;
        _transferToOwnerExact(amount);
        emit PassUnlocked(owner, amount);
    }

    function releaseAll() external onlyVault nonReentrant returns (uint256 amount) {
        amount = lockedBalance;
        if (amount == 0) revert ZeroAmount();
        lockedBalance = 0;
        _transferToOwnerExact(amount);
        emit PassUnlocked(owner, amount);
    }

    /// @notice The Vault permits this only through its Owner's post-close rescue path.
    /// @dev Accounted locks are never reduced; unsolicited Pass uses its own raw units.
    function rescueUntrackedPass() external onlyVault nonReentrant returns (uint256 amount) {
        uint256 balance = pass.balanceOf(address(this));
        uint256 accounted = lockedBalance;
        if (balance < accounted) revert EscrowBalanceDeficit(balance, accounted);
        amount = balance - accounted;
        if (amount != 0) {
            _transferToOwnerExact(amount);
            emit UntrackedPassRescued(owner, amount);
        }
    }

    function _checkVault() private view {
        if (msg.sender != vault) revert Unauthorized();
    }

    function _transferToOwnerExact(uint256 amount) private {
        uint256 beforeBalance = pass.balanceOf(owner);
        pass.safeTransfer(owner, amount);
        uint256 afterBalance = pass.balanceOf(owner);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
            revert PassTransferAmountMismatch(amount, received);
        }
    }
}
