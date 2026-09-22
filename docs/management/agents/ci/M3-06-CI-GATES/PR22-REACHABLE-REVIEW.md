# Macbeth06 PR22 reachable coverage review

Scope: AlphaForge / Robinhood Chain Testnet / Hackathon. Engineering evidence only; no merge, deployment, signing or broadcast. Macbeth01 owns final integration, C/R/S evidence and hosted CI. XLayer remains paused.

Measured source: `6b53cddba1a59c47e0635374159f3ac83c122896`, tree `310be66d694c8512e09a9d2742b994b0e91be638`. Fixed source baseline: `f966dd2e0772f6953e7315816b52aa53316c7eae`. The later documentation commit is not represented as an independently measured candidate.

Qualified report SHA-256: `d51dfa1dd9cbed4e6e4eb1f5ace650a0907bf2129c3605bdd2e6efc2c9dded7a`. Tool digest: `380b1ba55eb71082f9b76cb6e7cc577d0c4a4d68fdd60a216d5342619357cbc0`. Classification ledger: `outputs/pr22-macbeth06/classified-6b53cdd-reviewed.json`, SHA-256 `73fba19cc8fb9a5d83a82e28d1dbf4ba0f61188e6cb2341e36b9c89a73c8d3f6`. Original 296 assigned gap IDs are all retained. Each source comparison requires identical source SHA-256 and complete branch map; changed graphs are separately measured.

## Verified behavior and review

- Privacy now rejects a tracked regular file replaced by a directory, including a nonregular opened handle. The original regression failed against the old implementation.
- Privacy opens with O_NONBLOCK where provided, preventing an actual file-to-FIFO race from indefinitely waiting for a writer. The retained RED timed out at 5 seconds; the fixed actual FIFO test completed in about 100 milliseconds.
- Gitleaks checks that source-root `.gitleaksignore` is absent before and after scanning. Actual pinned 8.30.1 reproduction confirmed that a source ignore suppressed a synthetic never-issued canary in both git and directory modes despite the separate explicit ignore argument. Raw findings are redacted, and the existing approved historical disposition remains separately recorded.
- Macbeth05 independently reproduced the directory/FIFO and root-ignore defects and reviewed the production fixes through `70b328d1576fc2b73f2eeae275155f76b7b699c6` without blocking findings. The final Python qualification delta at 6b53cdd also passed independent actual Semgrep testing. Macbeth05 accepted 28 bounded proofs and refuted three; the three are retained as OPEN here. This engineering review is not GitHub approval.

## Validation and retained failures

- Candidate 6b53cdd: 263 assertion-bearing targeted tests pass, with no skips, including the real Semgrep 1.177.0 engine, 22 rules and 44 controls. Negative qualification verifies missing rules, invalid language, missed positives and contaminated negatives.
- The qualified test requires all 66 platform wheels already present and hash-correct. It verifies exact real CPython 3.12.9 and native architecture before bootstrap. macOS exposes the verified Python directory only during isolated bootstrap and restores PATH afterwards. Production local-ci admission is unchanged.
- At 70b328d, the instrumented batch retained 262 PASS / 1 FAIL: the isolated runner PATH excluded the installed Python. The failed measurement is not counted. Candidate 6b53cdd fixes only the native test prerequisite and obtains fresh passing measurement.
- Actual pinned Gitleaks current-file and full locally fetched history workflows pass. Its approved historical finding remains raw FAIL with scanner exit 10, while the separately verified disposition is PASS. No raw scanner evidence is rewritten.
- Formatting, lint and diff checks passed for code/test deliveries. Normal three-platform tests must register `test/security-reachable-closeout.test.mjs`; `test/security-engine-failures.qualified.test.mjs` belongs only in a separate native qualification workflow. Macbeth01 owns those shared registrations.

## Original gap classification

HIT means a nonzero original-graph counter from the passing targeted workflow. CHANGED retains an old gap without reusing its numeric counter in the new graph. INVARIANT-REVIEWED is a bounded source argument independently accepted by Macbeth05, not a fabricated hit. PLATFORM-NOT-RUN requires the stated native or ephemeral-host prerequisite. OPEN remains reachable and unverified.

| Classification | Count |
| --- | ---: |
| HIT | 130 |
| INVARIANT-REVIEWED | 9 |
| OPEN | 67 |
| PLATFORM-NOT-RUN | 34 |
| CHANGED | 56 |

