// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AlphaForgeSwapAdapter } from "../src/AlphaForgeSwapAdapter.sol";
import { AlphaForgeTestVenue } from "../src/AlphaForgeTestVenue.sol";
import { ProtocolTypes } from "../src/ProtocolTypes.sol";
import { ConfigurableAsset } from "./mocks/ConfigurableAsset.sol";
import { MaliciousVenue } from "./mocks/MaliciousVenue.sol";

// Test-only external dependency: the sender loses one extra base unit on output settlement.
contract SenderDebitAsset is ERC20 {
    constructor() ERC20("Sender debit fixture", "DEBIT") {
        _mint(msg.sender, 1_000 ether);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool result = super.transfer(to, amount);
        _burn(msg.sender, 1);
        return result;
    }
}

contract AlphaForgeOptionalReachableTest {
    ConfigurableAsset private usdc;
    ConfigurableAsset private eth;
    ConfigurableAsset private btc;
    AlphaForgeTestVenue private venue;

    function setUp() public {
        usdc = new ConfigurableAsset("USDC", "USDC", 6, 1_000e6, address(this));
        eth = new ConfigurableAsset("ETH", "ETH", 18, 1_000 ether, address(this));
        btc = new ConfigurableAsset("BTC", "BTC", 18, 1_000 ether, address(this));
        venue = new AlphaForgeTestVenue(address(usdc), address(eth), address(btc));
        usdc.approve(address(venue), 200e6);
        eth.approve(address(venue), 200 ether);
        venue.addLiquidity(address(usdc), address(eth), 100e6, 100 ether);
    }

    // Removing any constructor identity guard must admit one of these independently chosen cases.
    function test_VenueRejectsEveryZeroAndAliasedAssetSlot() public {
        for (uint256 i; i < 3; i++) {
            address[3] memory tokens = [address(usdc), address(eth), address(btc)];
            tokens[i] = address(0);
            _rejectVenue(tokens, AlphaForgeTestVenue.ZeroAddress.selector);
        }
        _rejectVenue(
            [address(usdc), address(usdc), address(btc)],
            AlphaForgeTestVenue.DuplicateAsset.selector
        );
        _rejectVenue(
            [address(usdc), address(eth), address(usdc)],
            AlphaForgeTestVenue.DuplicateAsset.selector
        );
        _rejectVenue(
            [address(usdc), address(eth), address(eth)], AlphaForgeTestVenue.DuplicateAsset.selector
        );
    }

    function test_AdapterRejectsEveryZeroAndAliasedAssetSlot() public {
        for (uint256 i; i < 4; i++) {
            address[4] memory tokens = [address(venue), address(usdc), address(eth), address(btc)];
            tokens[i] = address(0);
            _rejectAdapter(tokens, AlphaForgeSwapAdapter.ZeroAddress.selector);
        }
        _rejectAdapter(
            [address(venue), address(usdc), address(usdc), address(btc)],
            AlphaForgeSwapAdapter.DuplicateAsset.selector
        );
        _rejectAdapter(
            [address(venue), address(usdc), address(eth), address(usdc)],
            AlphaForgeSwapAdapter.DuplicateAsset.selector
        );
        _rejectAdapter(
            [address(venue), address(usdc), address(eth), address(eth)],
            AlphaForgeSwapAdapter.DuplicateAsset.selector
        );
    }

    function test_AdapterEnforcesMinimumEvenWhenVenueIgnoresItAndRollsBackBothAssets() public {
        MaliciousVenue dependency = new MaliciousVenue(usdc, eth);
        dependency.configure(MaliciousVenue.Mode.Normal, 2 ether);
        eth.transfer(address(dependency), 10 ether);
        AlphaForgeSwapAdapter adapter = new AlphaForgeSwapAdapter(
            address(dependency), address(usdc), address(eth), address(btc)
        );
        usdc.approve(address(adapter), 5e6);
        ProtocolTypes.SwapAction memory action = ProtocolTypes.SwapAction({
            strategyId: keccak256("optional-reachable"),
            tokenIn: address(usdc),
            tokenOut: address(eth),
            amountIn: 5e6,
            minAmountOut: 2 ether + 1,
            deadlineBlock: block.number,
            expectedStateVersion: 7
        });
        uint256 ownerUsdc = usdc.balanceOf(address(this));
        uint256 ownerEth = eth.balanceOf(address(this));
        (bool ok, bytes memory reason) = address(adapter).call(abi.encodeCall(adapter.swap, action));
        _failure(
            ok,
            reason,
            abi.encodeWithSelector(
                AlphaForgeSwapAdapter.SlippageExceeded.selector, 2 ether, 2 ether + 1
            )
        );
        require(usdc.balanceOf(address(this)) == ownerUsdc, "input debit survived rollback");
        require(eth.balanceOf(address(this)) == ownerEth, "output credit survived rollback");
        require(usdc.balanceOf(address(dependency)) == 0, "venue input survived rollback");
        require(eth.balanceOf(address(dependency)) == 10 ether, "venue output lost on failure");
        require(
            usdc.balanceOf(address(adapter)) == 0 && eth.balanceOf(address(adapter)) == 0,
            "adapter retained custody"
        );
        require(usdc.allowance(address(this), address(adapter)) == 5e6, "caller allowance consumed");
        require(
            usdc.allowance(address(adapter), address(dependency)) == 0, "venue allowance leaked"
        );
        require(dependency.allowanceObserved() == 0, "venue state survived rollback");
        action.minAmountOut = 2 ether;
        require(adapter.swap(action) == 2 ether, "valid retry blocked");
        require(usdc.balanceOf(address(this)) == ownerUsdc - 5e6, "retry input not exact");
        require(eth.balanceOf(address(this)) == ownerEth + 2 ether, "retry output not exact");
        require(
            usdc.allowance(address(adapter), address(dependency)) == 0, "retry allowance leaked"
        );
    }

    function test_ZeroSwapAndEmptyPoolFailBeforeAnyAllowanceOrBalanceChange() public {
        (bool ok, bytes memory reason) = address(venue)
            .call(
                abi.encodeCall(
                    venue.swap, (address(usdc), address(eth), 0, 0, address(this), block.number)
                )
            );
        _failure(ok, reason, abi.encodeWithSelector(AlphaForgeTestVenue.ZeroAmount.selector));
        AlphaForgeTestVenue empty =
            new AlphaForgeTestVenue(address(usdc), address(eth), address(btc));
        (ok, reason) = address(empty)
            .staticcall(abi.encodeCall(empty.quote, (address(usdc), address(eth), 1e6)));
        _failure(
            ok, reason, abi.encodeWithSelector(AlphaForgeTestVenue.InsufficientLiquidity.selector)
        );
        (ok, reason) = address(empty)
            .staticcall(abi.encodeCall(empty.quote, (address(eth), address(usdc), 1 ether)));
        _failure(
            ok, reason, abi.encodeWithSelector(AlphaForgeTestVenue.InsufficientLiquidity.selector)
        );
        require(usdc.balanceOf(address(this)) == 900e6, "invalid swap spent input");
        require(
            usdc.allowance(address(this), address(venue)) == 100e6,
            "invalid swap consumed allowance"
        );
        _reservesUnchanged(venue, address(eth), 100e6, 100 ether);
    }

    function test_ShortSecondLiquidityLegRestoresFirstTransferSupplyAndAllowance() public {
        eth.configure(false, false, false, 1);
        uint256 supply = eth.totalSupply();
        (bool ok, bytes memory reason) = address(venue)
            .call(abi.encodeCall(venue.addLiquidity, (address(usdc), address(eth), 10e6, 10 ether)));
        _failure(
            ok,
            reason,
            abi.encodeWithSelector(
                AlphaForgeTestVenue.UnexpectedBalanceDelta.selector,
                address(eth),
                10 ether,
                10 ether - 1
            )
        );
        require(
            usdc.balanceOf(address(this)) == 900e6 && eth.balanceOf(address(this)) == 900 ether,
            "liquidity provider lost funds"
        );
        require(
            usdc.allowance(address(this), address(venue)) == 100e6
                && eth.allowance(address(this), address(venue)) == 100 ether,
            "liquidity allowance changed"
        );
        require(eth.totalSupply() == supply, "reverted burn persisted");
        _reservesUnchanged(venue, address(eth), 100e6, 100 ether);
    }

    function test_ShortSwapInputCannotChangeReservesOrFundOutput() public {
        usdc.configure(false, false, false, 1);
        (bool ok, bytes memory reason) = address(venue)
            .call(
                abi.encodeCall(
                    venue.swap, (address(usdc), address(eth), 1e6, 0, address(this), block.number)
                )
            );
        _failure(
            ok,
            reason,
            abi.encodeWithSelector(
                AlphaForgeTestVenue.UnexpectedBalanceDelta.selector, address(usdc), 1e6, 1e6 - 1
            )
        );
        require(
            usdc.balanceOf(address(this)) == 900e6 && eth.balanceOf(address(this)) == 900 ether,
            "short swap changed caller balance"
        );
        require(
            usdc.allowance(address(this), address(venue)) == 100e6, "failed input consumed approval"
        );
        require(usdc.totalSupply() == 1_000e6, "failed input burned supply");
        _reservesUnchanged(venue, address(eth), 100e6, 100 ether);
    }

    function test_UnexpectedOutputDebitRollsBackUpdatedReservesAndCompletedInput() public {
        SenderDebitAsset output = new SenderDebitAsset();
        AlphaForgeTestVenue target =
            new AlphaForgeTestVenue(address(usdc), address(output), address(btc));
        usdc.approve(address(target), 101e6);
        output.approve(address(target), 100 ether);
        target.addLiquidity(address(usdc), address(output), 100e6, 100 ether);
        uint256 quote = target.quote(address(usdc), address(output), 1e6);
        (bool ok, bytes memory reason) = address(target)
            .call(
                abi.encodeCall(
                    target.swap,
                    (address(usdc), address(output), 1e6, quote, address(this), block.number)
                )
            );
        _failure(
            ok,
            reason,
            abi.encodeWithSelector(
                AlphaForgeTestVenue.UnexpectedBalanceDelta.selector,
                address(output),
                quote,
                quote + 1
            )
        );
        require(usdc.balanceOf(address(this)) == 800e6, "input survived failed output");
        require(
            usdc.allowance(address(this), address(target)) == 1e6, "input allowance not restored"
        );
        require(output.balanceOf(address(this)) == 900 ether, "partial output credit persisted");
        require(output.totalSupply() == 1_000 ether, "extra debit burned supply after rollback");
        _reservesUnchanged(target, address(output), 100e6, 100 ether);
    }

    function _reservesUnchanged(
        AlphaForgeTestVenue target,
        address asset,
        uint256 stable,
        uint256 risky
    ) private view {
        (uint256 a, uint256 b) = target.getReserves(address(usdc), asset);
        require(a == stable && b == risky, "reserve update survived failure");
        require(usdc.balanceOf(address(target)) == stable, "unfunded settlement reserve");
        require(ERC20(asset).balanceOf(address(target)) == risky, "unfunded asset reserve");
    }

    function _rejectVenue(address[3] memory tokens, bytes4 selector) private {
        try new AlphaForgeTestVenue(tokens[0], tokens[1], tokens[2]) returns (AlphaForgeTestVenue) {
            revert("invalid venue deployed");
        } catch (bytes memory reason) {
            require(
                keccak256(reason) == keccak256(abi.encodeWithSelector(selector)),
                "wrong venue constructor error"
            );
        }
    }

    function _rejectAdapter(address[4] memory tokens, bytes4 selector) private {
        try new AlphaForgeSwapAdapter(tokens[0], tokens[1], tokens[2], tokens[3]) returns (
            AlphaForgeSwapAdapter
        ) {
            revert("invalid adapter deployed");
        } catch (bytes memory reason) {
            require(
                keccak256(reason) == keccak256(abi.encodeWithSelector(selector)),
                "wrong adapter constructor error"
            );
        }
    }

    function _failure(bool ok, bytes memory reason, bytes memory expected) private pure {
        require(!ok && keccak256(reason) == keccak256(expected), "wrong rejection path");
    }
}
