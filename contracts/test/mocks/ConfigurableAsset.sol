// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ConfigurableAsset is ERC20 {
    uint8 private immutable configuredDecimals;
    bool public failTransfer;
    bool public failTransferFrom;
    bool public failBalanceRead;
    uint256 public transferFee;
    uint256 public transferFromFee;

    error ConfiguredFailure();

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 supply_,
        address recipient_
    ) ERC20(name_, symbol_) {
        configuredDecimals = decimals_;
        _mint(recipient_, supply_);
    }

    function decimals() public view override returns (uint8) {
        return configuredDecimals;
    }

    function configure(
        bool failTransfer_,
        bool failTransferFrom_,
        bool failBalanceRead_,
        uint256 transferFromFee_
    ) external {
        failTransfer = failTransfer_;
        failTransferFrom = failTransferFrom_;
        failBalanceRead = failBalanceRead_;
        transferFromFee = transferFromFee_;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (failBalanceRead) revert ConfiguredFailure();
        return super.balanceOf(account);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (failTransfer) revert ConfiguredFailure();
        bool success = super.transfer(to, value);
        uint256 fee = transferFee;
        if (fee != 0) _burn(to, fee);
        return success;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (failTransferFrom) revert ConfiguredFailure();
        bool success = super.transferFrom(from, to, value);
        uint256 fee = transferFromFee;
        if (fee != 0) _burn(to, fee);
        return success;
    }

    function setTransferFee(uint256 transferFee_) external {
        transferFee = transferFee_;
    }

    function forceBurn(address account, uint256 amount) external {
        _burn(account, amount);
    }
}

contract ConfigurableStrategyPass is ConfigurableAsset {
    bytes32 public immutable strategyId;

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 strategyId_,
        uint256 supply_,
        address recipient_
    ) ConfigurableAsset(name_, symbol_, 18, supply_, recipient_) {
        strategyId = strategyId_;
    }
}
