# AlphaForge M3 engineering and scanner gates

Implementation owner: Macbeth01. CI operational evidence owner: Macbeth06. The user selected Semgrep CE, OSV-Scanner and Gitleaks CLI on 2026-09-20 to replace the unavailable CodeQL/Dependency Review services, while retaining Slither. This supersedes the earlier four-rule-only replacement proposal. Independent approval is still missing; these scanners do not supply it.

## Actual capabilities and limits

| Check | Required scope | Limits |
| --- | --- | --- |
| verify / verify-macos / verify-windows | Existing complete engineering tests, attribution, environment, source/build and unchanged checkout; Linux retains npm audit | Existing responsibilities unchanged |
| contracts-m3-macos | Locked bootstrap, 121 Solidity tests including fuzz/invariants, 20 Python tests, strict Slither 0.11.3 and compiled/published Vault ABI comparison | ARM macOS only, local/mock; no deployment or independent audit |
| semgrep-ce | Semgrep CE 1.177.0; 22 repository-local JS/TS/Python rules, including intraprocedural taint; 44 positive/negative engine fixtures before every scan | Selected rule coverage only, not equivalent to CodeQL cross-function/file analysis; tests/fixtures, HTML inline scripts and other languages excluded |
| osv-scanner | OSV-Scanner 2.6.0; complete root npm lock, Slither Python lock, both Semgrep Python locks, OpenZeppelin/Forge npm artifacts and Foundry source revision | Known advisory coverage; native solc, embedded Go binary libraries, Actions and runtime advisories are explicitly outside this inventory |
| gitleaks | Gitleaks CLI 8.30.1 built-in rules; all fetched Git refs plus HEAD, root/deletion/merge history, and all tracked current files | No remote token validity tests; no claim to unavailable/deleted remote refs or personal untracked files |
| source-policy-js | Existing four ESLint syntax rules | Retained as an additional check, not the new primary source scanner |
| dependency-delta-audit | Exact event base/head npm lock metadata diff, license/source/integrity policy and isolated high/critical npm audit | Retained because OSV known-advisory checks do not replace dependency-change/license review |

Legacy CodeQL/Dependency Review workflows remain available by manual dispatch. Their prior failures remain in GitHub history. Automatic scanning moves to distinct contexts; no old result is relabeled as successful.

## Immutable tools and execution

`planning/security-scanners.lock.json` records exact scanner releases, official download URLs, SHA-256 values and tool licenses. Semgrep uses 66 exact binary wheels per supported platform, 76 distinct assets total, with per-platform requirements hashes and wheel hashes. Installation uses an isolated venv, `--no-index --require-hashes --only-binary=:all:` against previously verified assets; no source builds or global installations. The scanner bootstrap verifies native CPython 3.12.9 and executable versions. OSV/Gitleaks are official fixed binaries verified before execution. Downloads and temporary installs stay in the current checkout's ignored `.checks/security-scanners` directory.

The new jobs use ubuntu-24.04/x64, full-history pinned checkout with no persisted credentials, read-only contents permissions and 35-minute limits. Semgrep additionally uses the already reviewed actions/setup-python SHA `e797f83bcb11b83ae66e0230d6156d7c80228e7c` with exact Python 3.12.9/x64. Existing ARM contract runtime, locks, compiler settings and entrypoints are unchanged. No new npm dependency or Action is introduced.

Semgrep receives only local rules, `--oss-only --metrics=off --disable-version-check --disable-nosem --strict --error`, an isolated HOME/settings path and disabled OpenTelemetry SDK. No login token or mutable registry rules are used. Source files are copied as bounded regular files into an isolated scan directory without repository ignore files. Its scanned-path set must exactly equal the selected tracked sources. The local rules cover dynamic execution, shell execution, request-to-command/SQL/path/DOM flows, TLS verification, weak hashes, wildcard postMessage, unsigned JWT configuration, and Python unsafe deserialization/tempfile/SQL/archive equivalents. Rule fixtures independently exercise each positive and safe case; no `nosemgrep` suppression is accepted.

OSV receives only generated package identities, not repository source. Its inventory preserves all distinct versions across environments and reconciles every returned clean or vulnerable package using `--all-packages --all-vulns --no-resolve`. Root npm has 217 lock positions/211 unique packages; Python inputs include 47 Slither and 66 Semgrep packages per platform. The current combined inventory has 317 unique package/source identities after adding explicit contract assets and preserving differing Python versions. Official API requests disclose only those public package names/versions and the public Foundry revision. Any reported advisory blocks; an empty/partial/network-failed response cannot pass. License/integrity policy and dependency deltas remain covered by the existing separate checks.

Gitleaks first exercises an isolated synthetic history containing root/deleted, side, tag-only and merge-only findings. It verifies both detection and complete report redaction. Production scans use an explicit built-in-default config, an empty ignore file, disabled inline allowances, `--redact=100`, a dedicated finding exit code 10 and no baseline suppression. Git must be non-shallow and connected; refs and commit coverage are recorded and checked again afterward. Current tracked files are staged separately. Raw reports and subprocess output are never printed; emitted findings contain only rule/file/line/commit. No real credential is submitted to an external endpoint.

