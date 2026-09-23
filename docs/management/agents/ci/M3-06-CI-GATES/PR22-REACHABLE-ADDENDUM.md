# PR22 reachable review addendum

Scope: AlphaForge / Robinhood Chain Testnet / Hackathon. This is local engineering evidence for Macbeth01's integration. It does not authorize merge, deployment, signing, broadcast or hosted publication. AF_Xlayer is a separate project and is outside this task.

The latest qualified candidate in this checkout is `9ccbba4a241579a4fe84c943e9eb21c1565ccb48`, tree `91670de077aa1cc08507cd5da6198d10c6b52f69`, measured against baseline `f966dd2e0772f6953e7315816b52aa53316c7eae`. The qualified report is `outputs/pr22-macbeth06/qualified/2026-09-23T11-27-33.068Z-4e321bb8-b4a0-4f1b-83cb-25db6ece5847/report-0892621d-4389-400e-9cc6-6cf40e36ae3b.json`, SHA-256 `b52565b4283cf2ea13bc3b16dfc3c58e096e962bcf892409f692eed9c7478128`. Tool digest remains `380b1ba55eb71082f9b76cb6e7cc577d0c4a4d68fdd60a216d5342619357cbc0`.

The coverage driver reported `functionalState: PASS` for both `targeted-gate-boundaries` and the native local Gitleaks workflow. The original 296 assigned gap IDs remain in the ledger:

| Classification | Count |
| --- | ---: |
| `VERIFIED_TARGETED_ASSERTIONS` | 176 |
| `CHANGED_SOURCE_REMEASURED` | 56 |
| `PROVEN_UNREACHABLE_UNDER_STATED_INVARIANT` | 9 |
| `PLATFORM_SPECIFIC` | 34 |
| `OPEN_REACHABLE` | 21 |

The two changed production sources retain their complete new denominators. `tools/check-public-metadata.mjs` measured 746/768 lines, 892/925 statements, 60/62 functions and 742/768 branches. `tools/ci/check-gitleaks.mjs` measured 96/100 lines, 100/104 statements, 12/12 functions and 34/41 branches. Their current gaps are classified separately as 19 invariant-reviewed, 5 platform-specific and 9 open. No old branch ID is closed by numeric reuse.

The latest assertion-bearing additions are commits `48e3e31ad15087d532354ca94190349530667e29` (dependency-delta malformed event and native contract prerequisite boundaries, plus the real supply-chain entrypoint), `eee1fea` (environment report persistence and workflow parser permission/null boundaries), and `9ccbba4` (privacy test fixture assembled at runtime so the public metadata gate does not mistake the fixture for a real host record). The direct checks passed: security reachable closeout 20/20, supply-chain 46/46, public-metadata 58/58, ESLint, diff check and `node tools/check-public-metadata.mjs`. The privacy fixture change has no production or scanner-policy change.

Macbeth05 independently reviewed the production fixes, the native Semgrep qualification, the scanner bootstrap failure cleanup and the identity additions. The review accepted 28 bounded proofs. Three earlier proofs were refuted by concrete counterexamples: Git record-separator bodies in `tools/agent-integration-identity.mjs` and `tools/check-agent-identity.mjs`, and the former privacy parser branch. The counterexample tests and current-source remeasurement are retained; those rows are not reported as invariant proofs.

CodeQL and Dependency Review are manual `workflow_dispatch` workflows. They are not being counted as failed gates: the repository is public, and the present reason they are `NOT_RUN` is that Macbeth01 must publish the exact final candidate first, verify its SHA, then dispatch them on standard public runners and retain the run evidence. Automatic scanner gates remain Semgrep CE, OSV and Gitleaks plus source, dependency and contract checks. This local report is not final hosted acceptance.