| Original gap ID | Classification | Source line |
| --- | --- | ---: |
| `tools/agent-identity-set.mjs::1::1` | HIT | 6 |
| `tools/agent-identity-set.mjs::2::1` | HIT | 7 |
| `tools/agent-identity-set.mjs::3::0` | HIT | 11 |
| `tools/agent-identity-set.mjs::5::0` | HIT | 15 |
| `tools/agent-identity-set.mjs::9::0` | HIT | 19 |
| `tools/agent-identity-set.mjs::14::0` | HIT | 29 |
| `tools/agent-identity.mjs::16::0` | INVARIANT-REVIEWED | 59 |
| `tools/agent-integration-identity.mjs::8::0` | OPEN | 81 |
| `tools/agent-integration-identity.mjs::14::0` | HIT | 120 |
| `tools/agent-integration-identity.mjs::15::0` | HIT | 121 |
| `tools/agent-integration-identity.mjs::15::1` | HIT | 121 |
| `tools/agent-integration-identity.mjs::24::0` | OPEN | 172 |
| `tools/agent-integration-identity.mjs::25::1` | INVARIANT-REVIEWED | 183 |
| `tools/bootstrap-ci-npm.mjs::0::0` | HIT | 10 |
| `tools/bootstrap-ci-npm.mjs::0::1` | PLATFORM-NOT-RUN | 10 |
| `tools/bootstrap-ci-npm.mjs::1::0` | HIT | 11 |
| `tools/bootstrap-ci-npm.mjs::1::1` | HIT | 11 |
| `tools/bootstrap-ci-npm.mjs::1::2` | HIT | 11 |
| `tools/bootstrap-ci-npm.mjs::1::3` | HIT | 11 |
| `tools/bootstrap-ci-npm.mjs::1::4` | HIT | 11 |
| `tools/bootstrap-ci-npm.mjs::1::5` | HIT | 11 |
| `tools/bootstrap-ci-npm.mjs::2::0` | PLATFORM-NOT-RUN | 22 |
| `tools/bootstrap-ci-npm.mjs::2::1` | PLATFORM-NOT-RUN | 22 |
| `tools/bootstrap-ci-npm.mjs::3::0` | PLATFORM-NOT-RUN | 38 |
| `tools/bootstrap-ci-npm.mjs::3::1` | PLATFORM-NOT-RUN | 38 |
| `tools/bootstrap-ci-npm.mjs::4::0` | PLATFORM-NOT-RUN | 46 |
| `tools/bootstrap-ci-npm.mjs::4::1` | PLATFORM-NOT-RUN | 46 |
| `tools/bootstrap-ci-npm.mjs::5::0` | PLATFORM-NOT-RUN | 46 |
| `tools/bootstrap-ci-npm.mjs::5::1` | PLATFORM-NOT-RUN | 46 |
| `tools/check-agent-identity.mjs::0::0` | HIT | 11 |
| `tools/check-agent-identity.mjs::1::0` | HIT | 14 |
| `tools/check-agent-identity.mjs::2::0` | HIT | 16 |
| `tools/check-agent-identity.mjs::4::0` | HIT | 24 |
| `tools/check-agent-identity.mjs::5::0` | OPEN | 30 |
| `tools/check-agent-identity.mjs::6::1` | OPEN | 36 |
| `tools/check-agent-identity.mjs::9::0` | HIT | 39 |
| `tools/check-agent-identity.mjs::13::3` | HIT | 49 |
| `tools/check-agent-identity.mjs::14::2` | OPEN | 50 |
| `tools/check-agent-identity.mjs::15::5` | OPEN | 52 |
| `tools/check-agent-identity.mjs::22::0` | OPEN | 70 |
| `tools/check-agent-identity.mjs::25::0` | OPEN | 82 |
| `tools/check-agent-identity.mjs::26::0` | OPEN | 83 |
| `tools/check-agent-identity.mjs::26::1` | OPEN | 83 |
| `tools/check-agent-identity.mjs::27::0` | OPEN | 84 |
| `tools/check-agent-identity.mjs::27::1` | OPEN | 84 |
| `tools/check-agent-identity.mjs::27::2` | OPEN | 84 |
| `tools/check-agent-identity.mjs::27::3` | OPEN | 84 |
| `tools/check-agent-identity.mjs::27::4` | OPEN | 84 |
| `tools/check-agent-identity.mjs::28::0` | OPEN | 97 |
| `tools/check-agent-identity.mjs::28::1` | OPEN | 97 |
| `tools/check-agent-identity.mjs::30::0` | HIT | 111 |
| `tools/check-agent-identity.mjs::31::0` | HIT | 112 |
| `tools/check-agent-identity.mjs::31::1` | OPEN | 112 |
| `tools/check-agent-identity.mjs::32::1` | OPEN | 118 |
| `tools/check-environment.mjs::0::0` | HIT | 5 |
| `tools/check-environment.mjs::1::0` | HIT | 7 |
| `tools/check-environment.mjs::1::1` | OPEN | 7 |
| `tools/check-environment.mjs::2::0` | HIT | 7 |
| `tools/check-environment.mjs::2::1` | HIT | 7 |
| `tools/check-environment.mjs::3::0` | OPEN | 9 |
| `tools/check-environment.mjs::3::1` | OPEN | 9 |
| `tools/check-environment.mjs::4::0` | OPEN | 11 |
| `tools/check-environment.mjs::4::1` | OPEN | 11 |
| `tools/check-environment.mjs::5::0` | OPEN | 18 |
| `tools/check-environment.mjs::5::1` | HIT | 18 |
| `tools/check-environment.mjs::6::0` | HIT | 18 |
| `tools/check-environment.mjs::6::1` | HIT | 18 |
| `tools/check-environment.mjs::7::0` | HIT | 21 |
| `tools/check-environment.mjs::7::1` | OPEN | 21 |
| `tools/check-environment.mjs::8::0` | HIT | 21 |
| `tools/check-environment.mjs::8::1` | HIT | 21 |
| `tools/check-local-agent-integration.mjs::0::0` | HIT | 7 |
| `tools/check-local-agent-integration.mjs::1::0` | HIT | 11 |
| `tools/check-public-metadata.mjs::33::0` | CHANGED | 312 |
| `tools/check-public-metadata.mjs::44::0` | CHANGED | 372 |
| `tools/check-public-metadata.mjs::56::0` | CHANGED | 408 |
| `tools/check-public-metadata.mjs::62::0` | CHANGED | 429 |
| `tools/check-public-metadata.mjs::63::0` | CHANGED | 431 |
| `tools/check-public-metadata.mjs::79::0` | CHANGED | 472 |
| `tools/check-public-metadata.mjs::91::1` | CHANGED | 510 |
| `tools/check-public-metadata.mjs::96::1` | CHANGED | 532 |
| `tools/check-public-metadata.mjs::101::1` | CHANGED | 545 |
| `tools/check-public-metadata.mjs::104::1` | CHANGED | 552 |
| `tools/check-public-metadata.mjs::105::0` | CHANGED | 560 |
| `tools/check-public-metadata.mjs::106::0` | CHANGED | 561 |
| `tools/check-public-metadata.mjs::129::1` | CHANGED | 624 |
| `tools/check-public-metadata.mjs::134::1` | CHANGED | 643 |
| `tools/check-public-metadata.mjs::149::1` | CHANGED | 689 |
| `tools/check-public-metadata.mjs::150::0` | CHANGED | 690 |
| `tools/check-public-metadata.mjs::215::1` | CHANGED | 872 |
| `tools/check-public-metadata.mjs::225::0` | CHANGED | 900 |
| `tools/check-public-metadata.mjs::240::0` | CHANGED | 932 |
| `tools/check-public-metadata.mjs::261::0` | CHANGED | 1000 |
| `tools/check-public-metadata.mjs::267::1` | CHANGED | 1017 |
| `tools/check-public-metadata.mjs::268::0` | CHANGED | 1028 |
| `tools/check-public-metadata.mjs::268::1` | CHANGED | 1028 |
| `tools/check-public-metadata.mjs::269::0` | CHANGED | 1028 |
| `tools/check-public-metadata.mjs::269::1` | CHANGED | 1028 |
| `tools/check-public-metadata.mjs::272::0` | CHANGED | 1045 |
| `tools/check-public-metadata.mjs::276::0` | CHANGED | 1069 |
| `tools/check-public-metadata.mjs::285::0` | CHANGED | 1084 |
| `tools/check-public-metadata.mjs::286::0` | CHANGED | 1085 |
| `tools/check-public-metadata.mjs::286::1` | CHANGED | 1085 |
| `tools/check-public-metadata.mjs::287::0` | CHANGED | 1085 |
| `tools/check-public-metadata.mjs::287::1` | CHANGED | 1085 |
| `tools/check-public-metadata.mjs::304::0` | CHANGED | 1129 |
| `tools/check-public-metadata.mjs::309::0` | CHANGED | 1161 |
| `tools/check-public-metadata.mjs::311::1` | CHANGED | 1176 |
| `tools/check-public-metadata.mjs::312::0` | CHANGED | 1187 |
| `tools/check-public-metadata.mjs::314::1` | CHANGED | 1205 |
| `tools/check-public-metadata.mjs::315::0` | CHANGED | 1207 |
| `tools/check-public-metadata.mjs::315::1` | CHANGED | 1207 |
| `tools/check-public-metadata.mjs::316::0` | CHANGED | 1210 |
| `tools/check-public-metadata.mjs::317::0` | CHANGED | 1218 |
| `tools/check-public-metadata.mjs::319::0` | CHANGED | 1240 |
| `tools/check-public-metadata.mjs::321::0` | CHANGED | 1255 |
| `tools/check-public-metadata.mjs::323::0` | CHANGED | 1265 |
| `tools/check-public-metadata.mjs::327::0` | CHANGED | 1285 |
| `tools/check-public-metadata.mjs::332::1` | CHANGED | 1312 |
| `tools/check-secrets.mjs::0::0` | HIT | 36 |
| `tools/check-secrets.mjs::0::1` | HIT | 36 |
| `tools/check-secrets.mjs::1::0` | HIT | 36 |
| `tools/check-secrets.mjs::1::1` | HIT | 36 |
| `tools/check-secrets.mjs::1::2` | HIT | 36 |
| `tools/check-secrets.mjs::2::0` | HIT | 40 |
| `tools/check-secrets.mjs::4::0` | HIT | 44 |
| `tools/check-secrets.mjs::5::0` | HIT | 47 |
| `tools/check-secrets.mjs::6::1` | HIT | 54 |
| `tools/check-supply-chain.mjs::10::1` | HIT | 132 |
| `tools/check-supply-chain.mjs::11::1` | HIT | 133 |
| `tools/check-supply-chain.mjs::14::1` | HIT | 150 |
| `tools/check-supply-chain.mjs::15::1` | HIT | 150 |
| `tools/check-supply-chain.mjs::16::1` | HIT | 154 |
| `tools/check-supply-chain.mjs::17::1` | HIT | 154 |
| `tools/check-supply-chain.mjs::23::0` | HIT | 200 |
| `tools/check-supply-chain.mjs::28::1` | HIT | 270 |
| `tools/check-supply-chain.mjs::30::1` | INVARIANT-REVIEWED | 282 |
| `tools/check-supply-chain.mjs::36::0` | OPEN | 395 |
| `tools/check-supply-chain.mjs::41::3` | OPEN | 425 |
| `tools/check-supply-chain.mjs::50::0` | OPEN | 562 |
| `tools/check-supply-chain.mjs::55::0` | OPEN | 601 |
| `tools/check-supply-chain.mjs::55::1` | INVARIANT-REVIEWED | 601 |
| `tools/ci/check-dependency-delta.mjs::3::0` | HIT | 17 |
| `tools/ci/check-dependency-delta.mjs::12::0` | HIT | 47 |
| `tools/ci/check-dependency-delta.mjs::15::0` | HIT | 54 |
| `tools/ci/check-dependency-delta.mjs::18::0` | HIT | 59 |
| `tools/ci/check-dependency-delta.mjs::26::0` | HIT | 68 |
| `tools/ci/check-dependency-delta.mjs::27::0` | HIT | 68 |
| `tools/ci/check-dependency-delta.mjs::27::1` | HIT | 68 |
| `tools/ci/check-dependency-delta.mjs::30::1` | HIT | 76 |
| `tools/ci/check-dependency-delta.mjs::33::0` | OPEN | 90 |
| `tools/ci/check-dependency-delta.mjs::35::0` | INVARIANT-REVIEWED | 98 |
| `tools/ci/check-gitleaks.mjs::0::0` | CHANGED | 21 |
| `tools/ci/check-gitleaks.mjs::3::0` | CHANGED | 35 |
| `tools/ci/check-gitleaks.mjs::5::0` | CHANGED | 40 |
| `tools/ci/check-gitleaks.mjs::8::0` | CHANGED | 119 |
| `tools/ci/check-gitleaks.mjs::10::0` | CHANGED | 129 |
| `tools/ci/check-gitleaks.mjs::12::0` | CHANGED | 138 |
| `tools/ci/check-gitleaks.mjs::13::1` | CHANGED | 149 |
| `tools/ci/check-gitleaks.mjs::14::0` | CHANGED | 156 |
| `tools/ci/check-gitleaks.mjs::15::0` | CHANGED | 159 |
| `tools/ci/check-gitleaks.mjs::16::0` | CHANGED | 161 |
| `tools/ci/check-semgrep.mjs::0::0` | HIT | 43 |
| `tools/ci/check-semgrep.mjs::2::0` | HIT | 54 |
| `tools/ci/check-semgrep.mjs::5::0` | HIT | 62 |
| `tools/ci/check-semgrep.mjs::6::0` | HIT | 65 |
| `tools/ci/check-source-policy.mjs::7::0` | OPEN | 49 |
| `tools/ci/check-source-policy.mjs::8::0` | OPEN | 59 |
| `tools/ci/context.mjs::1::0` | HIT | 29 |
| `tools/ci/context.mjs::4::0` | HIT | 35 |
| `tools/ci/context.mjs::5::2` | HIT | 35 |
| `tools/ci/context.mjs::12::0` | HIT | 71 |
| `tools/ci/context.mjs::13::1` | HIT | 73 |
| `tools/ci/context.mjs::14::0` | HIT | 73 |
| `tools/ci/context.mjs::14::1` | HIT | 73 |
| `tools/ci/context.mjs::17::0` | HIT | 78 |
| `tools/ci/verify-contracts.mjs::8::0` | OPEN | 44 |
| `tools/ci/verify-contracts.mjs::10::1` | OPEN | 51 |
| `tools/ci/verify-contracts.mjs::12::0` | OPEN | 53 |
| `tools/ci/workflow-contract.mjs::10::0` | HIT | 51 |
| `tools/environment/observe.mjs::3::1` | PLATFORM-NOT-RUN | 33 |
| `tools/environment/observe.mjs::4::0` | HIT | 36 |
| `tools/environment/observe.mjs::7::0` | HIT | 45 |
| `tools/environment/observe.mjs::9::0` | OPEN | 80 |
| `tools/environment/observe.mjs::11::0` | HIT | 99 |
| `tools/environment/observe.mjs::12::0` | OPEN | 100 |
| `tools/environment/observe.mjs::34::0` | HIT | 177 |
| `tools/environment/observe.mjs::57::0` | OPEN | 243 |
| `tools/environment/observe.mjs::58::0` | OPEN | 243 |
| `tools/environment/observe.mjs::60::0` | OPEN | 243 |
| `tools/environment/observe.mjs::65::1` | INVARIANT-REVIEWED | 264 |
| `tools/environment/observe.mjs::75::1` | OPEN | 347 |
| `tools/environment/observe.mjs::76::0` | PLATFORM-NOT-RUN | 349 |
| `tools/environment/observe.mjs::78::0` | PLATFORM-NOT-RUN | 353 |
| `tools/environment/observe.mjs::79::2` | HIT | 357 |
| `tools/environment/observe.mjs::81::1` | PLATFORM-NOT-RUN | 366 |
| `tools/environment/observe.mjs::82::1` | PLATFORM-NOT-RUN | 368 |
| `tools/environment/observe.mjs::84::0` | OPEN | 373 |
| `tools/environment/observe.mjs::84::1` | OPEN | 373 |
| `tools/environment/observe.mjs::84::2` | OPEN | 373 |
| `tools/environment/observe.mjs::85::0` | PLATFORM-NOT-RUN | 377 |
| `tools/environment/observe.mjs::85::1` | PLATFORM-NOT-RUN | 377 |
| `tools/environment/observe.mjs::86::0` | PLATFORM-NOT-RUN | 379 |
| `tools/environment/observe.mjs::86::1` | PLATFORM-NOT-RUN | 379 |
| `tools/environment/observe.mjs::87::0` | PLATFORM-NOT-RUN | 379 |
| `tools/environment/observe.mjs::87::1` | PLATFORM-NOT-RUN | 379 |
| `tools/environment/observe.mjs::88::0` | PLATFORM-NOT-RUN | 380 |
| `tools/environment/observe.mjs::88::1` | PLATFORM-NOT-RUN | 380 |
| `tools/environment/observe.mjs::89::0` | PLATFORM-NOT-RUN | 385 |
| `tools/environment/observe.mjs::90::0` | PLATFORM-NOT-RUN | 387 |
| `tools/environment/observe.mjs::90::1` | PLATFORM-NOT-RUN | 387 |
| `tools/environment/observe.mjs::91::0` | PLATFORM-NOT-RUN | 388 |
| `tools/environment/observe.mjs::91::1` | PLATFORM-NOT-RUN | 388 |
| `tools/environment/observe.mjs::92::1` | PLATFORM-NOT-RUN | 394 |
| `tools/environment/observe.mjs::93::0` | HIT | 395 |
| `tools/environment/observe.mjs::94::0` | PLATFORM-NOT-RUN | 398 |
| `tools/environment/observe.mjs::94::1` | PLATFORM-NOT-RUN | 398 |
| `tools/environment/observe.mjs::95::0` | PLATFORM-NOT-RUN | 399 |
| `tools/environment/observe.mjs::95::1` | PLATFORM-NOT-RUN | 399 |
| `tools/environment/policy.mjs::7::0` | HIT | 114 |
| `tools/environment/policy.mjs::12::0` | HIT | 123 |
| `tools/environment/policy.mjs::13::1` | HIT | 123 |
| `tools/environment/policy.mjs::14::0` | HIT | 125 |
| `tools/environment/policy.mjs::15::0` | HIT | 126 |
| `tools/environment/policy.mjs::17::0` | HIT | 143 |
| `tools/environment/policy.mjs::21::0` | HIT | 155 |
| `tools/environment/policy.mjs::33::1` | HIT | 178 |
| `tools/environment/policy.mjs::43::1` | HIT | 216 |
| `tools/environment/policy.mjs::44::1` | HIT | 217 |
| `tools/environment/report.mjs::24::1` | PLATFORM-NOT-RUN | 139 |
| `tools/environment/report.mjs::27::0` | HIT | 153 |
| `tools/environment/report.mjs::28::0` | HIT | 154 |
| `tools/local-ci/run.mjs::0::0` | HIT | 6 |
| `tools/local-ci/run.mjs::0::1` | HIT | 6 |
| `tools/local-ci/run.mjs::1::0` | HIT | 10 |
| `tools/local-ci/run.mjs::1::1` | HIT | 10 |
| `tools/local-ci/run.mjs::2::0` | HIT | 10 |
| `tools/local-ci/run.mjs::2::1` | HIT | 10 |
| `tools/local-ci/runner.mjs::4::0` | HIT | 63 |
| `tools/local-ci/runner.mjs::5::0` | OPEN | 67 |
| `tools/local-ci/runner.mjs::9::0` | INVARIANT-REVIEWED | 88 |
| `tools/local-ci/runner.mjs::11::1` | HIT | 95 |
| `tools/local-ci/runner.mjs::12::1` | HIT | 102 |
| `tools/local-ci/runner.mjs::13::0` | HIT | 103 |
| `tools/local-ci/runner.mjs::13::1` | OPEN | 103 |
| `tools/local-ci/runner.mjs::14::0` | OPEN | 111 |
| `tools/local-ci/runner.mjs::14::1` | HIT | 111 |
| `tools/local-ci/runner.mjs::15::0` | HIT | 117 |
| `tools/local-ci/runner.mjs::19::0` | OPEN | 147 |
| `tools/local-ci/runner.mjs::25::0` | OPEN | 209 |
| `tools/local-ci/runner.mjs::26::1` | HIT | 213 |
| `tools/local-ci/runner.mjs::29::0` | OPEN | 216 |
| `tools/local-ci/runner.mjs::30::0` | OPEN | 222 |
| `tools/local-ci/runner.mjs::45::0` | HIT | 312 |
| `tools/local-ci/runner.mjs::54::0` | HIT | 362 |
| `tools/security/bootstrap.mjs::13::0` | HIT | 91 |
| `tools/security/bootstrap.mjs::14::0` | OPEN | 95 |
| `tools/security/bootstrap.mjs::17::0` | OPEN | 110 |
| `tools/security/bootstrap.mjs::19::1` | PLATFORM-NOT-RUN | 112 |
| `tools/security/bootstrap.mjs::20::0` | OPEN | 116 |
| `tools/security/bootstrap.mjs::22::0` | OPEN | 122 |
| `tools/security/bootstrap.mjs::24::0` | OPEN | 126 |
| `tools/security/bootstrap.mjs::26::0` | OPEN | 132 |
| `tools/security/bootstrap.mjs::28::0` | OPEN | 151 |
| `tools/security/bootstrap.mjs::30::0` | OPEN | 154 |
| `tools/security/bootstrap.mjs::33::0` | OPEN | 167 |
| `tools/security/bootstrap.mjs::36::0` | OPEN | 175 |
| `tools/security/gitleaks-disposition.mjs::5::1` | HIT | 65 |
| `tools/security/gitleaks-disposition.mjs::9::0` | INVARIANT-REVIEWED | 79 |
| `tools/security/inputs.mjs::17::0` | HIT | 63 |
| `tools/security/inputs.mjs::30::0` | HIT | 109 |
| `tools/security/inputs.mjs::37::0` | INVARIANT-REVIEWED | 126 |
| `tools/security/inputs.mjs::38::0` | HIT | 133 |
| `tools/security/inputs.mjs::40::1` | HIT | 134 |
| `tools/security/inputs.mjs::41::1` | HIT | 135 |
| `tools/security/inputs.mjs::42::1` | HIT | 136 |
| `tools/security/inputs.mjs::43::1` | HIT | 137 |
| `tools/security/results.mjs::5::0` | HIT | 37 |
| `tools/security/results.mjs::7::0` | HIT | 38 |
| `tools/security/results.mjs::10::0` | HIT | 56 |
| `tools/security/results.mjs::13::0` | HIT | 58 |
| `tools/security/results.mjs::14::0` | HIT | 61 |
| `tools/security/results.mjs::19::0` | HIT | 80 |
| `tools/security/results.mjs::22::0` | HIT | 91 |
| `tools/security/results.mjs::25::0` | HIT | 93 |
| `tools/security/staging.mjs::0::0` | HIT | 6 |
| `tools/security/staging.mjs::6::0` | HIT | 20 |
| `tools/verify-ci.mjs::0::0` | OPEN | 6 |
| `tools/verify-ci.mjs::1::0` | OPEN | 7 |
| `tools/verify-ci.mjs::2::0` | OPEN | 8 |
| `tools/verify-ci.mjs::3::0` | OPEN | 11 |
| `tools/verify-ci.mjs::5::0` | HIT | 22 |
| `tools/verify-ci.mjs::8::0` | HIT | 24 |
| `tools/verify-ci.mjs::10::0` | HIT | 28 |
| `tools/verify-ci.mjs::12::0` | HIT | 30 |
| `tools/verify-ci.mjs::12::1` | OPEN | 30 |

