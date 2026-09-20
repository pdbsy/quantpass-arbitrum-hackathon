# Macbeth02 Phase One Acceptance Entrypoint Closure

- Task: `M3-02-PHASE1-CONTRACTS`
- Additive fix based on: `bbf54cc9136a0e40dc7ace300be82b31e0584e39`
- Manager reference: `3a78e34ba933f1e3239424d3bf0b1e27b1a65bb8`
- Boundary: local/offline; no RPC, signing, broadcast or hosted checks

## Finding and correction

The documented repository-root invocation of `contracts/script/check-phase1-contracts.sh`
left its final standalone Forge rehearsal in the caller's working directory. The earlier
`check-local.sh` changes directory in its own child process, which does not change its parent.
Read-only inspection using the existing pinned Forge confirmed that the repository root resolves
default settings (`solc: null`, automatic compiler detection, EVM `prague`, output `out`), whereas
`contracts/` resolves the approved compiler, disabled detection, EVM `paris` and task-local output.
The final command explicitly sets `--offline`, but that flag alone does not select the contract
project, compiler or rehearsal source. Its invocation was therefore not reliable evidence that
the two intended tests executed under the locked contract configuration.

The entrypoint now changes to its resolved `CONTRACT_ROOT` before running its stages. No Solidity,
accounting rule, deployment parameter, compiler setting or dependency version changes.

## Focused verification

`test_phase1_gate_entry.py` invokes the real shell entrypoint in a temporary directory containing
spaces from three caller locations: repository root, contract root and an unrelated directory.
It substitutes the expensive preceding gates to avoid recursively running the full suite, and
observes the final child-process directory. This is an entrypoint regression, not Solidity evidence.

- Before the fix: the regression failed for the repository-root and unrelated callers; the
  contract-root caller already passed. Both original failing transcripts remain intact locally.
- After the fix: the regression passes for all three callers.
- Real pinned Forge configuration was then checked from `contracts/`; solc remains the local
  `0.8.31` executable, automatic detection is disabled, offline mode is enabled and EVM is `paris`.
- The affected real command `forge test --offline --match-path
  test/Phase1DeploymentRehearsal.t.sol` passed **2/2**, with compilation skipped because no Solidity
  files changed. It ran with a cleared environment and the task-local pinned tools.
- The unchanged full Solidity, fuzz, invariant, Slither and coverage suites were not rerun.
  This does not create a new 134-test or 25-Python-test aggregate execution claim.

Public transcript: `evidence/Macbeth02-entrypoint-cwd-regression.log`.
SHA-256: `25b200f8219c655352cb390fbde9ffc2ca2fcfdf20c418e20f3025a887f112f0`.
The public copy redacts the task-root path and normalizes trailing whitespace; it records raw hashes and
locations under `.checks/af-chain01/evidence/`. Raw failure logs are not overwritten.

## Source equivalence and historical evidence

`bbf54cc`, `a130529` and manager source `3a78e34` retain the same complete contract tree
`0fa7e3e471f32a6d6b742e42540add6e047b536a`. That historical proof is unchanged. After this additive
fix, the complete `contracts/` tree will differ by the shell entrypoint and its new Python regression;
the prior complete-tree claim must not be applied to the new head without accounting for that delta.

`contracts/src`, Solidity `contracts/test`, `contracts/deployment`, `foundry.toml`,
`toolchain.lock.json`, `requirements-slither.lock` and `openzeppelin-pragma-pins.json` remain
identical to the manager reference. Thus the existing production-code, ABI, bytecode, manifest and
coverage evidence remains applicable to unchanged inputs, alongside this new entrypoint evidence.

The historical full contract gate includes `Phase1DeploymentRehearsal.t.sol` in the Solidity suite
executed from `contracts/`. That evidence remains valid. Earlier prose describing the final
standalone stage as an additional two-test execution should be read with this correction; the new
focused transcript provides the explicit two-test execution under the correct configuration.

## Integration handoff

Integrate the entrypoint fix, regression and this additive evidence after `bbf54cc`, retaining
original commits, logs and authors. For a new manager candidate, compare production/test/config
objects and account separately for this two-file script delta. The acceptance entry remains
`bash contracts/script/check-phase1-contracts.sh` from the repository root; the entry now selects
its project explicitly. Its Python discovery includes the new regression on the next authorized
complete run.

The four management collector entries remain `NOT_RUN / NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR`.
This local fix supplies no hosted status, independent approval, merge or deployment authorization.
