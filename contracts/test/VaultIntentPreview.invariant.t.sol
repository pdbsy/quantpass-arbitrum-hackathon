// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { VaultIntentPreview } from "../src/VaultIntentPreview.sol";

contract PreviewHandler {
    VaultIntentPreview public immutable PREVIEWER;
    bytes32 public immutable BASELINE;
    uint256 public calls;

    constructor(VaultIntentPreview target) {
        PREVIEWER = target;
        VaultIntentPreview.Intent memory intent;
        BASELINE = target.preview(intent);
    }

    function sample(VaultIntentPreview.Intent memory intent) public {
        bytes32 first = PREVIEWER.preview(intent);
        require(first == PREVIEWER.preview(intent), "nondeterministic digest");
        VaultIntentPreview.Intent memory empty;
        require(PREVIEWER.preview(empty) == BASELINE, "previous preview mutated domain or digest");
        calls++;
    }
}

contract VaultIntentPreviewInvariantTest {
    VaultIntentPreview private previewer;
    PreviewHandler private handler;
    address[] private targets;

    function setUp() public {
        previewer = new VaultIntentPreview();
        handler = new PreviewHandler(previewer);
        targets.push(address(handler));
    }

    function targetContracts() public view returns (address[] memory) {
        return targets;
    }

    function invariant_PreviewHistoryCannotChangeBaselineOrAcceptFunds() public view {
        VaultIntentPreview.Intent memory empty;
        require(previewer.preview(empty) == handler.BASELINE(), "preview mutated baseline");
        require(address(previewer).balance == 0, "unexpected funds");
    }
}
