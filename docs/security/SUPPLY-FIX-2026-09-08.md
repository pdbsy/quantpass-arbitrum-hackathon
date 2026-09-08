# PR #6 supply-chain hardening remediation

Status: **implemented and locally verified; final review and remote checks pending**

## Scope and boundary

Baseline: `00c4e35ce8abded0e9a5fec6ee3d07c27fcc4674`.
This change addresses the four reproduced checker gaps, scoped npm PURL encoding,
and the Windows Git-failure fixture recorded during PR #6 review. It does not alter
trading code, enable writes, approve external governance, or update PRs #1–#5.

Repository-controlled workflow text flows through `validateWorkflowText` into the
offline supply-chain gate. Quoting, flow forms and YAML aliases must not hide events,
Action references or effective job permissions from that check. Repository-controlled
policy JSON must not certify an external trust boundary that does not exist.

## Changes

- Pin `yaml@2.9.0` as a development dependency; parse a bounded single YAML 1.2
  document and validate decoded mappings. No regular-expression approximation of
  YAML structure remains in the workflow validator.
- Inspect workflow events, executable step Actions, and explicit or inherited job
  permissions. Fail closed on unsupported structures and unknown workflow/job
  profiles. Keep CodeQL's sole write exception scoped to its analysis job.
- Reject all offline `verified` governance states. This intentionally preserves the
  current blocked state until a separately trusted verifier is implemented; adding
  provider/enforcement-shaped strings or objects cannot unlock it.
- Encode scoped npm PURLs component by component, retaining the namespace/name
  separator. Regenerate the deterministic SPDX document from the updated lock.
- Replace the Unix-only fake Git executable with real missing-object and invalid-tree
  failures in a newly created temporary test repository, restoring the object afterward.
  Production Git execution is unchanged. Add a Windows engineering job alongside the
  existing Linux `verify` check, without changing its name or the repository ruleset.

## Regression evidence

- Before implementation, the supply-chain tests had 29 expected failures out of 39,
  covering the original triggers and alternate representations. The existing Windows
  historical-blob test also failed with a missing expected exception.
- After implementation, the focused supply-chain suite passed 39/39; the Windows
  historical-blob test passed 1/1.
- Legitimate controls include all checked-in workflows, quoted/flow-form safe YAML,
  read-only permissions and explicit reductions, unchanged Git blob reads, and
  scoped/unscoped PURL examples.
- Full local `npm run check` passed on Windows with Node 24.12.0 / npm 11.6.2:
  91/91 tests, type checking, lint, formatting, secret/config/governance/supply-chain/
  threat-model/planning checks and web build. `npm audit --audit-level=high`
  reported zero vulnerabilities. The existing Node SQLite experimental warning remains.
- Final immutable-head security review and required GitHub checks must be recorded
  before this remediation is considered merge-ready.

## Review and limitations

The fresh pre-patch investigator could not run because the account's delegated-agent
usage limit was reached. The parent performed the boundary investigation separately;
that is not independent corroboration. A later reviewer must not count the failed
invocation as a completed review.

No malicious workflow is submitted to GitHub to test these controls. No external
verifier or SBOM consumer has been deployed. This remains defense in depth: an actor
with sufficient authority to replace both the checker and its required workflow is
not contained by this patch. `SUPPLY-001` remains in progress and `GOV-001` remains
blocked; Testnet/mainnet write authority and independent governance are not granted.

## References

- [YAML document/AST API and parse options](https://eemeli.org/yaml/)
- [GitHub workflow and job permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions)
- [Canonical npm PURL type and examples](https://github.com/package-url/purl-spec/blob/main/types/npm-definition.json)
