# Macbeth02 Exact Candidate Contract Review

- Agent / task: `Macbeth02` / `M3-02-PHASE1-CONTRACTS`
- Worker source: `a13052993b6f408b7be835ecd6f4b13ef6df367d`
- Worker tree: `0db6b922fa8c33219793f4d758e39d46665905d0`
- Manager source: `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`
- Manager tree: `6f1a21845a99e16a0ba171612cd97e9bf3439294`
- Base: `18f5352070910a867b9729b031aa2e3951785e01`
- Review time: `2026-09-20T10:46:14Z` through `2026-09-20T10:46:58Z`
- Result: `PASS_CONTRACT_SOURCE_EQUIVALENCE` and
  `PASS_LOCAL_COMPILER_ABI_MANIFEST_EQUALITY`
- Boundary: `LOCAL / MOCK / NOT_DEPLOYED`

## Exact source binding

The manager candidate was fetched by exact commit without querying or executing GitHub Checks.
The complete `contracts/` tree is object-identical at both sources:

```text
a130529:contracts  0fa7e3e471f32a6d6b742e42540add6e047b536a
3a78e34:contracts  0fa7e3e471f32a6d6b742e42540add6e047b536a
```

The following components also have identical Git object IDs: `contracts/src`, `contracts/test`,
`contracts/script`, `contracts/deployment`, `foundry.toml`, `toolchain.lock.json`,
`requirements-slither.lock` and `openzeppelin-pragma-pins.json`. An exact
`git diff --exit-code a130529... 3a78e34... -- contracts` exited `0` with no output. This proves
that production Solidity, tests, mocks/harnesses, compiler configuration, dependency locks,
published ABI, schema-2 artifact manifest and local deployment-rehearsal source are unchanged.

`docs/protocol/PHASE1-CONTRACT-DELIVERY.md` is also object-identical. The only reviewed handoff
delta is in `PHASE1-TESTNET-DEPLOYMENT-PLAN.md`: the manager candidate removes the two Markdown
hard-break trailing-space pairs after the Status and Chain lines. It changes no parameter,
authorization, constructor, executable source or deployment behavior.

The raw object and diff record is
`docs/management/phase1/evidence/Macbeth02-3a78e34-contract-equivalence.log`.

## Fresh narrow compiler verification

After proving the subtree equality, Macbeth02 ran only the missing candidate-bound compiler checks
instead of repeating unchanged test suites:

1. `forge build --offline --force` rebuilt 55 files with the locked solc `0.8.31`; exit `0`.
2. `check_vault_artifact.py` compared the fresh `AlphaForgeVault` compiler artifact with the
   published ABI; exit `0` and `AlphaForgeVault ABI matches frozen M3 interface`.
3. `build_phase1_contract_manifest.py --check` compared the complete fresh artifact set with the
   committed schema-2 manifest; exit `0` and `Phase One contract manifest matches compiler
   artifacts`.

The run used Darwin arm64, CPython `3.12.9`, Forge `1.5.1-v1.5.1` at commit
`b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`, and solc
`0.8.31+commit.fd3a2265`. It used offline mode with no RPC, credential, signature, deployment or
broadcast. Forge emitted existing advisory lint notes; they did not change the exit status and no
warning was suppressed or rewritten.

The complete command/output record is
`docs/management/phase1/evidence/Macbeth02-3a78e34-compiler-equality.log`.

Final report validation also passed `git diff --cached --check`, exact evidence-index hash checks,
machine-local path and trailing-whitespace scans, the repository privacy gate under Node
`24.21.0` / npm `11.19.1` (522 bounded files), and a final zero-diff contract comparison. Its
record is `docs/management/phase1/evidence/Macbeth02-final-validation.log`.

## Contract and artifact conclusions

- `StrategyPass` remains fixed-supply, freely transferable at full 18-decimal precision and bound
  to one immutable nonzero Strategy ID. It has no post-construction mint path.
- `AlphaForgeVault` keeps an explicit nonzero immutable Owner separate from the Strategy Creator,
  validates Pass 18 decimals and AF-USDC 6 decimals, rejects aliased assets and requires on-chain
  Pass/Vault Strategy ID equality.
- Every Vault constructs its own immutable `PassLocker`. The Locker accepts accounting mutations
  only from that Vault and returns Pass only to its immutable Owner. Same-strategy Vaults may share
  the StrategyPass contract while retaining distinct Lockers.
- Deposits lock `usdcRaw * 10^12` Pass raw units. Reverse conversion rejects any remainder rather
  than truncating. Ordinary Pass transfer never uses that capacity-conversion restriction.
- Withdrawal remains profit-first. Profit withdrawal releases no Pass; principal withdrawal
  releases the corresponding capacity; loss does not auto-release; full close releases every
  remaining locked Pass after tracked positions are settled.
- Untracked token/native dust does not create principal, equity or profit and does not block close.
  Post-close rescue is Owner-only and limited to actual untracked excess.
- Short-transfer, failed-transfer, reentrant and adverse-token paths revert atomically without
  retaining half-completed accounting.
- The schema-2 manifest records complete constructors, ABI/method/event/error hashes, creation
  bytecode, runtime templates and compiler immutable offsets. Compiler reference IDs intentionally
  remain `COMPILER_REFERENCE_IDS_NOT_SOURCE_FIELD_MAPPED`; no named-field patching is inferred.

Exact requirement-to-source/test evidence is indexed in `Macbeth02-EVIDENCE-INDEX.md`.

## Existing executed suites and non-repetition decision

The unchanged PR24 checkpoint already has two distinct execution records:

- Macbeth02 source checkpoint: 24/24 Python and 134/134 Solidity tests, fuzz/invariants, frozen ABI,
  schema-2 manifest, Slither and two local VM rehearsal tests.
- Macbeth05 independent PR24 checkpoint at exact `a130529`: the same complete entrypoint passed;
  Slither reported zero detectors. Its gate-log SHA-256 is
  `ce21fa201e92aa7751e95a95e091d2930356b7af197eed6c70c32017b9f400dd`.

Because the full contract tree is object-identical at `3a78e34`, this review did not repeat the
unchanged Solidity, fuzz, invariant, Slither, coverage or local deployment-rehearsal suites. It
recompiled and rechecked the ABI/manifest because those narrow outputs are the exact candidate
binding needed for this handoff. Historical execution and fresh candidate-bound compilation are
not combined into a new synthetic test count.

## Coverage boundary

The independently reproduced frozen core result remains:

| Production core | Lines | Statements | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
| `AlphaForgeVault` | 100% | 100% | 100% | 100% |
| `PassLocker` | 100% | 100% | 100% | 100% |
| `StrategyPass` | 100% | 100% | 100% | 100% |

The full compiled set remains **95.53% lines / 95.12% statements / 73.42% branches / 95.54%
functions**. These values use a broader denominator containing optional compiled contracts and test
support code and are not rewritten as 100%. This contract result also does not close the separate
combined JS/TS/browser overall coverage item, which remains outside Macbeth02's measurement scope.

## Collector and release boundary

The management collector still declares `foundry`, `fuzz`, `invariant` and `slither` unavailable
with `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR`. The separate contract entrypoint and its
real execution evidence are indexed for correlation; no collector record is hand-edited to PASS.

This review provides no hosted CI result, final external security assessment, independent GitHub
approval, merge authorization, Testnet address, deployed runtime, receipt, finality, wallet
signature or broadcast evidence. Those states remain separate and must not inherit this local
contract conclusion.