## Changed-source measurement

| Source | Lines | Statements | Functions | Branches |
| --- | --- | --- | --- | --- |
| `tools/check-public-metadata.mjs` | 746/768 | 891/925 | 60/62 | 739/768 |
| `tools/ci/check-gitleaks.mjs` | 94/100 | 98/104 | 12/12 | 32/41 |

Every current missing arm below remains in its source denominator. No old gap is closed by equating an old and new branch number.

| Current gap | Classification | Source line |
| --- | --- | ---: |
| `tools/check-public-metadata.mjs::33::0` | INVARIANT-REVIEWED | 312 |
| `tools/check-public-metadata.mjs::44::0` | INVARIANT-REVIEWED | 372 |
| `tools/check-public-metadata.mjs::56::0` | INVARIANT-REVIEWED | 408 |
| `tools/check-public-metadata.mjs::62::0` | INVARIANT-REVIEWED | 429 |
| `tools/check-public-metadata.mjs::63::0` | OPEN | 431 |
| `tools/check-public-metadata.mjs::79::0` | INVARIANT-REVIEWED | 472 |
| `tools/check-public-metadata.mjs::91::1` | INVARIANT-REVIEWED | 510 |
| `tools/check-public-metadata.mjs::96::1` | INVARIANT-REVIEWED | 532 |
| `tools/check-public-metadata.mjs::102::1` | OPEN | 550 |
| `tools/check-public-metadata.mjs::129::1` | INVARIANT-REVIEWED | 624 |
| `tools/check-public-metadata.mjs::134::1` | INVARIANT-REVIEWED | 643 |
| `tools/check-public-metadata.mjs::149::1` | INVARIANT-REVIEWED | 689 |
| `tools/check-public-metadata.mjs::150::0` | INVARIANT-REVIEWED | 690 |
| `tools/check-public-metadata.mjs::215::1` | INVARIANT-REVIEWED | 872 |
| `tools/check-public-metadata.mjs::225::0` | INVARIANT-REVIEWED | 900 |
| `tools/check-public-metadata.mjs::240::0` | INVARIANT-REVIEWED | 932 |
| `tools/check-public-metadata.mjs::261::0` | INVARIANT-REVIEWED | 1000 |
| `tools/check-public-metadata.mjs::267::1` | INVARIANT-REVIEWED | 1017 |
| `tools/check-public-metadata.mjs::272::0` | INVARIANT-REVIEWED | 1045 |
| `tools/check-public-metadata.mjs::276::0` | INVARIANT-REVIEWED | 1069 |
| `tools/check-public-metadata.mjs::311::1` | OPEN | 1176 |
| `tools/check-public-metadata.mjs::314::1` | PLATFORM-NOT-RUN | 1205 |
| `tools/check-public-metadata.mjs::315::0` | PLATFORM-NOT-RUN | 1207 |
| `tools/check-public-metadata.mjs::315::1` | PLATFORM-NOT-RUN | 1207 |
| `tools/check-public-metadata.mjs::316::0` | PLATFORM-NOT-RUN | 1210 |
| `tools/check-public-metadata.mjs::317::0` | INVARIANT-REVIEWED | 1218 |
| `tools/check-public-metadata.mjs::322::1` | PLATFORM-NOT-RUN | 1252 |
| `tools/check-public-metadata.mjs::325::0` | OPEN | 1271 |
| `tools/check-public-metadata.mjs::338::0` | OPEN | 1343 |
| `tools/ci/check-gitleaks.mjs::0::0` | OPEN | 21 |
| `tools/ci/check-gitleaks.mjs::3::0` | OPEN | 35 |
| `tools/ci/check-gitleaks.mjs::5::0` | OPEN | 40 |
| `tools/ci/check-gitleaks.mjs::11::0` | OPEN | 144 |
| `tools/ci/check-gitleaks.mjs::13::0` | OPEN | 153 |
| `tools/ci/check-gitleaks.mjs::14::1` | OPEN | 164 |
| `tools/ci/check-gitleaks.mjs::15::0` | OPEN | 171 |
| `tools/ci/check-gitleaks.mjs::16::0` | OPEN | 174 |
| `tools/ci/check-gitleaks.mjs::17::0` | OPEN | 176 |

