// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

/// @notice The approved SwapRouter02 seven-field exactInputSingle boundary.
/// @dev Deadline is enforced by the calling Vault, not encoded in this tuple.
interface ISinglePoolRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
