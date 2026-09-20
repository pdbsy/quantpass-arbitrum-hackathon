# Phase One Product Coverage Evidence

## Sources and scope

- Task: `M3-04-PHASE1-PRODUCT`
- Macbeth05 coverage-gap source: `49432db158bdee6f4130bcb5c8c9d9fd6cd65a1f`
- Macbeth05 report: `docs/management/agents/qa/M3-05-PHASE1-ACCEPTANCE/COVERAGE-GAPS.md`
- Contract source consumed read-only: `2ad816200e7edfbfad96d765b4a696bc8b838c2d`
- Contract evidence head: `a13052993b6f408b7be835ecd6f4b13ef6df367d`
- Chain/API source consumed read-only: `500914b900d61ea5b26c32ab5cc39c4b0d829c3c`
- Chain/API source tree: `f5257183b1b114295e565f1799b736a124797f72`

This follow-up adds the contract-qualified StrategyPass consumer, exact manifest identity checks,
runtime bytecode verification, and Pass submission registration. It does not remove a product
guard or weaken an authorization or accounting assertion.

The measured source set is exactly:

- `apps/web/src/chain-wallet.ts`
- `apps/web/src/evm-keccak.ts`
- `apps/web/src/m3-browser-runtime.ts`
- `apps/web/src/m3-chain-action-flow.ts`
- `apps/web/src/m3-vault-allowance.ts`
- `apps/web/src/m3-vault-client.ts`
- `apps/web/src/m3-vault-live-reader.ts`

The run uses Node `24.21.0`, Node's experimental test coverage, those seven explicit include paths,
and the seven matching test files. It executes `84` tests and does not treat test count as coverage.

## Result

| File | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| `chain-wallet.ts` | 100.00% | 100.00% | 100.00% |
| `evm-keccak.ts` | 100.00% | 100.00% | 100.00% |
| `m3-browser-runtime.ts` | 99.90% | 97.09% | 97.06% |
| `m3-chain-action-flow.ts` | 100.00% | 100.00% | 100.00% |
| `m3-vault-allowance.ts` | 100.00% | 98.41% | 100.00% |
| `m3-vault-client.ts` | 100.00% | 99.19% | 100.00% |
| `m3-vault-live-reader.ts` | 100.00% | 100.00% | 100.00% |
| **Combined** | **99.96%** | **98.51%** | **99.15%** |

Every high-priority front-end semantic branch listed by Macbeth05 is now executed: trusted action
authority, account and chain changes at each wallet checkpoint, Owner mismatch, exact finite
allowance and amount boundaries, live simulation failure, canonical operation evidence, both
permitted reorg degradation reasons, and post-submission ambiguity with and without a transaction
hash.

The remaining zero-count records are defensive invariant branches in `m3-browser-runtime.ts` lines
145, 282, 370, 386, 396, 465, 475, and 701; the deliberately unused adapter observation function at
line 286; the compatibility-only Pass read without configured contract identity at
`m3-vault-client.ts:449`; and Node's synthetic `finally` edge at `m3-vault-allowance.ts:240`. The
runtime branches require impossible states after public constructor and wallet parsing preconditions
or are superseded by an earlier fail-closed return. Successful and failed allowance cleanup,
including a provider whose `removeListener` throws, are tested. These records are retained rather
than deleting guards or adding a test-only production bypass.

## Evidence artifacts

- Spec and coverage log: `/tmp/macbeth04-phase1-coverage.log`
- Log SHA-256: `963df58424a32a7f11b119777eb76dffd65b0e758ba0b64d9b01a3dca770d342`
- LCOV: `/tmp/macbeth04-phase1-coverage.lcov`
- LCOV SHA-256: `f4895727ce696c217276e6eafc1e1cfec455769670fa96d9c05eb2287575d7a1`

The broader eleven-file product-focused run passes `120/120`. The full repository suite executes
`638` tests: `637` pass and the existing shared migration-provenance test fails because Macbeth01
must update the integrated `product-ui.ts` hash. This follow-up introduces no additional full-suite
failure.