## Independently reviewed bounded source arguments

These arguments assume the pinned source, qualified native tools and ordinary intrinsic/runtime objects, without arbitrary monkey-patching or reentrant getters. Any changed source graph or assumption requires fresh review. None removes a coverage slot.

- `tools/agent-identity.mjs::16::0`: The immediately preceding guard requires agent_id === AGENTS[index]. AGENTS is a fixed array of distinct IDs, so a later duplicate already throws unexpected agent before seen.has can be true.
- `tools/agent-integration-identity.mjs::25::1`: source.head is an exact existing commit with base ancestry, and range.length > 0 is checked. Git log base..source.head necessarily contains source.head, so tip is present before the nullish fallback.
- `tools/check-supply-chain.mjs::30::1`: Within the pinned validated lock graph, source paths and dependency names are unique and current generated package IDs are distinct. The dependency Set removes duplicate names before the loop, so the same source/target relationship cannot be inserted twice. This proof is scoped to the pinned graph and normal hash collision assumption.
- `tools/check-supply-chain.mjs::55::1`: All reachable throws from these pinned built-in JSON/fs/path/crypto/YAML and validation calls are Error objects; there is no throw of a string or arbitrary user callback. This fallback requires an out-of-contract replacement implementation.
- `tools/ci/check-dependency-delta.mjs::35::0`: candidateRefs validates a full lowercase 40-hex commit ID. With the qualified SHA-1 object database and replacements disabled by admitted environment, rev-parse that exact ID either returns the same ID or throws before this inequality.
- `tools/environment/observe.mjs::65::1`: The local run helper uses spawnSync with encoding=utf8 and piped stdout. It rejects nonzero/error/signal results before this return. A successful qualified child has string stdout, including the empty string, so the nullish default does not execute.
- `tools/local-ci/runner.mjs::9::0`: expected.base is already a full lowercase 40-hex ID. The /usr/bin/git --no-replace-objects exact commit lookup returns that ID or throws, never a different ID for this admitted SHA-1 repository.
- `tools/security/gitleaks-disposition.mjs::9::0`: Before this branch, SHA-256 of each exact approved immutable Git object must match. The checked blob lines and commit tree are already verified properties of those fixed byte sequences. A mismatch after those digests requires a hash collision or replacement of trusted runtime methods; neither is a reachable input variation under the stated proof assumptions.
- `tools/security/inputs.mjs::37::0`: npmEntries is the length of parseNpmGraph output; parseNpmGraph has already thrown for zero packages. No intervening statement can reset npmEntries to zero.
- `tools/check-public-metadata.mjs::33::0`: parseStaticConcatenationExpression has already consumed and checked trailing whitespace before returning expression.end; the immediate second scan cannot newly exceed the same limit.
- `tools/check-public-metadata.mjs::44::0`: Only the static member-chain regex calls this parser, using the start of its captured staticIdentifierPattern. parseStaticIdentifierAt at that exact start therefore succeeds.
- `tools/check-public-metadata.mjs::56::0`: keyExpression comes from a parser that consumes and checks trailing whitespace. Rechecking at its returned end cannot newly exceed the limit.
- `tools/check-public-metadata.mjs::62::0`: The caller regex requires a following member marker. Invalid first members return from earlier guards; valid members increment members before reaching this guard.
- `tools/check-public-metadata.mjs::79::0`: The concatenation parser already checks trailing whitespace and returns its end after that whitespace; this repeated bound cannot fail independently.
- `tools/check-public-metadata.mjs::91::1`: parseStaticMemberAssignment requires at least one member plus its root, so keys has at least two entries; the second-last fallback is inactive.
- `tools/check-public-metadata.mjs::96::1`: The member assignment regex requires a root plus at least one member, and staticMemberKeys consumes each captured segment; the second-last entry is present.
- `tools/check-public-metadata.mjs::129::1`: The listener member assignment regex requires a root plus at least one member. The second-last parsed key cannot be missing.
- `tools/check-public-metadata.mjs::134::1`: The port member assignment regex requires a root plus at least one member. The second-last parsed key cannot be missing.
- `tools/check-public-metadata.mjs::149::1`: inspectJsonObjectKeys is called only after JSON.parse succeeds. An object key has a following colon before end-of-input; scanning whitespace after that key cannot reach undefined.
- `tools/check-public-metadata.mjs::150::0`: Under the preceding successful JSON.parse and key-state traversal, a quoted object key must be followed by a colon; non-key strings are excluded earlier.
- `tools/check-public-metadata.mjs::215::1`: The only caller checks cursor < rawValue.length before indexing a character. A real character always supplies charCodeAt; undefined fallback is inactive.
- `tools/check-public-metadata.mjs::225::0`: The public entry rejects UTF-8 byte length greater than maximumTextBytes before calling this helper. JS UTF-16 length cannot exceed UTF-8 byte length for the admitted string, so this later length guard cannot fire.
- `tools/check-public-metadata.mjs::240::0`: lines.length is rejected above maximumStructuredProperties and properties increments at most once per line, so properties cannot exceed that maximum inside the loop.
- `tools/check-public-metadata.mjs::261::0`: The only caller first continues unless value[cursor] is a double quote, then calls this function with that same value/cursor.
- `tools/check-public-metadata.mjs::267::1`: The parsed substring starts and ends with a JSON double quote; successful JSON.parse therefore returns a string, while parse errors take the catch.
- `tools/check-public-metadata.mjs::272::0`: Each queue depth consists of disjoint decoded JSON string tokens or one unescape when no token decoded; child UTF-8 bytes never exceed parent bytes. There are at most 8 child layers plus the root, bounded by 9 * maximumTextBytes. Per-item and cumulative guards are defensive under these parser invariants.
- `tools/check-public-metadata.mjs::276::0`: decodeJsonStringToken is called only at a double quote and returns an object for closed, malformed or unterminated tokens. Its sole null branch is excluded by the caller.
- `tools/check-public-metadata.mjs::317::0`: The admitted Git ls-files protocol emits repository-relative index/worktree paths and disallows absolute/parent traversal entries. The path-outside branch requires an invalid Git producer rather than a qualified repository input.

