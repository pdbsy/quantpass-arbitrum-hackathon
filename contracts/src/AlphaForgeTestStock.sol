// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Explicit TEST SUBSTITUTES; never canonical Robinhood Stock Tokens.
contract AlphaForgeTestStock is ERC20 {
    uint8 public immutable referenceSymbol;

    constructor(uint8 referenceSymbol_, uint256 fixedSupply, address recipient)
        ERC20(_name(referenceSymbol_), _symbol(referenceSymbol_))
    {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(recipient != address(0) && fixedSupply != 0, "INVALID_TEST_SUPPLY");
        referenceSymbol = referenceSymbol_;
        _mint(recipient, fixedSupply);
    }

    function _name(uint8 index) private pure returns (string memory) {
        if (index == 0) return "AlphaForge Test MSFT Reference";
        if (index == 1) return "AlphaForge Test NVDA Reference";
        require(index == 2, "UNSUPPORTED_REFERENCE");
        return "AlphaForge Test AAPL Reference";
    }

    function _symbol(uint8 index) private pure returns (string memory) {
        if (index == 0) return "AF-TEST-MSFT";
        if (index == 1) return "AF-TEST-NVDA";
        require(index == 2, "UNSUPPORTED_REFERENCE");
        return "AF-TEST-AAPL";
    }
}

interface IAlphaForgeReferenceFeed {
    function price()
        external
        view
        returns (uint256 usdcRaw, uint64 observedAt, bytes32 sourceDigest);
}

/// @notice Operator-maintained TEST reference mapping, not a canonical production oracle.
contract AlphaForgeTestReferenceFeed is IAlphaForgeReferenceFeed {
    address public immutable keeper;
    bytes32 public immutable referenceIdentity;
    uint256 private quote;
    uint64 private observed;
    bytes32 private digest;
    event ReferenceUpdated(uint256 usdcRaw, uint64 observedAt, bytes32 indexed sourceDigest);

    constructor(address keeper_, bytes32 identity) {
        require(block.chainid == 46630, "TESTNET_ONLY");
        require(keeper_ != address(0) && identity != bytes32(0), "INVALID_REFERENCE_IDENTITY");
        keeper = keeper_;
        referenceIdentity = identity;
    }

    function update(uint256 usdcRaw, uint64 observedAt, bytes32 sourceDigest) external {
        require(msg.sender == keeper, "KEEPER_REQUIRED");
        require(usdcRaw != 0 && sourceDigest != bytes32(0), "INVALID_REFERENCE_PRICE");
        require(observedAt <= block.timestamp && observedAt > observed, "INVALID_REFERENCE_TIME");
        quote = usdcRaw;
        observed = observedAt;
        digest = sourceDigest;
        emit ReferenceUpdated(usdcRaw, observedAt, sourceDigest);
    }

    function price()
        external
        view
        returns (uint256 usdcRaw, uint64 observedAt, bytes32 sourceDigest)
    {
        return (quote, observed, digest);
    }
}
