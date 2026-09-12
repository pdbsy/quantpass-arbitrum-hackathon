// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice TEST_ONLY digest preview. Does not validate, sign, authorize, execute, or hold assets.
/// @dev String identifiers follow the local Wave 1 boundary; no address/bytes32 ID mapping is implied.
contract VaultIntentPreview is EIP712 {
    struct Intent {
        string ownerId;
        string strategyId;
        string vaultId;
        string commandId;
        string commandType;
        string assetId;
        uint8 decimals;
        uint256 amount;
        uint256 expectedRevision;
        uint256 nonce;
        uint256 deadline;
        uint256 authorizationEpoch;
        bytes32 policyHash;
    }

    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "Intent(string ownerId,string strategyId,string vaultId,string commandId,string commandType,string assetId,uint8 decimals,uint256 amount,uint256 expectedRevision,uint256 nonce,uint256 deadline,uint256 authorizationEpoch,bytes32 policyHash)"
    );

    constructor() EIP712("AlphaForgeVaultFoundationPreview", "0.1") { }

    /// @dev Any input can be hashed. A digest is not evidence of an allowed command or valid authority.
    function preview(Intent calldata intent) external view returns (bytes32) {
        // Fixed array encoding is exactly fourteen 32-byte words (no dynamic offsets or length).
        // Strings are individually hashed as required by EIP-712, never packed together.
        bytes32[14] memory words;
        words[0] = INTENT_TYPEHASH;
        words[1] = keccak256(bytes(intent.ownerId));
        words[2] = keccak256(bytes(intent.strategyId));
        words[3] = keccak256(bytes(intent.vaultId));
        words[4] = keccak256(bytes(intent.commandId));
        words[5] = keccak256(bytes(intent.commandType));
        words[6] = keccak256(bytes(intent.assetId));
        words[7] = bytes32(uint256(intent.decimals));
        words[8] = bytes32(intent.amount);
        words[9] = bytes32(intent.expectedRevision);
        words[10] = bytes32(intent.nonce);
        words[11] = bytes32(intent.deadline);
        words[12] = bytes32(intent.authorizationEpoch);
        words[13] = intent.policyHash;
        return _hashTypedDataV4(keccak256(abi.encode(words)));
    }
}
