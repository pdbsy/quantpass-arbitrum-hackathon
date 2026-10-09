// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

/// @notice Native quotes bind a stable, verified account identifier as well as the payer wallet.
library MarketTypes {
    uint8 internal constant MINT = 0;
    uint8 internal constant BUY = 1;
    uint8 internal constant SELL = 2;

    struct NativeQuote {
        address router;
        address payer;
        bytes32 accountId;
        uint8 operation;
        address pass;
        uint256 amountIn;
        uint256 usdcAmount;
        uint256 minOut;
        uint256 ethAmount;
        uint256 ethUsdPrice;
        uint256 nonce;
        uint64 issuedAt;
        uint64 deadline;
        uint64 epoch;
    }

    // Strict EOA signature verification; contract wallets are quote recipients, never quote signers.
    function signer(bytes32 digest, bytes calldata signature)
        internal
        pure
        returns (address result)
    {
        require(signature.length == 65, "SIGNATURE_LENGTH");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(
            uint256(s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0
                && (v == 27 || v == 28),
            "SIGNATURE_CANONICAL"
        );
        result = ecrecover(digest, v, r, s);
        require(result != address(0), "SIGNATURE_INVALID");
    }
}