## Remaining verification boundaries

All 67 unchanged-source OPEN rows and 14 changed-source OPEN rows remain unresolved, including real executor/IO failures, full CLI entrypoints and scanner failure outcomes. Missing native Windows/Linux or ephemeral hosted-bootstrap paths remain NOT_RUN. They must not be removed, marked PASS, or declared unreachable based on this macOS run. The machine-readable ledger records each row, its source digest/location, verification method and blocker.

Current CodeQL and Dependency Review workflows are manual `workflow_dispatch` only; the active automatic scanner gates remain Semgrep CE, OSV and Gitleaks plus source/dependency checks. The repository is now public, so the historical private-repository feature limitation is not the current reason for not running them. Macbeth01 authorized both existing workflows on the published final candidate using standard public runners. They remain NOT_RUN pending that exact publication, with SHA verification before dispatch and again in run evidence.

Ready-to-merge is not established by this targeted report. Final integrated source, full acceptance, exact-head hosted checks and eligible independent GitHub approval remain required. Ordinary source-branch CI failures and historical failures remain preserved.

## Independent counterexamples and next checkpoint

The original 6b classification ledger is preserved separately. Real Git commit bodies can contain the record separator, reaching both default-body arms; repeated non-null assertions can expose previously unchecked whitespace in privacy branch 63. Macbeth05 supplied actual Git/public-API counterexamples. Commit `acd1f524703691dcb63391f99deeacc7ddbba7e2` adds actual malformed-history rejection and parser-budget regressions, scanner-input/process failure cleanup, source byte/result integrity, and actual environment entrypoint rejection. Nine selected tests pass, including the native engine controls and ten separately asserted bootstrap faults. New coverage is pending and is not merged into the 6b counters.
