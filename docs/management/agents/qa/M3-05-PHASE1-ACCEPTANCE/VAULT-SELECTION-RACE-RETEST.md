# Vault-selection confirmation race retest

Reviewer: `Macbeth05`

Task: `M3-05-PHASE1-ACCEPTANCE`

Fix commit: `aa6c7648e13f46b98e14cf4474adbc48073ee8e0`

Fix tree: `fcd6d4446ab66705891052d08eac8508dccc2c5c`

Source base: `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`

Decision: `PASS_AT_04_WORKER_FIX / FINAL_CANDIDATE_INTEGRATION_PENDING`

Macbeth05 used two independent `--no-local` clones with separate `node_modules` directories and Node 24.21.0/npm 11.19.1. No remote status was read, no workflow was triggered, and no push, security-service call, signing, broadcast or Testnet write occurred.

## Independent red reproduction

The red checkout remained at base `3a78e34...` and received only the new `test/m3-browser-runtime-set.test.ts` from the fix commit. This isolates the test from the implementation. The focused file reported 9 tests, 5 pass and 4 fail. All four failures were `Missing expected rejection` for:

- Vault action confirmation while selection changed A→B during runtime-code checks;
- Pass transfer confirmation under the same change;
- deposit approval confirmation under the same change;
- A→B→A selection plus duplicate confirmation.

This independently confirms the candidate risk: before the fix, the reviewed Vault A operation can continue to the wallet after the selected Vault generation changes.

## Fix inspection

The fix binds each review to its runtime and selection generation, consumes it once, and passes a synchronous guard through Vault action, Pass transfer and deposit approval confirmation to `Eip1193Wallet.submit`. The wallet invokes the guard after its asynchronous simulation and final account/chain/session observations and immediately before calling `eth_sendTransaction`. No `await` or other callback boundary exists between the guard and that provider call.

If selection changed before that boundary, the guard throws `M3_VAULT_SELECTION_CHANGED`, no wallet send occurs, and the prior runtime is not published as wallet-pending. A→B→A still fails because the generation is monotonic. If selection changes only after `eth_sendTransaction` begins, the guard is already satisfied and the original runtime continues tracking the original Vault, owner and operation; the current Vault does not absorb that result.

## Independent green result

The fix checkout was detached at exact commit `aa6c764...`, tree `fcd6d44...`, and clean before and after validation.

| Check                                                  | Result                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Five related race/wallet/runtime test files            | `PASS`, 72/72                                                                        |
| TypeScript project checks                              | `PASS`                                                                               |
| ESLint                                                 | `PASS`                                                                               |
| Prettier check                                         | `PASS`                                                                               |
| Production web build                                   | `PASS`                                                                               |
| Base-to-fix `git diff --check`                         | `PASS`, empty                                                                        |
| Full `npm test` in default sandbox                     | `ENVIRONMENT_FAILURE`, 713/717; three loopback `EPERM` failures and one HTTP timeout |
| Full `npm test` with permitted local 127.0.0.1 binding | `PASS`, 717/717                                                                      |

The first full-suite attempt is not a source failure or a pass. Its four failures disappear when the existing loopback-only tests may bind locally. The permitted run uses local/mock services only.

## Persisted evidence

| Artifact                                           | Lines / bytes | SHA-256                                                            |
| -------------------------------------------------- | ------------: | ------------------------------------------------------------------ |
| `evidence/vault-selection-race-red.log`            |    75 / 3,857 | `bcc7352fd2cb1b78ba75615b5c74521605bf2553cd69827db658899a51e5836d` |
| `evidence/vault-selection-race-green.log`          |    80 / 7,303 | `6890cdb98be9c248b2e2ddf4d7e7a42da27e996f2c2c1490c0d43b2a088dd711` |
| `evidence/vault-selection-race-full-sandbox.log`   |  802 / 72,738 | `4956df5bd8e270a89890db1780480f139c2b371b591a76f48167585ed5e0a55d` |
| `evidence/vault-selection-race-full-permitted.log` |  742 / 70,129 | `2be17570c00fb19be08f7221538b9eb5bf3cac922c25c49e260858e6cd355f89` |

This closes Macbeth05's independent worker-fix retest. It does not change the identity of candidate `3a78e34...`; Macbeth01 must integrate the original Macbeth04 commit, regenerate candidate-bound evidence, and supply the new exact candidate before final acceptance.
