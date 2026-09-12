# AlphaForge Control Center Architecture

- Decision ID: `DASH-ARCH-001`
- Owner: `Worker B / Macbeth`
- Status: `ACCEPTED_FOR_IMPLEMENTATION`
- Recorded: `2026-09-08T22:01:18+08:00`
- Scope: Dashboard presentation, aggregation, validation, observability, and loopback serving
- Out of scope: protocol facts, roadmap ownership, security-policy changes, testnet write enablement, deployment decisions

## Objective

Provide a Chinese desktop-oriented control center that lets a reviewer understand within 30 seconds:

1. where the project is now;
2. what Worker A and Worker B are doing;
3. what failed, remains risky, or is blocked;
4. which evidence is real and current;
5. which decisions require the user or Manager.

The Dashboard is not an authority. It is a read-only projection of repository sources, bounded command evidence, and generated metadata. It must never silently convert absence, parse failure, stale evidence, or the existence of a test script into success.

## Architecture

```text
planning/*.json                 docs/management/**/*.md
docs/security/*.md              docs/adr/*.md
README.md / docs/*.md           .checks/management/latest.json
git metadata (fixed argv)
             |
      source collectors
                     |
            schema validation + redaction
                     |
          build-management-dashboard.mjs
                     |
       dashboard/data/dashboard.json
       dashboard/data/build-log.json
                     |
        index.html + app.js + styles.css
                     |
     loopback-only static HTTP server
```

The HTML shell contains layout and stable labels only. All changing project facts are read from `data/dashboard.json`. The browser performs no network request except same-origin reads of committed/generated Dashboard assets.

## File boundaries

