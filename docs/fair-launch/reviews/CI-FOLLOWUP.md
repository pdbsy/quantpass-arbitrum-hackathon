# Draft PR CI follow-up

Draft PR [#47](https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/47) preserves the original source history. Initial published head: `72ca153da595809e2e54ca29707256a4745e126b`. This note records actual failures and a focused correction; it does not approve a merge or any target-chain operation.

The first [Engineering pull-request run](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/37914995762) passed identity, governance configuration, source-policy, Semgrep, Gitleaks and container checks. Both contract platforms passed 217 Solidity tests, then stopped at the unchanged Slither admission gate. Three-platform verification stopped at four formatting failures. Dependency audit reported source-map-js, and OSV additionally reported multidict. The [Fair Launch run](https://github.com/pdbsy/quantpass-arbitrum-hackathon/actions/runs/37914995830) stopped at the missing exact runner profile before its EVM stage. These failures remain visible in the original runs.

The correction is limited to:

- Exact `fair-launch-local-evm` admission on Linux x64 / `ubuntu-24.04`, with tests rejecting unknown jobs, wrong architecture/platform and runner-profile drift.
- Prettier formatting of only the four files named by the hosted check. Their data and behavior are preserved.
- The compatible source-map-js leaf update from 1.2.1 to 1.2.2, official registry SHA-512 integrity and the canonical generated npm SPDX document. Direct dependencies and the rest of the resolved graph remain unchanged. [Official advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- multidict 6.8.0 to 6.9.1 in the existing Linux x64 and Darwin arm64 CPython 3.12 wheel locks. Each exact wheel URL/hash and its requirements/manifest checksum is updated; Slither remains 0.11.3. [Official advisory](https://github.com/advisories/GHSA-54p9-h82j-f925).

The reviewed immutable implementation patch against `72ca153` has SHA-256 `c3227ffee1cefde13d0a5847d78e9a2bcd710f807552e18ada282fc775a64043` and contains 14 files. Delivery notes and their checksum index are appended separately. Solidity sources, compiler settings, admission records, detector configuration, required checks and protected-branch rules are unchanged.

Actual local outcomes:

| Check | Result |
| --- | --- |
| Exact Node 24.21.0 / npm 11.19.1 install | PASS, `npm ci --ignore-scripts`, 203 platform packages |
| npm audit of the lock, including development/optional dependencies | PASS, zero reported vulnerabilities |
| Environment, environment-CI and launch adapter subset | PASS, 20/20 |
| Supply-chain/workflow boundaries | PASS, 51/51 |
| Canonical SPDX / supply-chain CLI | PASS |
| Server and web TypeScript checks | PASS |
| Web build with the patched source-map dependency | PASS |
| Changed source formatting and lint | PASS |
| Linux offline hash-locked Python bootstrap / `pip check` | PASS |
| Existing Python toolchain boundary tests | PASS, 34/34 |
| Darwin arm64 exact 47-wheel dependency resolution | PASS; native Darwin execution NOT_RUN locally |
| multidict reference-leak regression | 5,000 leaked references per vulnerable operation before; zero after the patch |
| Slither tool compatibility | Scan completed with the exact same 53 finding IDs; 44 still unapproved, admission BLOCKED |

The actual scoped Python/toolchain execution receipt is retained verbatim as [ci-dependency-toolchain.json](../evidence/ci-dependency-toolchain.json), SHA-256 `6bb1316fa8a10140aeaf0f1f352e00381881520c3adc8d71bc248bd62b37fa53`. It distinguishes isolated Linux execution from Darwin graph resolution. [npm-audit-patched.json](../evidence/npm-audit-patched.json) is the actual registry audit response. Independent review found no gate weakening or patch regression; it still requires hosted results on the new head and does not authorize merging.

Retained private log SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| npm install | `7cde22c4a6298c670267f9bf330adc3e9b8fbfc1a8216b7050f86c98c80302c1` |
| npm audit JSON | `a20ec65f8005c0b270e697f12f2ddec85faab06a8fd3dacb49e6acd13a2a0994` |
| Supply-chain tests | `7b43e19e4f47122f8ed70d9feedc3af3e390e515cc706d825cc060d46589f88c` |
| Web build | `82b7f4a6702034c348bb3fcc20f964edcd23b1d0366216ccec887319cbcc94b0` |
| TypeScript checks | `2a6a2c0222a96232b5dd3dea2c3e4411abfc22401c3a741d0a8e3f88ad508016` |

Hosted checks must run on the updated PR head; their actual results supersede these local diagnostics. Slither's 44 additional reports are still unapproved and its admission remains BLOCKED. The managed Codex Security scan is NOT_RUN because the required MCP tools are unavailable. No Testnet deployment, signing, broadcasting, funding or production-service change has occurred.
