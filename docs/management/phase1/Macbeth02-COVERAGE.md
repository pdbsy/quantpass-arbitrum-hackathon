# Macbeth02 Phase One Contract Coverage

- Task: `M3-02-PHASE1-CONTRACTS`
- Corrected implementation source C: `2ad816200e7edfbfad96d765b4a696bc8b838c2d`
- Tool: pinned Forge `1.5.1`
- Mode: offline, optimizer and via-IR disabled by Forge for accurate source maps
- Status: `LOCAL EVIDENCE / NOT DEPLOYMENT EVIDENCE`

## Scope decision

The frozen Phase One authorization and accounting core is `AlphaForgeVault`, `PassLocker` and
`StrategyPass`. It owns the explicit-owner boundary, amount and capacity conversion, principal and
profit accounting, settlement rollback, terminal close/rescue behavior and Pass escrow. The
compiled TestVenue and SwapAdapter remain outside the minimum Phase One deployment candidate
because strategy execution, swaps and liquidity are excluded.

No threshold, production branch, assertion or acceptance standard was reduced. Coverage findings
were checked against source behavior before tests were added.

## Before correction

The 126-test candidate reported:

| Production source | Lines | Statements | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
| `AlphaForgeVault` | 96.69% | 94.52% | 72.09% | 100% |
| `PassLocker` | 97.44% | 96.08% | 77.78% | 100% |
| `StrategyPass` | 100% | 100% | 100% | 100% |

The missing core branches were real boundary cases rather than source-map-only artifacts: terminal
state rejection, zero/excess withdrawal, empty rescue, identity-call failure, asset aliasing,
accounting overflow, unsupported/unfunded positions and escrow deficit.

## Corrected result

The 134-test candidate reports:

| Production source | Lines | Statements | Branches | Functions |
| --- | ---: | ---: | ---: | ---: |
| `AlphaForgeVault` | 100% (151/151) | 100% (219/219) | 100% (43/43) | 100% (22/22) |
| `PassLocker` | 100% (39/39) | 100% (51/51) | 100% (9/9) | 100% (7/7) |
| `StrategyPass` | 100% (4/4) | 100% (4/4) | 100% (1/1) | 100% (1/1) |

The complete report, including optional compiled contracts and test support code, is 95.53% lines,
95.12% statements, 73.42% branches and 95.54% functions. Those totals are preserved rather than
presented as a global 100% claim.

## Reproduction

From `contracts/`, with the repository's pinned clean environment variables:

```bash
forge coverage --offline --report summary --report lcov \
  --report-file ../.checks/af-chain01/evidence/phase1-coverage-after.lcov
```

The LCOV output is derived local evidence under `.checks/`; it is regenerated from the committed
source and tests and is not a deployment artifact.

## Manager-candidate equivalence

The manager source `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8` and PR24 head `a130529` share
the exact `contracts/` Git tree `0fa7e3e471f32a6d6b742e42540add6e047b536a`, including the complete
test tree and `foundry.toml`. Macbeth05 independently reproduced the 134-test suite and coverage at
the exact PR24 head. Therefore the existing contract coverage counters apply to the same executable
contract/test source in the manager candidate; this is source-equivalence evidence, not a new
coverage execution in the current turn.

The distinction remains mandatory: Vault/Locker/Pass are 100% for all four dimensions, while the
complete compiled report remains 95.53% lines, 95.12% statements, 73.42% branches and 95.54%
functions. Neither result is a measurement of combined Node/browser coverage.

The retained LCOV with SHA-256
`ab68b1355c159d195c72ef262246b7ad7ffcc5fcee0b127fa31b2141ffa95115` identifies the broader raw
gaps without changing counters:

| Broader production source | Lines | Branches | Functions | Phase One classification |
| --- | ---: | ---: | ---: | --- |
| `AlphaForgeSwapAdapter.sol` | 41/45 | 5/8 | 5/5 | Compiled inventory; excluded from the minimum candidate with strategy execution |
| `AlphaForgeTestVenue.sol` | 74/76 | 10/16 | 10/10 | Compiled inventory; excluded from the minimum candidate with strategy execution |

Additional misses occur in invariant handlers, harnesses and malicious/mock support code. They
remain in the complete compiled denominator and explain why the broader branch value is 73.42%.
They are not concealed, but they do not establish a new gap in the 100%-covered frozen
Vault/Locker/Pass authorization and accounting core. No business scope, assertion or counter is
changed to raise the broad optional/support result. The file-by-file classification is retained in
`evidence/Macbeth02-a130-coverage-scope.log`; it reads existing LCOV and is not a new coverage run.