| File                                            | Responsibility                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/management-dashboard/schema.mjs`         | Closed status enums, runtime validation, canonical dashboard-data shape                                                                                       |
| `tools/management-dashboard/redact.mjs`         | Recursive key/value redaction, contextual private-JWK handling, OpenSSH-key redaction, URL credential stripping, and size/depth limits                        |
| `tools/management-dashboard/markdown.mjs`       | Parse only the documented Worker/task record headings and fields; surface malformed input                                                                     |
| `tools/management-dashboard/sources.mjs`        | Read canonical, non-symlink allowlisted files under shared work budgets and collect graph-validated Git metadata with fixed `execFile` arguments and no shell |
| `tools/management-dashboard/checks.mjs`         | Define fixed test commands and normalize actual run records; accept no arbitrary command input                                                                |
| `tools/run-management-checks.mjs`               | Execute fixed checks, sanitize/cap logs, atomically write the versioned `.checks/management/latest.json`; per-run logs stay ignored                           |
| `tools/build-management-dashboard.mjs`          | Aggregate sources, generate JSON/log artifacts atomically, and fail on invalid mandatory sources                                                              |
| `tools/serve-management-dashboard.mjs`          | Serve only the dashboard directory on `127.0.0.1`; deny traversal/dotfiles and add security headers                                                           |
| `docs/management/dashboard/index.html`          | Stable Chinese control-center structure and accessible navigation targets                                                                                     |
| `docs/management/dashboard/app.js`              | Same-origin data loading, text-only rendering, filtering, and explicit error UI                                                                               |
| `docs/management/dashboard/styles.css`          | Responsive desktop-first presentation; status labels remain textual                                                                                           |
| `docs/management/dashboard/data/dashboard.json` | Generated, sanitized project snapshot; never hand-edited                                                                                                      |
| `docs/management/dashboard/data/build-log.json` | Generated build/source diagnostics with no raw secrets                                                                                                        |
| `docs/management/dashboard/README.md`           | Data contract, safe commands, local URLs, limitations, and recovery procedure                                                                                 |
| `test/management-dashboard.test.mjs`            | Schema, collector, redaction, rendering, link, CSP, traversal, and drift tests                                                                                |

## Source-of-truth policy

| Dashboard area                              | Authoritative source                                         | Missing behavior                                   | Error behavior                              |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------- |
| Project, current wave, tasks, release gates | `planning/roadmap.json`                                      | Build failure because roadmap is mandatory         | `DATA SOURCE ERROR` plus non-zero build     |
| Network/testnet safety                      | `planning/security-boundary.json`, `docs/ROBINHOOD-CHAIN.md` | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| Security findings                           | `planning/risk-register.json`                                | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| Supply/security reports                     | `docs/security/*.md`, `SECURITY.md`                          | `NOT AVAILABLE` per document                       | `DATA SOURCE ERROR` per unreadable document |
| Worker A                                    | `docs/management/workers/worker-a.md`                        | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| Worker B                                    | `docs/management/workers/worker-b.md`                        | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| Manager status/control                      | `docs/management/CURRENT-STATUS.md`, `WORK-QUEUE.md`         | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| Decisions                                   | `docs/management/DECISIONS.md`                               | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| Test/build status                           | Versioned `.checks/management/latest.json`                   | `NOT_RUN` in build mode; check mode fails on drift | `DATA SOURCE ERROR`                         |
| Git status/history                          | local `.git`, queried with fixed arguments                   | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| SSH host history                            | `docs/management/host/*.md`                                  | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |
| ADR and documentation links                 | allowlisted repository paths                                 | `NOT AVAILABLE`                                    | broken link warning and non-zero check mode |
| Changelog                                   | `CHANGELOG.md` or `docs/management/CHANGELOG.md`             | `NOT AVAILABLE`                                    | `DATA SOURCE ERROR`                         |

The Dashboard must not modify Manager-owned sources. It may display them, validate documented fields, or mark them unavailable.

Repository source collection shares one fail-closed work budget across the complete snapshot: at most 256 directory entries, 128 source files, 4 MiB of aggregate source content, and 1 MiB for any individual file. Directory enumeration uses bounded `opendir` iteration, and file reads are capped from an opened file handle so a file that grows during collection cannot expand the read without detection. Document links count toward the shared file budget even though their contents are not loaded.

## Status vocabulary

Task/work states are closed to:

- `DONE`
- `VERIFIED_DONE`
- `PARTIAL`
- `IN_PROGRESS`
- `READY`
- `BLOCKED`
- `NOT_STARTED`
- `NOT_AVAILABLE`
- `DATA_SOURCE_ERROR`

Evidence checks are closed to:

- `PASS`
- `FAIL`
- `NOT_RUN`
- `BLOCKED`
- `NOT_AVAILABLE`
- `DATA_SOURCE_ERROR`

Every status badge renders both text and a visual treatment; color is never the only signal. The fixed project-preview URL is a navigation link, not a claimed runtime health probe.

## Dashboard data contract

`dashboard.json` contains these top-level fields:

```text
schemaVersion
generatedAt
generatorVersion
project
integration
workers
tasks
decisions
security
tests
git
build
hackathon
network
knownIssues
blockers
links
sourceHealth
dashboardLog
```

Every derived section includes `status`, `source`, and `observedAt`. Evidence-based statuses also include `commit` and `evidence` when known. Unknown optional facts are represented explicitly; fields are not populated with invented defaults.

## Test evidence contract

The check runner owns a closed command registry. The initial registry is:

| Dashboard check      | Fixed command                                         | Classification                     |
| -------------------- | ----------------------------------------------------- | ---------------------------------- |
| typecheck            | `npm run typecheck`                                   | local evidence                     |
| lint                 | `npm run lint`                                        | local evidence                     |
| format               | `npm run format:check`                                | local evidence                     |
| unit                 | fixed `node --test` unit-file list                    | local evidence                     |
| integration          | fixed `node --test test/server.test.ts`               | local evidence                     |
| E2E                  | fixed `node --test test/http-e2e.test.ts`             | local evidence; loopback required  |
| secret scan          | `npm run secrets:check`                               | bounded baseline only              |
| public metadata      | `npm run privacy:check`                               | tracked-file metadata minimization |
| dependency audit     | `npm run audit:dependencies`                          | network-dependent evidence         |
| build                | `npm run build`                                       | local evidence                     |
| planning consistency | `npm run planning:check`                              | local evidence                     |
| Foundry              | no command until an approved Foundry toolchain exists | `NOT_RUN`                          |
| fuzz                 | no command until an approved harness exists           | `NOT_RUN`                          |
| invariant            | no command until an approved harness exists           | `NOT_RUN`                          |
| Slither              | no command until an approved toolchain exists         | `NOT_RUN`                          |

For executed checks, record start/end, duration, exit code, sanitized bounded log path, and `PASS`/`FAIL`. The report itself records the exact named branch, commit, and tree. Evidence collection starts only from a clean named branch and rechecks the branch, commit, tree, and clean state after every command and immediately before publishing the manifest. Any mutation aborts the run and preserves the previous manifest. A missing record is always `NOT_RUN`; source-code presence never implies success.

## Redaction and data minimization

Before logs or parsed Markdown enter generated JSON:

- reject or redact keys matching token, secret, password, cookie, authorization, credential, OAuth code/verifier/device/assertion/signature terms, seed, mnemonic, and private-key terms;
- redact private-key PEM blocks and known provider/GitHub/cloud token patterns;
- redact `ssh-dss` public keys and certificates alongside the supported modern OpenSSH key forms, while leaving bare algorithm documentation intact;
- redact private JWK members contextually by recognized `kty` (`oct`, `RSA`, `EC`, or `OKP`) without treating ordinary unrelated `k` and `d` properties as secrets;
- redact complete authorization-scheme values, including Bearer, Basic, OAuth, DPoP, Digest, Negotiate, and Token, including mixed prose, arrays/objects, escaped and multiply encoded JSON;
- strip URL user-info and redact credential, OAuth, refresh-token, and identity-token query parameters;
- replace home-directory prefixes with `<HOME>` in public artifacts;
- cap individual strings, arrays, recursion depth, command log bytes, recent commit count, source-file size, JSON nesting, and parser work; budget exhaustion and oversized structured strings redact fail-closed;
- render all source text through DOM `textContent`; never use `innerHTML` for source-controlled data;
- never read `.env`, `.git/config`, `~/.ssh`, `~/.codex`, keychains, browser data, or process environments beyond an explicit safe allowlist.
- reject a tracked public artifact when bounded scanning finds a combinable host/SSH identity profile or an exact package version tied to a local host; the diagnostic exposes paths and categories, never matched values.
- iteratively inspect no more than eight JSON string-wrapping layers; an additional layer or an oversized decoded value produces a bounded structured-record error;
- decode bounded double-quoted YAML keys and fail closed when a sensitive identity/SSH leaf uses a block scalar, alias, anchor, or explicit tag that the lightweight parser cannot safely resolve;
- recognize host-identity assignments assembled only from bounded literal-only static concatenations, including computed keys, without evaluating code; excess parts, whitespace, value length, or scan work fail closed.

The existing repository secret baseline remains defense in depth, not proof that Dashboard output is safe.

## Git collection boundary

Git collection uses `execFile` with `shell: false`, repository-root `cwd`, a minimal explicit environment, bounded output, and fixed argument arrays:

- `git branch --show-current`
- `git rev-parse HEAD`
- `git rev-parse --verify <validated-ref>^{commit}`
- `git rev-parse --verify <validated-ref>^{tree}`
- `git status --porcelain=v1 --untracked-files=all --branch`
- `git ls-files -v -z`
- `git merge-base <validated-commit> <validated-commit>`
- `git log --max-count=20 --date=iso-strict --format=...`
- `git rev-list --left-right --count <validated-ref>...HEAD`
- `git diff --name-only -z --no-renames <validated-commit>..<validated-commit> --`

Branch/ref values must match a conservative ref-name pattern and are passed as arguments, never interpolated into a shell. CI identity is accepted only from a closed allowlist of bounded GitHub variables and is then corroborated against exact local refs and commit ancestry. `refs/remotes/origin/master` is the trusted CI base ref. Every accepted source/base pair must have a verified merge base; the current base tip does not have to be an ancestor, so a legitimate branch remains valid after the base advances. `git ls-files -v -z` rejects tracked `assume-unchanged`, `skip-worktree`, and other non-normal index states before Git evidence is accepted. A pull-request checkout may be detached only at GitHub's exact two-parent merge ref while the logical source identity comes from the exact remote PR-head ref; the temporary checked-out merge commit is never confused with that logical head. Commit subjects and author names are untrusted display text and go through redaction/size limits.

## Browser and server security

- Serve on `127.0.0.1` only; reject any configured non-loopback host.
- Default Dashboard port: `4181`, separate from the project demo on `4180`.
- Static GET/HEAD only; all other methods return `405`.
- Resolve paths below the fixed Dashboard root; deny traversal, encoded traversal, symlinks escaping the root, and dotfiles.
- Send `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`.
- Send `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cross-Origin-Resource-Policy: same-origin`.
- Do not add a dynamic API, mutation endpoint, websocket, credential, cookie, or authentication mechanism.
- Do not expose the demo or Dashboard directly to LAN as part of this workstream.

## Required navigation

The home page provides named links or explicit unavailable cards for all 20 requested areas:

1. Project Preview
2. Task Board
3. Manager Control Panel
4. Worker A Log
5. Worker B Log
6. Decision Log
7. Security Findings
8. Test / CI Status
9. Git / Commit History
10. Build Status
11. Hackathon Compliance
12. Release Gates
13. Known Issues
14. Blockers
15. Architecture / ADR
16. Documentation
17. Network / Robinhood Testnet Status
18. Project Changelog
19. SSH Host Status
20. Raw Evidence / Reports

Unavailable targets remain visible with `NOT AVAILABLE`; they are not linked to fabricated pages.

## Build and refresh behavior

The intended commands are:

```bash
npm run management:checks
npm run management:build
npm run management:check
npm run management:serve
```

Generation resolves every output-directory component beneath the canonical repository root, rejects symbolic links and non-directories, creates missing components one level at a time, and revalidates the canonical parent before installation. It writes both fixed JSON files to a contained staging directory, replaces the `data` directory as one transaction, and rolls the original pair back if installation is interrupted. Check logs and the latest report use an independent contained-directory walk, exclusive temporary files, and fixed filenames; an unsafe `.checks` parent is rejected before any check executes. A failure exits non-zero without publishing a mixed-version artifact pair, and pre-existing redirected parents are rejected.

These pathname guards do not claim isolation from a concurrent process running as the same operating-system user and replacing a writable ancestor after validation. Node's path-based file APIs do not expose the directory-handle-relative rename primitive needed to close that race. Such a process already has equivalent write authority over the checkout and is outside this tool's trust boundary; checks and generation must run only in a trusted, access-controlled checkout or an isolated CI workspace.

`management:check` rebuilds in memory and compares canonical JSON/asset expectations with committed outputs, checks internal links, and fails on drift or mandatory-source errors. It accepts the versioned evidence manifest only when its profile, exact registry membership/order, terminal statuses, unavailable-tool states, named branch, exact commit tree, and restricted ancestry against the validated source branch are valid. Every linear transition between report evidence and snapshot source may change only `.checks/management/latest.json`; every linear transition between the recorded snapshot source and the current logical branch head may change only the two generated Dashboard JSON files. Merge commits, excessive gaps, intermediate forbidden changes followed by a revert, and every other descendant path—including runtime, tests, workflow, package, or documentation—make the evidence stale. It never uses the generated Dashboard as its own evidence source. The manifest is a reviewable historical record, not an independently signed attestation; merge authorization remains the responsibility of externally enforced GitHub checks that execute the commands. The Dashboard log exposes optional missing sources as warnings and mandatory-source corruption as errors.

Because a committed file cannot contain the hash of the commit that contains itself, check mode reconstructs the validated generation-time Git section from the recorded commit and tree plus the current Git graph. Local, push, and manually dispatched source checkouts require the exact named source branch; push CI may resolve the base exclusively through `refs/remotes/origin/master`. GitHub pull-request checkouts may be detached only when the synthetic merge SHA, exact merge ref, exact `origin/master`, exact remote source ref, both parents, recorded tree, restricted descendant paths, and recorded-commit ancestry agree. Merge-group checkouts require the exact `gh-readonly-queue/<base>/...` remote ref at `GITHUB_SHA`, an exact remote source ref included in the queue graph, and the exact remote base as an ancestor. A protected-base checkout after squash/rebase integration is accepted locally or during push CI only while its exact local base ref resolves to `HEAD`, the exact remote source ref remains present, and the integrated tree is identical to the source-ref tree; the original merge-base reconstructs ahead/behind without trusting an environment branch label. Duplicate queue-branch push runs are excluded while the dedicated `merge_group` run remains enabled. Normal build mode refreshes branch, commit, tree, dirty count, ahead/behind, and history.

The recorded-evidence workflow intentionally supports only same-repository pull requests whose exact source branch exists under `refs/remotes/origin/`. A fork pull request fails closed because a branch-name environment field does not authenticate the head repository. External contributions must be copied to a reviewed same-repository branch before generating commit-bound evidence; the checker does not infer or fetch a fork ref.

## Branch and integration model

- Working branch: `macbeth/dashboard`.
- Git author: `Macbeth <pdbsy@users.noreply.github.com>` using repository-local config.
- Final PR lineage is rebuilt directly from the reviewed `origin/master` base; no superseded Worker B prerequisite branch remains in its ancestry.
- Historical Worker B handoff restriction: do not merge. DEC-007 supersedes that role restriction for the user-authorized current round.
- Before final merge, require the immutable evidence chain, exact remote-head readback, applicable approvals and protected GitHub checks. DEC-007 records the user’s staged merge authorization; Macbeth self-review is explicitly not independent external acceptance.

## Rollback and recovery

- Dashboard assets are read-only and can be removed without changing protocol/runtime behavior.
- The separate port avoids weakening the existing demo server's local-only assumptions.
- If generated data is corrupt, keep the last valid snapshot, surface the generation failure, and rebuild after fixing the source.
- If redaction validation fails, produce no public artifact and retain only a local bounded error category.
- If a branch integration conflict occurs, do not resolve Manager-owned facts silently; stop and request Manager review.

## Known limitations at architecture acceptance

- Worker A log, Manager control files, decision log, work queue, and changelog do not currently exist; they must display `NOT AVAILABLE`.
- The persisted test manifest is reviewable repository evidence, not a cryptographically signed CI attestation; protected GitHub checks remain mandatory for merge authorization.
- GitHub CI status cannot be live without network/account access; the first implementation uses last explicitly collected evidence and labels staleness.
- The local runtime observed during architecture acceptance did not satisfy the repository requirement; clean-install reproducibility is not currently proven on that host.
- Foundry, fuzz, invariant, and Slither evidence does not exist and must remain `NOT_RUN`.
- SSH was discontinued; the historical host section must expose its partial/cancelled state and unresolved cleanup, not imply active remote-development readiness.

## Windows public-file identity

POSIX reads retain O_NOFOLLOW. On Windows, where that flag is unavailable, the original path metadata, opened handle and current non-symlink path must have identical nonzero BigInt file identities before any content read. Unsupported identity fails closed. Post-read identity, size, timestamps and canonical-root checks remain mandatory. Real Windows CI validates the combined gate; this does not claim an independent OS isolation boundary or validation of every optional local command runner.
