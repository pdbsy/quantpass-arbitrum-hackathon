# Executed static security checks

Source: `223d0d1b417b5b4de42319d3ed6bccbaf9a26126`, 2026-10-09. These are actual repository-pinned scanner executions, separate from a Codex Security managed scan or a hosted GitHub approval.

| Check                        | Actual outcome                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semgrep 1.177.0              | PASS: 300 JS/TS/Python source files, 22 rules, 44 positive/negative canaries, zero findings and zero errors                                                                   |
| Slither 0.11.3               | Scan completed, `success=true`; pedantic exit 255 because findings are present                                                                                                |
| Unchanged Slither admissions | BLOCKED: 53 findings instead of the exact approved set of 9; actual admission exit 1, `SLITHER_FINDINGS_CHANGED`                                                              |
| Original nine approvals      | Their exact IDs, source hashes and expiry still match; their approval does not extend to new contracts                                                                        |
| New findings                 | 44 unapproved: 19 exact settlement equalities, 4 reentrancy/call-order reports, 13 timestamp reports, 5 assembly reports, 2 interface reports and 1 generated-bytecode report |

All findings remain visible in [slither-review.json](../evidence/slither-review.json), with IDs, severity, source locations, source hashes and reviewer explanations. No detector, old admission or required check was suppressed. Review explanations are not user risk approval. The compiler report contains zero High, 22 Medium, 23 Low and 8 Informational findings overall; these detector ratings are not independently confirmed exploit severities.

Independent local EVM checks additionally exercised donations to the Router and pool before native buying/selling, and donations to the predicted pool address before the last Mint. Both scenarios succeeded, preserved Router dust and the explicit LP recipient, and did not include donations in the configured initial reserves. These checks address the equality warnings; they do not substitute for all security review.

The complete original Slither output contains environment-specific absolute paths and stays in the private check workspace. The public review preserves its SHA-256, each finding ID and the exact affected source hashes. The original bytes were retained rather than overwritten or claimed to be a sanitized original. Semgrep's retained public execution receipt is [semgrep-static.json](../evidence/semgrep-static.json).

Codex Security managed diff scanning is NOT_RUN: this session does not expose its required scan-start, artifact and completion MCP tools. The plugin's artifact policy explicitly forbids fabricating canonical results through a shell fallback. Codex Security Cloud is a separate available service and requires the user's explicit selection before launching it. No canonical Codex Security report, SARIF or completed scan ID has been invented.

The new CI publication work fixes full-history checkout and records the new read-only workflow's exact supply-chain profile. Historical migration hashes are checked against their actual immutable migration snapshot, without rewriting the historical manifest. The task's ordinary `codex/` branch preserves the exact 71 imported source commits; its exception is bound to a single branch and source anchor, rejects rewritten/missing history, forks and new worker identity claims, and does not grant merge or on-chain authority.

PR publication preserves original Git objects through a checksum-verified bundle and a temporary GitHub Actions job. That job uses only its ephemeral repository token, checks the exact source and tree, and pushes the new task branch without force. It never executes the candidate application or changes the protected branch. Actual hosted checks and the new Slither findings must be resolved before any merge; target Testnet deployment remains unauthorized.
