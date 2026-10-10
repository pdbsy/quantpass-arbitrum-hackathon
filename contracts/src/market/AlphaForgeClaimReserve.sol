// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { MarketTypes } from "./MarketTypes.sol";

/// @notice Paid only from this separately funded reserve, once per stable verified account.
/// @dev Email verification belongs to the credential issuer; opaque account IDs never reveal email.
contract AlphaForgeClaimReserve is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant CLAIM_AMOUNT = 1_000e6;
    uint256 public constant MAX_CLAIMS = 100;
    uint64 public constant MAX_VOUCHER_AGE = 60;
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "ClaimVoucher(bytes32 accountId,address wallet,uint256 nonce,uint64 issuedAt,uint64 deadline,uint64 epoch)"
    );

    struct ClaimVoucher {
        bytes32 accountId;
        address wallet;
        uint256 nonce;
        uint64 issuedAt;
        uint64 deadline;
        uint64 epoch;
    }
    address public immutable owner;
    address public immutable usdc;
    address public claimSigner;
    uint64 public claimEpoch = 1;
    bool public claimsOpened;
    bool public paused;
    uint256 public totalClaims;
    mapping(bytes32 => bool) public claimedAccount;
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonce;
    event ReserveFunded(address indexed funder, uint256 amount);
    event ClaimsOpened(uint256 reserve, uint256 maxClaims);
    event Claim(
        bytes32 indexed accountId,
        address indexed wallet,
        uint256 indexed nonce,
        uint256 amount,
        uint256 totalClaims
    );
    event CredentialIssuerChanged(address indexed signer, uint64 epoch);
    event ClaimsPaused(bool paused);

    constructor(address owner_, address usdc_, address signer_)
        EIP712("AlphaForge Free AF-USDC", "1")
    {
        require(
            block.chainid == 46630 && owner_ != address(0) && signer_ != address(0)
                && usdc_.code.length != 0 && IERC20Metadata(usdc_).decimals() == 6,
            "CONFIGURATION"
        );
        owner = owner_;
        usdc = usdc_;
        claimSigner = signer_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_REQUIRED");
        _;
    }

    function fund(uint256 amount) external onlyOwner nonReentrant {
        require(amount != 0, "AMOUNT");
        uint256 beforeBalance = IERC20(usdc).balanceOf(address(this));
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);
        require(
            IERC20(usdc).balanceOf(address(this)) - beforeBalance == amount, "TRANSFER_MISMATCH"
        );
        emit ReserveFunded(msg.sender, amount);
    }

    function openClaims() external onlyOwner {
        require(
            !claimsOpened && IERC20(usdc).balanceOf(address(this)) >= MAX_CLAIMS * CLAIM_AMOUNT,
            "CLAIM_PREFUND_REQUIRED"
        );
        claimsOpened = true;
        emit ClaimsOpened(MAX_CLAIMS * CLAIM_AMOUNT, MAX_CLAIMS);
    }

    function setSigner(address signer_) external onlyOwner {
        require(signer_ != address(0), "SIGNER");
        claimSigner = signer_;
        ++claimEpoch;
        emit CredentialIssuerChanged(signer_, claimEpoch);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit ClaimsPaused(paused_);
    }

    function voucherDigest(ClaimVoucher calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, voucher)));
    }

    function claim(ClaimVoucher calldata voucher, bytes calldata signature) external nonReentrant {
        require(
            block.chainid == 46630 && claimsOpened && !paused && totalClaims < MAX_CLAIMS,
            "CLAIMS_UNAVAILABLE"
        );
        require(voucher.wallet == msg.sender && voucher.accountId != bytes32(0), "CLAIM_OWNER");
        require(
            voucher.epoch == claimEpoch && voucher.issuedAt <= block.timestamp
                && block.timestamp - voucher.issuedAt <= MAX_VOUCHER_AGE
                && voucher.deadline >= block.timestamp && voucher.deadline >= voucher.issuedAt
                && voucher.deadline - voucher.issuedAt <= MAX_VOUCHER_AGE,
            "CREDENTIAL_EXPIRED"
        );
        require(
            !claimedAccount[voucher.accountId] && !usedNonce[voucher.accountId][voucher.nonce],
            "ALREADY_CLAIMED"
        );
        require(
            MarketTypes.signer(voucherDigest(voucher), signature) == claimSigner,
            "CREDENTIAL_SIGNATURE"
        );
        claimedAccount[voucher.accountId] = true;
        usedNonce[voucher.accountId][voucher.nonce] = true;
        ++totalClaims;
        uint256 beforeBalance = IERC20(usdc).balanceOf(voucher.wallet);
        uint256 ownBalance = IERC20(usdc).balanceOf(address(this));
        IERC20(usdc).safeTransfer(voucher.wallet, CLAIM_AMOUNT);
        require(
            IERC20(usdc).balanceOf(voucher.wallet) - beforeBalance == CLAIM_AMOUNT
                && ownBalance - IERC20(usdc).balanceOf(address(this)) == CLAIM_AMOUNT,
            "TRANSFER_MISMATCH"
        );
        emit Claim(voucher.accountId, voucher.wallet, voucher.nonce, CLAIM_AMOUNT, totalClaims);
    }
}
