# Development environment and task authority

Read docs/DEVELOPMENT-TOOLCHAIN.md and docs/DEVELOPMENT-TOOLCHAIN-STATUS.md before modifying code. Verify the actual repository, branch, HEAD, tool versions and current user assignment. Check package.json before assuming a proposed command exists.

The supplied specification preserves its historical planning state. The current user has assigned ENV-01 through ENV-05 implementation to Macbeth. Darwin remains inactive; do not delegate or start workers. Future tasks and sensitive operations require the user's applicable authorization; historical merge authorization is not permanent.

Use an independent checkout and task branch. Do not share writable node_modules or SQLite data. Do not force push, rewrite history, remove required checks, hide changes or edit generated PASS evidence. Preserve existing authors and history. Keep complete Git history and evidence source refs.

Stay local/mock. Bootstrap, doctor, tests and CI must not sign, broadcast or enable mainnet. Do not introduce credentials or use latest/unreviewed tools. Follow the source C, manifest R and snapshot S evidence workflow. Missing prerequisites stay BLOCKED/NOT_RUN; self-review is not independent approval.

The current product name is AlphaForge, and this repository is the Hackathon edition. Use AlphaForge in new prose, UI and checkout names. Preserve historical evidence, the existing GitHub repository identity and stable protocol/storage identifiers unless a compatibility migration is explicitly assigned. The user approved fnm installation, a permanent AlphaForge checkout, adding verify-macos to required checks, and gated PR merge with actual master validation on 2026-09-12.
