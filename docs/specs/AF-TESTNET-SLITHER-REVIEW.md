# AlphaForge Testnet Slither Finding Review

State: **USER_APPROVED_TESTNET_ONLY**. The user directly confirmed this exact nine-finding scope on 2026-10-02, through 2026-11-01. This is Macbeth01 self-review with actual local behavioral tests; it is not independent security approval. No detector is suppressed. This document records a concrete proposal for the isolated Testnet-only contracts, through 2026-11-01. Mainnet remains excluded.

## Exact proposed scope

| ID             | Detector          | Severity        | Function                                    |
| -------------- | ----------------- | --------------- | ------------------------------------------- |
| `86cafb9de5f8` | reentrancy-no-eth | Medium / Medium | `AlphaForgeTradingVault.execute`            |
| `9cda1796d6b4` | reentrancy-benign | Low / Medium    | `AlphaForgeTradingVault.execute`            |
| `36b37c863dc3` | timestamp         | Low / Medium    | `AlphaForgeTradingVault._beginLiquidation`  |
| `3aac34772f19` | timestamp         | Low / Medium    | `AlphaForgeTradingVault._validateAuthority` |
| `92e9196be500` | timestamp         | Low / Medium    | `AlphaForgeTradingVault.checkRisk`          |
| `96f19323b824` | timestamp         | Low / Medium    | `AlphaForgeTradingVault.execute`            |
| `f26b5d023868` | timestamp         | Low / Medium    | `AlphaForgeTradingVault.authorizeExecutor`  |
| `f95399654a69` | timestamp         | Low / Medium    | `AlphaForgeTestReferenceFeed.update`        |
| `f95f7b27409e` | timestamp         | Low / Medium    | `AlphaForgeTradingVault._price`             |

The full IDs and exact source/test SHA-256 values are in `contracts/deployment/slither-admissions.json`. Any source/test change, new finding, metadata change, unknown finding, expiry or missing user approval blocks admission. The original scanner report remains unchanged in `.checks/market-data/testnet-slither-third-findings.json`; its SHA-256 is `6f7dc7b1764dd9bf4c18f95cbd535168118e424cb636030c6700e7eabd508ca1`. A fresh report is required on the final source; this dirty-tree diagnostic is not release C/R/S evidence.

## Two reentrancy findings

The scanner identifies post-router accounting and tracked-position count updates. Actual output is unknown until the swap, so it must be checked against real balance changes. Every mutable Vault entry uses the same OpenZeppelin nonReentrant guard; owner-only custody and typed single-pool routes constrain external effects. The local malicious-router tests attempt public risk reentry and malformed return/output/input movements, verifying rollback of cash, positions, approvals and state version. The official Factory/SwapRouter02/QuoterV2 test checks three real fee-3000 pools and full close.

Residual boundary: public read getters can expose pre-booking values during the router call. This Testnet version must not be used as a collateral/NAV oracle by another protocol. Offchain published values are read at committed canonical blocks. Platform automation still requires the exact owner grant; no withdrawal or arbitrary call is exposed. This proposal accepts that constrained read-only boundary; it does not claim zero risk.

## Seven timestamp findings

Comparisons enforce grant expiry, liquidation-window caps, order deadlines and feed staleness. They do not supply randomness or trading alpha. Tests cover rejected expired grants/past deadlines, forbidden buys at expiry, allowed final-second sells, blocked post-window execution, stop repetition that cannot extend authority, and stale/future/duplicate/zero prices. Chain timestamp and sequencer liveness remain dependencies. A stop latches sell-only intent; it cannot guarantee immediate fills when data or liquidity is unavailable.

## Actual diagnostics and approval state

