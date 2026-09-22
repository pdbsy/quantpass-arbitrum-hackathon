// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

// Independent rollback probe by Macbeth06, adopted by Macbeth01 for the PR22 regression suite.
// Original probe SHA-256: a7709771f2f609395f3b033e22fc2603e01c824721789858f72a0bcb555b0890.
import { AlphaForgeVault } from "../src/AlphaForgeVault.sol";
import { PassLocker } from "../src/PassLocker.sol";
import { StrategyPass } from "../src/StrategyPass.sol";
import {
    AlphaForgeTestUSDC,
    AlphaForgeTestETH,
    AlphaForgeTestBTC
} from "../src/AlphaForgeTestAsset.sol";

interface ProbeVm {
    function startPrank(address) external;
    function stopPrank() external;
}

contract LateFailPass is StrategyPass {
    address private failingSender;
    error SecondLegFailure(uint256 ownerBalanceAfterLockerCredit);
    constructor(bytes32 id, address owner) StrategyPass("Probe", "PROBE", id, 1000 ether, owner) { }

    function failFrom(address sender) external {
        failingSender = sender;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (msg.sender == failingSender) revert SecondLegFailure(balanceOf(to));
        return super.transfer(to, amount);
    }
}

contract Macbeth06SecondLegRollbackProbe {
    ProbeVm constant VM = ProbeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function test_LateVaultFailureRollsBackEarlierLockerTransferAndAllowsRetry() public {
        address owner = address(0xA11CE);
        bytes32 strategy = keccak256("probe");
        LateFailPass pass = new LateFailPass(strategy, owner);
        AlphaForgeTestUSDC usdc = new AlphaForgeTestUSDC(100e6, owner);
        AlphaForgeTestETH eth = new AlphaForgeTestETH(100 ether, owner);
        AlphaForgeTestBTC btc = new AlphaForgeTestBTC(100 ether, owner);
        AlphaForgeVault vault = new AlphaForgeVault(
            owner,
            address(0xC0FFEE),
            strategy,
            keccak256("probe-ref"),
            address(pass),
            address(usdc),
            address(eth),
            address(btc)
        );
        VM.startPrank(owner);
        pass.approve(address(vault), 10 ether);
        usdc.approve(address(vault), 10e6);
        vault.deposit(10e6);
        pass.transfer(vault.passLocker(), 3);
        pass.transfer(address(vault), 5);
        vault.close();
        VM.stopPrank();
        uint256 beforeBalance = pass.balanceOf(owner);
        require(
            vault.closed() && PassLocker(vault.passLocker()).lockedBalance() == 0,
            "close prerequisite"
        );
        pass.failFrom(address(vault));
        VM.startPrank(owner);
        (bool ok, bytes memory failure) =
            address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(pass))));
        VM.stopPrank();
        require(!ok, "late transfer should fail");
        require(
            keccak256(failure)
                == keccak256(
                    abi.encodeWithSelector(
                        LateFailPass.SecondLegFailure.selector, beforeBalance + 3
                    )
                ),
            "Locker credit not reached before Vault failure"
        );
        require(pass.balanceOf(owner) == beforeBalance, "partial Owner credit survived revert");
        require(pass.balanceOf(vault.passLocker()) == 3, "Locker dust not restored");
        require(pass.balanceOf(address(vault)) == 5, "Vault dust changed");
        require(
            vault.closed() && vault.principalBasis() == 0 && vault.trackedUsdcBalance() == 0,
            "closed accounting changed"
        );
        require(
            PassLocker(vault.passLocker()).lockedBalance() == 0, "lock restored by rescue failure"
        );
        pass.failFrom(address(0));
        VM.startPrank(owner);
        require(vault.rescueUntrackedToken(address(pass)) == 8, "retry amount");
        require(pass.balanceOf(owner) == beforeBalance + 8, "retry recipient");
        require(
            pass.balanceOf(vault.passLocker()) == 0 && pass.balanceOf(address(vault)) == 0,
            "retry residual"
        );
        (ok,) = address(vault).call(abi.encodeCall(vault.rescueUntrackedToken, (address(pass))));
        require(!ok, "empty replay accepted");
        VM.stopPrank();
    }
}
