# AlphaForge Testnet dependency review

Status: APPROVED by the user on 2026-10-01 for ethers 6.17.0 and the listed locked graph. Installation uses disabled lifecycle scripts. Licensing policy disposition and complete release checks remain required.

Wallet address recovery, ABI encoding and isolated executor transaction construction need a maintained implementation. Candidate: ethers 6.17.0, official npm registry, exact pins and lifecycle scripts disabled. The application will use its local cryptographic/encoding functions; its automatic provider discovery, ENS, CCIP, AlchemyProvider and network fallbacks will not be used. Existing bounded, chain-checked transport remains authoritative.

Official release: https://github.com/ethers-io/ethers.js/releases/tag/v6.17.0
Official source commit from npm gitHead: `b48bfe34b11e059c4418718f9cad4e6cbe4c0680`.

A separate metadata-only resolution on 2026-10-01 used Node 24.21.0 / npm 11.19.1. npm audit returned zero known advisories for this exact candidate graph. This is not an independent security audit. The graph includes older crypto libraries and a prerelease aes-js transitively; versions remain explicit review inputs, not hidden upgrades. Acceptance requires root lockfile/SBOM checks and the full existing CI matrix.

| Package | Version | License |
| --- | --- | --- |
| @adraffy/ens-normalize | 1.11.1 | MIT |
| @noble/curves | 1.2.0 | MIT |
| @noble/hashes | 1.3.2 | MIT |
| @types/node | 22.7.5 | MIT |
| aes-js | 4.0.0-beta.5 | MIT |
| ethers | 6.17.0 | MIT |
| tslib | 2.7.0 | 0BSD |
| undici-types | 6.19.8 | MIT |
| ws | 8.21.0 | MIT |

Candidate lockfile SHA-256: `1426537eba651c058b2b882916d0fb6b875eef8743b1e28cb4c76fa8df948613`.
Ethers tarball integrity: `sha512-BpyrpIPJ3ydEVow8zGaz1DuPS7YU8DcWxuBnY9a0UA/lvAPwrMr+EPXsfrul628SRaekPNeIM4UFh/91GWZang==`.

Approval covers only this version and its listed locked graph. No signature or broadcast is performed by doctor, bootstrap, tests or CI. Browser authentication signatures and operator execution remain distinct runtime capabilities.

## Official V3 artifacts (user-approved)

Actual V3 protocol qualification and later Testnet deployment will use only the official, integrity-checked creation/runtime bytecode and ABI artifacts listed below. No old JavaScript/Hardhat/OpenZeppelin dependency graph is installed. No compiler change is proposed. Upstream licenses and source links must travel with these artifacts.

| Official release | Selected artifacts | Tarball SHA-256 |
| --- | --- | --- |
| @uniswap/v3-core 1.0.1 | UniswapV3Factory | `141b001e2a376fff867cb24e0713b2834095cb1250c13aae263d9a646446d329` |
| @uniswap/swap-router-contracts 1.3.1 | QuoterV2, SwapRouter02 | `efad19ccb35c90338981f06ef7acc6daa5cce7a8139611167270eb7b2a1e26df` |

Core's original BUSL-1.1 notice specifies a change date no later than 2023-04-01 and GPL-2.0-or-later as its change license. The original notice remains preserved. Router/Quoter artifacts are declared GPL-2.0-or-later. These are outside the current npm license allowlist; the proposal is an artifact-specific admission, not a global GPL allowlist. Original sources: https://github.com/Uniswap/v3-core/tree/ed88be38ab2032d82bf10ac6f8d03aa631889d48 and https://github.com/Uniswap/swap-router-contracts/tree/550c0f20373a487996fcc957075377b67af9df07 .

Also approved: an exact license admission for npm `tslib@2.7.0` under 0BSD, part of the already approved ethers graph. No other 0BSD package/version is admitted. New/replaced versions require renewed review. User-approved review expiry for both narrow admissions: 2026-11-01; expired admissions block release rather than silently renew.

The user approved both exact license admission scopes on 2026-10-01. No global GPL or 0BSD admission is introduced.
