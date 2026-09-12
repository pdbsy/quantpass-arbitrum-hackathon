// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.31;

import { VaultIntentPreview } from "../src/VaultIntentPreview.sol";

interface Vm {
    function chainId(uint256 newChainId) external;
    function deal(address account, uint256 balance) external;
    function etch(address account, bytes calldata code) external;
}

contract VaultIntentPreviewTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    VaultIntentPreview private previewer;

    function setUp() public {
        previewer = new VaultIntentPreview();
    }

    // Fails if ownerId is omitted or replaced during typed-data encoding.
    function testFuzz_BindsOwnerId(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.ownerId = string.concat(intent.ownerId, "x");
        require(previewer.preview(intent) != beforeHash, "unbound ownerId");
    }

    // Fails if strategyId is omitted or replaced during typed-data encoding.
    function testFuzz_BindsStrategyId(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.strategyId = string.concat(intent.strategyId, "x");
        require(previewer.preview(intent) != beforeHash, "unbound strategyId");
    }

    // Fails if vaultId is omitted or replaced during typed-data encoding.
    function testFuzz_BindsVaultId(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.vaultId = string.concat(intent.vaultId, "x");
        require(previewer.preview(intent) != beforeHash, "unbound vaultId");
    }

    // Fails if commandId is omitted or replaced during typed-data encoding.
    function testFuzz_BindsCommandId(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.commandId = string.concat(intent.commandId, "x");
        require(previewer.preview(intent) != beforeHash, "unbound commandId");
    }

    // Fails if commandType is omitted or replaced during typed-data encoding.
    function testFuzz_BindsCommandType(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.commandType = string.concat(intent.commandType, "x");
        require(previewer.preview(intent) != beforeHash, "unbound commandType");
    }

    // Fails if assetId is omitted or replaced during typed-data encoding.
    function testFuzz_BindsAssetId(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.assetId = string.concat(intent.assetId, "x");
        require(previewer.preview(intent) != beforeHash, "unbound assetId");
    }

    // Fails if decimals is omitted or replaced during typed-data encoding.
    function testFuzz_BindsDecimals(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.decimals = intent.decimals ^ 1;
        require(previewer.preview(intent) != beforeHash, "unbound decimals");
    }

    // Fails if amount is omitted or replaced during typed-data encoding.
    function testFuzz_BindsAmount(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.amount = intent.amount ^ 1;
        require(previewer.preview(intent) != beforeHash, "unbound amount");
    }

    // Fails if expectedRevision is omitted or replaced during typed-data encoding.
    function testFuzz_BindsExpectedRevision(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.expectedRevision = intent.expectedRevision ^ 1;
        require(previewer.preview(intent) != beforeHash, "unbound expectedRevision");
    }

    // Fails if nonce is omitted or replaced during typed-data encoding.
    function testFuzz_BindsNonce(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.nonce = intent.nonce ^ 1;
        require(previewer.preview(intent) != beforeHash, "unbound nonce");
    }

    // Fails if deadline is omitted or replaced during typed-data encoding.
    function testFuzz_BindsDeadline(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.deadline = intent.deadline ^ 1;
        require(previewer.preview(intent) != beforeHash, "unbound deadline");
    }

    // Fails if authorizationEpoch is omitted or replaced during typed-data encoding.
    function testFuzz_BindsAuthorizationEpoch(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.authorizationEpoch = intent.authorizationEpoch ^ 1;
        require(previewer.preview(intent) != beforeHash, "unbound authorizationEpoch");
    }

    // Fails if policyHash is omitted or replaced during typed-data encoding.
    function testFuzz_BindsPolicyHash(VaultIntentPreview.Intent memory intent) public view {
        bytes32 beforeHash = previewer.preview(intent);
        intent.policyHash = bytes32(uint256(intent.policyHash) ^ 1);
        require(previewer.preview(intent) != beforeHash, "unbound policyHash");
    }

    function test_BindsVerifyingContract() public {
        VaultIntentPreview other = new VaultIntentPreview();
        VaultIntentPreview.Intent memory intent;
        require(previewer.preview(intent) != other.preview(intent), "unbound verifying contract");
    }

    function test_BindsCurrentChainAfterChainChange() public {
        VaultIntentPreview.Intent memory intent;
        bytes32 beforeHash = previewer.preview(intent);
        VM.chainId(block.chainid ^ 1);
        require(previewer.preview(intent) != beforeHash, "unbound current chain");
    }

    function test_RejectsOrdinaryEtherTransfer() public {
        VM.deal(address(this), 1);
        (bool success,) = address(previewer).call{ value: 1 }("");
        require(!success, "preview must not accept ordinary ETH transfers");
        require(address(previewer).balance == 0, "unexpected balance");
    }

    // Literal generated independently with eth-account encode_typed_data; no signatures or keys.
    function test_MatchesIndependentEip712Vector() public {
        VM.chainId(31337);
        VM.etch(address(0x1001), address(previewer).code);
        VaultIntentPreview fixedPreviewer = VaultIntentPreview(address(0x1001));
        VaultIntentPreview.Intent memory intent = VaultIntentPreview.Intent({
            ownerId: "owner-a",
            strategyId: "strategy-a",
            vaultId: "vault-a",
            commandId: "cmd-a",
            commandType: "requestWithdrawal",
            assetId: "TEST_ONLY_USDT_UNIT",
            decimals: 6,
            amount: 100000000,
            expectedRevision: 3,
            nonce: 7,
            deadline: 2000000000,
            authorizationEpoch: 2,
            policyHash: 0x1111111111111111111111111111111111111111111111111111111111111111
        });
        require(
            fixedPreviewer.preview(intent)
                == 0x807302018c381c7cadedd9affb05b2e32b74cdd1577037bfa136710ba72d858a,
            "EIP-712 reference mismatch"
        );
    }
}
