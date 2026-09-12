> Migration note: original AF-CHAIN01 local-only foundation. Target ADR 0001, planning/security-boundary.json and DEVELOPMENT-TOOLCHAIN-STATUS.md take precedence. Historical verification is not current target acceptance; ENV-06 remains NOT_RUN.

# AlphaForge local contract foundation

AF-CHAIN01 / Macbeth04 · `TEST_ONLY` · **Testnet Writes = CLOSED**

This is a deterministic local toolchain and EIP-712 digest preview, not a Vault implementation. There is no asset handling, signature generation/verification, signer, RPC configuration, transaction submission, or network deployment script. Forge creates test instances only inside its in-memory EVM.

## Install and run

Supported reproducible environment for this lock: **macOS arm64, CPython 3.12** (tested host 3.12.9). Other platforms require their own reviewed binary/wheel hashes; do not bypass a hash or platform failure.

From `contracts/`:

```sh
python3.12 script/bootstrap.py
export PATH="$PWD/../.checks/af-chain01/toolchain/bin:$PWD/../.checks/af-chain01/toolchain/slither-venv/bin:$PATH"
forge build
forge test
forge fmt --check
bash script/check-local.sh
```

Bootstrap downloads only the fixed tool/dependency artifacts and installs into ignored project-local directories. It does not run remote installer scripts or modify root Node dependencies. A failed/incomplete download cannot be installed; a bad existing archive fails visibly and must be investigated. Re-running a verified archive installation is supported. Network is needed only to obtain build tools/dependencies, not for compilation/tests. `foundry.toml` points directly to the local compiler with auto-detection disabled and offline enabled.

`check-local.sh` validates archives/tool versions and the complete installed Slither dependency versions, then runs formatting, build, tests, and Slither with a clean child environment. Slither reports go to `../.checks/af-chain01/evidence/slither.json`; any finding produces a nonzero result for review. It does not offer RPC, broadcast, private-key, custom target, or other passthrough arguments. This is a constrained project check entry point, not a sandbox for arbitrary tools or code supplied by someone else.

## Project map

- `src/VaultIntentPreview.sol`: only `preview(Intent)` plus OpenZeppelin's EIP-712 domain inspection. Digest calculation does not validate or authorize an intent.
- `test/VaultIntentPreview.t.sol`: field and domain binding checks in the local EVM, plus an independent fixed EIP-712 reference vector; no keys/signatures.
- `test/intent-vector.json`: typed data and literal digest computed independently with the locked eth-account 0.14.0 package, using local chain ID 31337 and test-only address 0x1001.
- `script/bootstrap.py`, `script/check-local.sh`: local tool setup and deterministic checks; **no deployment script**.
- `toolchain.lock.json`, `requirements-slither.lock`, [TOOLCHAIN.md](TOOLCHAIN.md): exact inputs, official sources, digests, licenses and platform limits.
- [Vault v1 specification](../docs/migration/legacy-quantpass/tree/docs/contracts/VAULT-V1-SPEC.md), [Adapter boundary](../docs/migration/legacy-quantpass/tree/docs/contracts/ADAPTER-BOUNDARY.md), [verification](../docs/migration/legacy-quantpass/tree/docs/contracts/AF-CHAIN01-VERIFICATION.md).

## Canonical boundary

The [frozen Wave 1 contract v1](https://github.com/pdbsy/quantpass/blob/73230c43e464cd1b579fa16a6425756291ef9e8e/docs/management/wave1/WAVE1-INTERFACE-CONTRACT.md) controls public JSON names/types. Keep string `ownerId -> strategyId -> vaultId`, MoneyString/SignedMoneyString, `TEST_ONLY_USDT_UNIT` with six decimals, and the existing statuses. The ABI preview hashes strings using EIP-712's UTF-8 string hashing; it does not map them to addresses, registry IDs, or custody ownership.

`Intent.commandId` represents `Command.id`; `commandType` represents `Command.type`. ABI `amount` and `expectedRevision` are uint256 representations for local hash tests, not changes to JSON's MoneyString and safe-integer Revision. nonce/deadline/authorizationEpoch/policyHash are preview protocol fields, not new Wave 1 DTO properties. Asset ID/decimals are hash inputs; the preview does not approve assets or validate identifiers, commands, balances, deadlines, signatures, or replay state. No component should sign or execute its outputs.

Compilation targets **Paris** as a conservative deterministic local EVM baseline, not as a claim about Robinhood's current hardfork or contract compatibility. Robinhood Chain Testnet / 46630 remains target metadata only. Full Vault custody, EOA/ERC-1271 validation, grant revocation, nonce consumption, owner exit, adapter execution and chain finality are unimplemented and require separate review/frozen decisions.