## Failure and evidence semantics

All reports bind source head, actual checkout/tree, root dependency hash, scanner lock/version, applicable rules/input hashes, UTC/run/image identity and coverage. Clean tracked state is required before and after. Reports are bounded JSON in job logs. Raw findings remain FAIL; the one approved historical occurrence described below has a separate, visible disposition. All other findings fail the gate. Install/network/process/signal/timeout/parse/incomplete-coverage errors are BLOCKED. Both exit nonzero. Secret values, source snippets, author emails and raw scanner exceptions are excluded from summaries. Canary test code is scanned statically, never executed as application code.

Parsed CI contracts and platform admission reject missing, renamed, skipped or replaced scanner jobs/steps, shallow checkout, wrong architecture, changed installation commands and privilege escalation. The new regression suite is registered in both full npm tests and the management collector. In-repository checks remain mutable by repository maintainers; GOV-001/SUPPLY-001 external-trust work remains unresolved.

The management collector's four unregistered contract entries remain NOT_RUN; separate hosted contract/scanner reports must not be copied into them as fabricated PASS. Source C → manifest-only R → snapshot-only S remains the evidence workflow. Qualification probes before C are implementation evidence, not acceptance of a later commit.

## Required-status migration and remaining approval

After all new-head hosted gates pass, the user-authorized change to master ruleset 22507334 is:

- Retain `verify`, `verify-macos`, `verify-windows` and integration 15368.
- Replace `analyze-javascript-typescript` with `semgrep-ce` and `dependency-review` with `osv-scanner`.
- Add `gitleaks` and `contracts-m3-macos` as required contexts.
- Preserve every other condition: strict up-to-date base, one eligible independent approval, CODEOWNER/last-push/stale-review/thread-resolution requirements, no bypass, linear history, deletion and non-fast-forward protections.

This applies to subsequent master PRs as well. Implementation files are not proof of a live ruleset update: the operation needs an exact before/after API receipt. No merge is authorized. PR author pdbsy cannot provide its own independent approval; Macbeth06 under that same account cannot replace it. The incomplete independent security acceptance and external-governance findings are not closed by this migration.

See [scanner qualification](SCANNER-QUALIFICATION.md) for sources and limitations.

## GITLEAKS-FP-001: approved exact historical disposition

On 2026-09-20 the user approved only the occurrence in historical commit `69330dfffeceb86cf793fa0163ff4f72a466f3eb`, file `docs/product/PHASE1-PRODUCT-WALLET-FLOWS.md`, line 12, detector `generic-api-key`. The immutable file blob is `b118b774535825efd5d7afe8931e134827f4f974`; it records a real Git tree, not an issued credential. The source commit is `28ff3d4b5c6e70ff0c6ea1b11ad0fea4283887fd`. The tree object is `7f4abc27757e099c1b5b26a66509395015bdb7b7`.

`tools/security/gitleaks-disposition.mjs` re-reads typed Git objects with replacements disabled, verifies the historical path-to-blob identity and SHA-256 of all four exact object byte sequences, then checks the immutable document lines and referenced commit's root tree. Only exactly one matching single-line historical finding can qualify. Missing objects, altered bytes, premature/expired proof, malformed reports or failed scanner execution stay BLOCKED; mismatched, duplicate and additional findings remain FAIL. Current-file scans and every canary still use the unchanged strict classifier.

This is a bounded exception under the existing toolchain exception policy: valid from 2026-09-20 UTC until **2026-10-20 00:00 UTC**, with no automatic renewal. Macbeth01 owns the implementation and Macbeth06 independently verifies it. The expiry deliberately prevents this one approval becoming an unbounded scanner policy. The full default scanner, all fetched refs, empty ignore file, disabled inline allowances, redaction and required checks are unchanged.

The emitted report preserves `history.state: FAIL`, its complete sanitized finding list, scanner exit code and raw-report SHA-256; `historyDisposition` separately reports the exact proof and effective state. No raw secrets, email addresses or source snippets are emitted. Previous failed CI runs remain failed. This disposition alone does not establish readiness, independent security approval, GitHub review or deployment authorization.

## AF-TESTNET-PREP exact Testnet admission

The current user approved an exact nine-finding Testnet Slither admission through 2026-11-01, recorded in docs/specs/AF-TESTNET-SLITHER-REVIEW.md and contracts/deployment/slither-admissions.json. The contract gate retains the complete raw report and verifies exact source/tool/findings/expiry; no detector is suppressed. Any new, changed, expired or unreviewed finding still fails. The original phase-one ABI and strict unrelated checks remain intact. This is user-approved bounded admission and local technical review, not independent security approval or external-chain acceptance.