The last full suite passed 174 tests. Three additional exact-time behavior cases subsequently passed in the 16-test trading suite, including 256 fuzz inputs. Logs and the earlier failed history remain under `.checks/market-data/`; a fresh full suite and all existing hosted gates are still required. Unoptimized trading runtime is 24,074 bytes (below EIP-170's 24,576-byte limit); the artifact gate must keep checking the limit. External-chain deployment, external wallet signing and public-chain execution are NOT_RUN.

The direct user confirmation changed only these nine entries to APPROVED_BY_USER. New, changed or expired findings remain blocked; this is explicit user risk acceptance, not independent security certification.

## 2026-10-10 additional Fair Launch approval

State: **USER_APPROVED_TESTNET_ONLY**, exact additional 44 findings. The user answered **“2接受 1是什么意思”** to the separate item asking whether to accept the reviewed residual risks for this Testnet test. That explicitly accepts item 2 only. It does not approve item 1, grant this test user's wallet administrator or LP ownership, or approve any deployment, funding, signing or broadcast operation by itself. The subsequent user correction says the new wallet is an ordinary user used to check the product.

This approval is restricted to Robinhood Chain Testnet, **chain ID 46630**, `ONCHAIN_TESTNET`, through the unchanged expiry **2026-11-01T00:00:00Z**. Mainnet is excluded. This is acceptance of the listed bounded residual risks, not a claim that 44 exploitable vulnerabilities were found, resolved or independently certified. The original nine approved finding objects and original six source/test bindings remain unchanged. The current admission set is exactly **53 = 9 + 44**; no detector or required check is suppressed.

The exact 44 IDs accepted below are those in the historical public review at source `bd85f4dfea144b481ab619d9d77821d6f809e453`. That historical review remains unchanged, including its then-correct `NOT_APPROVED_BY_USER` and failed admission states. Its SHA-256 is `b017f80cf6ac6c1232695a9f33961389da4aaa71b63263c0f91c24b42c11c4ad`; the raw 53-finding scanner report SHA-256 is `aae2eda5644056597974e6af6affcc3096ecb1e8f90c2266b46a189f788d6bd2`. The private non-secret approval receipt has SHA-256 `c074ef90e93630f625ca1900cc22db337ecdb36725a361b2b3ae89874f164288`. It preserves the user's original words and all exact approved IDs; it is not a wallet signature or public-chain receipt.

### Exact admitted scope and controls

`contracts/deployment/slither-admissions.json` schema v2 binds all **55 current Solidity source and test files** by SHA-256, including the four Fair Launch and strategy Vault behavioral test files. Their bytes match the existing scanner source `223d0d1b417b5b4de42319d3ed6bccbaf9a26126` and the reviewed source above. Changed files, newly added Solidity source/test files, new or changed finding IDs/severity/confidence/type/identity, missing approval, and expiry remain blocked. The two `missing-inheritance` records are bound to their exact `contract` elements; every other record remains bound to its exact `function` element. The top-level `findingSourcePaths` map binds each of the 53 exact finding IDs to its actual source file, so another already-reviewed file cannot be substituted. There is no arbitrary function-to-contract fallback.

Both static gate entry points, `contracts/script/slither_admissions.py` and `tools/ci/slither-review.mjs`, require the same exact v2 approval scope: chain 46630, `ONCHAIN_TESTNET`, `mainnetAuthorized=false`, and `RESIDUAL_RISK_ACCEPTANCE_ONLY`. Successful evaluation returns `deploymentAuthorized=false`. These static gates do not observe a live network and do not authorize execution. Any future execution consumer must pass its independently observed chain/environment to the validator's `execution_context` / `executionContext` parameter, enforce the returned scope, and separately validate the user's concrete operation and funding permissions before signing or broadcasting. Legacy schema v1 exists only to reproduce the nine-finding historical scope; it cannot qualify an execution context or admit contract-type findings. Existing signing tools are not changed by this approval.

The admitted rationales and exact existing test references remain per finding in the admission JSON. They cover deliberate exact token settlement, guarded call-order accounting, quote/session/deadline/day-boundary policies, fixed ECDSA and CREATE assembly, structural interfaces, and compiler-generated creation bytecode. The underlying sequencer timestamp, external liquidity, reference-data, and read-only pre-booking value boundaries remain dependencies. The underlying behavioral evidence is historical and is not relabeled as a new target Testnet run.

### Additional approved IDs

| Exact ID                                                           | Detector              | Bound element                                               |
| ------------------------------------------------------------------ | --------------------- | ----------------------------------------------------------- |
| `137ccdc38208685f9424206febe411aed55d4bba5745bd9670598e34c99416f4` | `incorrect-equality`  | `function:AlphaForgeStrategyVault._swap`                    |
| `1564ef38fb729bdd5cf74eb6ed3c4c7df6845fe80240cfaf8d8d6d22b2f64dd8` | `incorrect-equality`  | `function:AlphaForgeStockReserve._send`                     |
| `233bc491e7f6f7b937cc6f8e690887e46414ee2c1583c4d2095195df971d3144` | `incorrect-equality`  | `function:AlphaForgePassPool._pull`                         |
| `3be41fe189ab2119eb2a0e5e2fad1e071264fe77b1286c8e6978a098eabc7374` | `incorrect-equality`  | `function:AlphaForgeStockReserve._pull`                     |
| `5677944bcb5e0c760ae06214bbc620e5a66377c18df24c49d90018d9e05d4e76` | `incorrect-equality`  | `function:AlphaForgePassPool._send`                         |
| `69e3ea05479db540275902128ad0c62de0dbbba818be7fa4e3f8bc0572d4907d` | `incorrect-equality`  | `function:AlphaForgeMarketRouter.buyNative`                 |
| `82c9e1b44ebdfe51ab519530a25e178d40e2cf35a7de1a693a63673333593edf` | `incorrect-equality`  | `function:AlphaForgeNativeReserve._sendUsdc`                |
| `911e6a560a2c9ee9fefa34ed32b0ffea96743f858b3ff740ae208b151c94e8c2` | `incorrect-equality`  | `function:AlphaForgeMarketRouter.sellNative`                |
| `9db04788adbcdc8b6febd4868805e64c70df4e463d75fc964301042c87099936` | `incorrect-equality`  | `function:AlphaForgeClaimReserve.claim`                     |
| `b3d5f4f0b15510a0a06e9b4e95899866915942d9b5e05ec7386bf219adced92f` | `incorrect-equality`  | `function:AlphaForgeMarketRouter.sellNative`                |
| `b5e6ec29f9c6a2dd9f37a86c93146a9c9725acc6516026ce678f5d52bdb9cd3e` | `incorrect-equality`  | `function:AlphaForgeClaimReserve.fund`                      |
| `c9d8d538a4fc89afcd8f2714152dafa65d6d2073fdc6e36c9eed68bb44a6dd1e` | `incorrect-equality`  | `function:AlphaForgeFairLaunch._deliver`                    |
| `d5300ee99aaffe9283b80dd57a1a35db475ba1b7bd58558855f2b76c5da106df` | `incorrect-equality`  | `function:AlphaForgeFairLaunch.subscribeUsdc`               |
| `eedcb38dbdd44aeb84dd4720ce07c8232f7e9754a54c9b7aaad79ce3c936f8df` | `incorrect-equality`  | `function:AlphaForgeFairLaunch._launch`                     |
| `f124e0236d125e0ea5ad8e2434891292c8059724a2b9cd1d06799365437df7df` | `incorrect-equality`  | `function:AlphaForgeMarketRouter.buyNative`                 |
| `f172a25f92186b83351fd4c5f7a686cb21a3835984dbbc746acdf34209d68388` | `incorrect-equality`  | `function:AlphaForgePassFactory.createPool`                 |
| `f5af3875f8fd207dca458c0adf59ce5b7072b4d1f37c24e3e862e0dba330da5b` | `incorrect-equality`  | `function:AlphaForgeMarketRouter.sellNative`                |
| `f65943201e83c729457e16c1394012c8b9c64895bba7c4b39c25e660b16ae99e` | `incorrect-equality`  | `function:AlphaForgePassFactory._pull`                      |
| `ffc568684a70437b3c50869856e8bc135a34ce8cdace427b817a0c686307c9c4` | `incorrect-equality`  | `function:AlphaForgeNativeReserve._pullUsdc`                |
| `a37ad672596d76087a63cbb4f6d106aa5d5a998f86063f4c96161469c0632e71` | `reentrancy-no-eth`   | `function:AlphaForgeStrategyVault.execute`                  |
| `ef3f83c701e562a0472f48f4c13ceb90b5afe237d8f90f36558e6346bc3dd877` | `reentrancy-no-eth`   | `function:AlphaForgeFairLaunch.subscribeEth`                |
| `31c384885b9a55946e00dcdffea7c85885bc990143cd22d64446d2090d4a7751` | `reentrancy-benign`   | `function:AlphaForgeFairLaunch._launch`                     |
| `6f2c3f7ca6084d6bbf260090befe7e25db8c6c279e2e916348b895bccdda800c` | `reentrancy-benign`   | `function:AlphaForgeStrategyVault.execute`                  |
| `4a63348ae4726b265c9476bf3022f93ef48e42052256753df65ec84a41f05463` | `timestamp`           | `function:AlphaForgeStockReserve.swap`                      |
| `5fda3fb48a04088937c1cb21db4d281b5be6a64dd469773d593c132a678d07c2` | `timestamp`           | `function:AlphaForgeNativeReserve._spendBudget`             |
| `6ff9fd9158ca809e61f8392c2d8620de4b2ac2904a8f4a0f0e575408720c0cb6` | `timestamp`           | `function:AlphaForgeStrategyVault.stockPrice`               |
| `76d2affa348d7829f578376f9d237612bb7bdea15ab6c499b6841f8861d0463c` | `timestamp`           | `function:AlphaForgeStrategyVault.configureExecutor`        |
| `77c053440b1660547d91803f6e019ed266057b38c44c6c97fb2116e8670e383b` | `timestamp`           | `function:AlphaForgeStrategyReferenceFeed.updateSession`    |
| `7aa72c63e2c66a31f3527e950472d5ab1cd605450d851cbbb15c14adb8523d4c` | `timestamp`           | `function:AlphaForgeStrategyReferenceFeed.update`           |
| `96833d68d0b9a2b5691749efe7fab61b8ecfe277079b7d31ec6d142b86a9fd85` | `timestamp`           | `function:AlphaForgeFairLaunch._validate`                   |
| `b9714ead05dbfef522aef985bb0a9eb477296ee505d370a03917e9f909a4bdd3` | `timestamp`           | `function:AlphaForgeStrategyReferenceFeed.executionAllowed` |
| `c6517fe88fdd8bdad3942ae13722b85c536a647f8995b87e3f52d0ecd8cd2015` | `timestamp`           | `function:AlphaForgeStockReserve.price`                     |
| `d50548cb33e6d11680ea0437c198b5676ea900a1db3f10e5572b014804db709b` | `timestamp`           | `function:AlphaForgePassPool._validate`                     |
| `e555af105852eb04493ff8bd29cda41c7d136eb6a8c39b1ca6274475564ccc20` | `timestamp`           | `function:AlphaForgeClaimReserve.claim`                     |
| `ead7f741fc659f96b8ea0adeee6b3a0adbb7013a674b85af04433fa1673ba88e` | `timestamp`           | `function:AlphaForgeStrategyVault._validateExecution`       |
| `ef640adc4166a72e4eb3fef1522fb83aa305ac91fbb4dea8f3454b8fa1388f9d` | `timestamp`           | `function:AlphaForgeNativeReserve._consume`                 |
| `2f121d22f10a0a9a0492a7f59ce168534bbb7b7efde84307370fa99764fa54c6` | `assembly`            | `function:AlphaForgeStrategyVaultFactory.createVault`       |
| `45ff9f688a936978caf6f89c4eb0a5bb38bae910cda2a501545171d546e2d22c` | `assembly`            | `function:AlphaForgeStrategyVaultFactory.constructor`       |
| `50b4366901aa97c2e0d8c20713deea3c781ed90e013a39b79dbd8329fdf424ff` | `assembly`            | `function:MarketTypes.signer`                               |
| `7aaf61a54e1767c274d67c6c8ed2dd74ee84757c3fceaba5df607dd3aee7e454` | `assembly`            | `function:AlphaForgeStrategyVaultFactory._creationCode`     |
| `e9a8e345a1b722e30abeccc0065d62958ffe463a5bb4f5ade488e2fa56f24db2` | `assembly`            | `function:AlphaForgeVaultCodePart.constructor`              |
| `986ce0cb4e8b1125b93b4bb75b19d055380e7626cfd5b0f75a1b53af487f15db` | `missing-inheritance` | `contract:AlphaForgeStrategyReferenceFeed`                  |
| `b41c45933afcac58b27e671597d422452d3e0b88c668158cc87be5175e13afb4` | `missing-inheritance` | `contract:AlphaForgeStockReserve`                           |
| `6777c45c6d52daed517650d3c24295ce0604801d859d96291e06b639ccdfd828` | `too-many-digits`     | `function:AlphaForgeStrategyVaultFactory.constructor`       |

### Validation for this approval update

The actual targeted Node admission/evidence tests passed **41 tests**, with **1 existing platform-dependent skip**; Python admission tests passed **6 tests**. Both validators reevaluated the retained unmodified 53-finding report and admitted exactly 53, while returning `deploymentAuthorized=false`. Scoped ESLint, Prettier and diff whitespace checks passed. The default sandbox blocked the existing test helper’s `mkfifo` process; the same bounded Node tests passed when run with the needed local process permission. This environment failure is preserved in the approval verification record.

A fresh Slither scan, hosted checks on the resulting commit, independent patch review, target Testnet deployment and target transactions are **NOT_RUN** by this document update. Reevaluation is valid here because every Solidity source and test byte is unchanged; the raw pedantic finding exit remains 255 and its historical failure is preserved.

### Independent review correction: per-finding source binding

Independent review identified that the first approval patch checked membership in the complete 55-file source set but did not require each finding to remain in its own reviewed file. The first patch’s validation snapshot is preserved as `slither44-admission-verification-20261010.json`; it is not evidence for this corrected patch. The correction adds a complete 53-entry `findingSourcePaths` map to schema v2, derived from the unchanged raw scanner report. Both validators require exact ID coverage and exact equality between each finding’s actual source path and its reviewed mapping. Tests attempt to relabel both a function finding and a contract finding to a different file already included in the hash-bound review, and require rejection. No finding approval, original nine entry, source hash, expiry or chain scope is broadened. Corrected validation is recorded separately in `slither44-admission-verification-20261010-v2.json`.

The corrected patch’s actual Node admission/evidence result is **42 PASS, 0 FAIL, 1 existing SKIP**; Python is **7 PASS, 0 FAIL**. Both validators admit the unchanged raw 53 findings and reject in-memory function/contract report variants relabeled to the already-reviewed `contracts/src/AlphaForgeTestStock.sol`. Scoped lint, formatting and whitespace checks pass. Independent final patch review and new-head hosted checks remain separate requirements.
