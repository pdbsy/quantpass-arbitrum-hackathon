// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

import { IAlphaForgeVault } from "./interfaces/IAlphaForgeVault.sol";
import { PassLocker } from "./PassLocker.sol";
import { StrategyPass } from "./StrategyPass.sol";

/// @notice Owner-controlled partial-onchain custody for one AlphaForge strategy.
/// @dev Strategy execution is deliberately absent. Only explicit protocol accounting is authoritative.
contract AlphaForgeVault is IAlphaForgeVault, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant PASS_SCALE = 1e12;

    address public immutable override owner;
    address public immutable override strategyCreator;
    bytes32 public immutable override strategyId;
    bytes32 public immutable override strategyRef;
    address public immutable override pass;
    address public immutable override afUsdc;
    address public immutable override afEth;
    address public immutable override afBtc;
    address public immutable override passLocker;

    uint256 public override principalBasis;
    uint256 public override trackedUsdcBalance;
    mapping(address token => uint256 amount) public override trackedPosition;
    uint256 public override openTrackedPositionCount;
    bool public override closed;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier whenActive() {
        if (closed) revert VaultClosed();
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
    ) {
        if (
            owner_ == address(0) || strategyCreator_ == address(0) || pass_ == address(0)
                || afUsdc_ == address(0) || afEth_ == address(0) || afBtc_ == address(0)
        ) revert ZeroAddress();
        if (strategyId_ == bytes32(0) || strategyRef_ == bytes32(0)) {
            revert InvalidStrategyIdentity();
        }
        _requireDistinctAssets(pass_, afUsdc_, afEth_, afBtc_);
        _requireDecimals(pass_, 18);
        _requireDecimals(afUsdc_, 6);
        _requireStrategyPass(pass_, strategyId_);

        owner = owner_;
        strategyCreator = strategyCreator_;
        strategyId = strategyId_;
        strategyRef = strategyRef_;
        pass = pass_;
        afUsdc = afUsdc_;
        afEth = afEth_;
        afBtc = afBtc_;
        passLocker = address(new PassLocker(address(this), owner_, IERC20(pass_)));
    }

    receive() external payable { }

    function deposit(uint256 usdcAmount) external override onlyOwner whenActive nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();
        uint256 passRaw = usdcToPassRaw(usdcAmount);
        if (
            principalBasis > type(uint256).max - usdcAmount
                || trackedUsdcBalance > type(uint256).max - usdcAmount
        ) revert AmountOverflow(usdcAmount);

        principalBasis += usdcAmount;
        trackedUsdcBalance += usdcAmount;

        _pullOwnerUsdcExact(usdcAmount);
        _pullOwnerPassExact(passRaw);
        PassLocker(passLocker).lock(passRaw);

        emit Deposited(owner, usdcAmount, passRaw, principalBasis, trackedUsdcBalance);
    }

    function withdraw(uint256 usdcAmount)
        external
        virtual
        override
        onlyOwner
        whenActive
        nonReentrant
    {
        if (usdcAmount == 0) revert ZeroAmount();
        uint256 available = trackedUsdcBalance;
        if (usdcAmount > available) revert InsufficientTrackedUsdc(available, usdcAmount);

        uint256 profit = realizedProfit();
        uint256 profitAmount = usdcAmount < profit ? usdcAmount : profit;
        uint256 principalAmount = usdcAmount - profitAmount;
        uint256 positionCount = openTrackedPositionCount;
        if (principalAmount != 0 && positionCount != 0) {
            revert OpenTrackedPositions(positionCount);
        }
        uint256 passRawUnlocked = usdcToPassRaw(principalAmount);

        trackedUsdcBalance = available - usdcAmount;
        principalBasis -= principalAmount;

        _safeTransferExact(afUsdc, owner, usdcAmount);
        if (passRawUnlocked != 0) PassLocker(passLocker).unlock(passRawUnlocked);

        emit Withdrawn(
            owner,
            usdcAmount,
            profitAmount,
            principalAmount,
            passRawUnlocked,
            principalBasis,
            trackedUsdcBalance
        );
    }

    function close() external virtual override onlyOwner whenActive nonReentrant {
        uint256 positionCount = openTrackedPositionCount;
        if (positionCount != 0) revert OpenTrackedPositions(positionCount);

        uint256 usdcReturned = trackedUsdcBalance;
        uint256 passRawReleased = PassLocker(passLocker).lockedBalance();

        _setTrackedPosition(afEth, 0);
        _setTrackedPosition(afBtc, 0);
        closed = true;
        principalBasis = 0;
        trackedUsdcBalance = 0;

        if (usdcReturned != 0) _safeTransferExact(afUsdc, owner, usdcReturned);
        if (passRawReleased != 0) passRawReleased = PassLocker(passLocker).releaseAll();

        emit Closed(owner, usdcReturned, passRawReleased);
    }

    function rescueUntrackedToken(address token)
        external
        virtual
        override
        onlyOwner
        nonReentrant
        returns (uint256 amount)
    {
        if (!closed) revert VaultActive();
        if (token == address(0)) revert ZeroAddress();
        amount = untrackedExcess(token);
        if (amount < 1) revert NoUntrackedExcess(token);
        uint256 vaultAmount = amount;
        if (token == pass) vaultAmount -= PassLocker(passLocker).rescueUntrackedPass();
        if (vaultAmount != 0) _safeTransferExact(token, owner, vaultAmount);
        emit UntrackedTokenRescued(token, owner, amount);
    }

    function rescueNative()
        external
        virtual
        override
        onlyOwner
        nonReentrant
        returns (uint256 amount)
    {
        if (!closed) revert VaultActive();
        amount = address(this).balance;
        if (amount < 1) revert NoUntrackedExcess(address(0));
        Address.sendValue(payable(owner), amount);
        emit NativeRescued(owner, amount);
    }

    function usdcToPassRaw(uint256 usdcRaw) public pure override returns (uint256 passRaw) {
        if (usdcRaw > type(uint256).max / PASS_SCALE) revert AmountOverflow(usdcRaw);
        return usdcRaw * PASS_SCALE;
    }

    function passToUsdcRaw(uint256 passRaw) public pure override returns (uint256 usdcRaw) {
        if (passRaw % PASS_SCALE != 0) revert InexactPassAmount(passRaw);
        return passRaw / PASS_SCALE;
    }

    function realizedProfit() public view override returns (uint256 amount) {
        uint256 tracked = trackedUsdcBalance;
        uint256 principal = principalBasis;
        return tracked > principal ? tracked - principal : 0;
    }

    function withdrawableUsdc() public view override returns (uint256 amount) {
        if (closed) return 0;
        if (openTrackedPositionCount != 0) return realizedProfit();
        return trackedUsdcBalance;
    }

    function reservedTrackedBalance(address token) public view override returns (uint256 amount) {
        if (token == afUsdc) return trackedUsdcBalance;
        if (token == afEth || token == afBtc) return trackedPosition[token];
        if (token == pass) return PassLocker(passLocker).lockedBalance();
        return 0;
    }

    function untrackedExcess(address token) public view override returns (uint256 amount) {
        if (token == address(0)) revert ZeroAddress();
        uint256 actual = IERC20(token).balanceOf(address(this));
        uint256 reserved = reservedTrackedBalance(token);
        if (token == pass && closed) {
            uint256 lockerActual = IERC20(token).balanceOf(passLocker);
            return actual + (lockerActual > reserved ? lockerActual - reserved : 0);
        }
        return actual > reserved ? actual - reserved : 0;
    }

    function _pullOwnerUsdcExact(uint256 amount) private {
        uint256 beforeBalance = IERC20(afUsdc).balanceOf(address(this));
        IERC20(afUsdc).safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = IERC20(afUsdc).balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
            revert TokenTransferAmountMismatch(afUsdc, amount, received);
        }
    }

    function _pullOwnerPassExact(uint256 amount) private {
        uint256 beforeBalance = IERC20(pass).balanceOf(passLocker);
        IERC20(pass).safeTransferFrom(msg.sender, passLocker, amount);
        uint256 afterBalance = IERC20(pass).balanceOf(passLocker);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
            revert TokenTransferAmountMismatch(pass, amount, received);
        }
    }

    function _safeTransferExact(address token, address to, uint256 amount) private {
        _requireFunded(token, amount);
        uint256 beforeBalance = IERC20(token).balanceOf(to);
        IERC20(token).safeTransfer(to, amount);
        uint256 afterBalance = IERC20(token).balanceOf(to);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
            revert TokenTransferAmountMismatch(token, amount, received);
        }
    }

    function _requireFunded(address token, uint256 reserved) private view {
        uint256 actual = IERC20(token).balanceOf(address(this));
        if (actual < reserved) revert TrackedBalanceDeficit(token, actual, reserved);
    }

    function _setTrackedPosition(address token, uint256 amount) internal whenActive {
        if (token != afEth && token != afBtc) revert UnsupportedTrackedAsset(token);
        uint256 previous = trackedPosition[token];
        if (previous == amount) return;
        if (amount != 0) _requireFunded(token, amount);
        if (previous == 0) {
            ++openTrackedPositionCount;
        } else if (amount == 0) {
            --openTrackedPositionCount;
        }
        trackedPosition[token] = amount;
        emit TrackedPositionChanged(token, previous, amount);
    }

    function _requireDecimals(address token, uint8 expected) private view {
        uint8 actual = IERC20Metadata(token).decimals();
        if (actual != expected) revert UnexpectedDecimals(token, expected, actual);
    }

    function _requireStrategyPass(address pass_, bytes32 expected) private view {
        bytes32 actual = bytes32(0);
        try StrategyPass(pass_).strategyId() returns (bytes32 strategyId_) {
            actual = strategyId_;
        } catch {
            revert StrategyPassMismatch(pass_, expected, bytes32(0));
        }
        if (actual != expected) revert StrategyPassMismatch(pass_, expected, actual);
    }

    function _requireDistinctAssets(address pass_, address usdc_, address eth_, address btc_)
        private
        pure
    {
        if (pass_ == usdc_ || pass_ == eth_ || pass_ == btc_) revert DuplicateAsset(pass_);
        if (usdc_ == eth_ || usdc_ == btc_) revert DuplicateAsset(usdc_);
        if (eth_ == btc_) revert DuplicateAsset(eth_);
    }
}
