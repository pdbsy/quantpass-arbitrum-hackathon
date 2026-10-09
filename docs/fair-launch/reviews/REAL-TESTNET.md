# Real wallet and Robinhood Testnet progress

The user authorized a real cryptocurrency wallet and a faucet/deployment/trading test, with fixes followed by retesting. This work has not completed the target-chain transaction flow. There is no mock wallet or simulated transaction in the target-chain evidence.

## Actual observations on 2026-10-09

- A new randomly generated EVM wallet, `0x5a2Acf1a388FE4f19aEfFA404e07E916B5b07B77`, was stored in an owner-only encrypted server keystore. Decryption and a genuine message-signature recovery proved possession of the key. No private key, mnemonic or unlock secret was logged or committed. This is a test wallet held by the project server, not an existing user wallet.
- An actual read from the official RPC verified chain 46630. At block `131683940`, hash `0x4eb7c12d4332f0a38ee6106e68a5b0ec7bb4bd2ffaab316cd89dae30d90d8a85`, the new wallet had zero native ETH, pending nonce 0 and no contract code. Gas price was 10,000,000 wei.
- The official faucet returned HTTP 429. A normal Chromium visit also reached Vercel Security Checkpoint, then “Failed to verify your browser”, code 21. No captcha was bypassed or claim submitted. The user was asked to claim in their own browser or transfer test ETH to this public address.
- Independent quote and claim signing keys were generated and encrypted separately from the deployment wallet. These identities have not been configured in a contract or activated in a service.
- A draft unsigned plan contains 15 deployments and 26 ordinary configuration/funding transactions, plus two reference-update preparation steps. It is explicitly DRAFT_NOT_APPROVED. The original approved LP/proceeds address remains `0x86767116cd40bf6b4f8cf88e08d11e38b04364cf`; the draft does not imply approval of the proposed supply, reserves or instance scope.
- Actual Coinbase/Kraken reference reads passed the existing age/deviation checks: two-second data age and one basis-point deviation at the recorded observation. This is a real data-source read, not a signed quote or trade.

## Concrete fixes

The funds client previously called `/auth/session`; the actual access service has `/auth/me`, and the obsolete route returned 404. The client now uses `/auth/me`, requires Google `authKind` before accepting bounded CSRF, clears denied CSRF and never automatically retries a funds request. Website/password identities do not qualify. The server remains authoritative for verified email, subject, whitelist, expiry, revocation, wallet ownership and mutation CSRF.

The planner now rejects a zero retained ETH reserve before generating a deployment. The actual reserve constructor rejects that value; discovering it only during deployment would consume a nonce and invalidate remaining CREATE predictions.

The new target preflight is read-only and allows only the official Testnet RPC and read/simulation methods. It rechecks the unsigned plan, pinned compiler/source graph, canonical block, account nonces, predicted CREATE addresses, actual balances and finite budgets. Empty wallets stay BLOCKED; future deployments, signing and funding stay NOT_RUN. Conservative funding bounds and the first deployment's estimate cannot become a full undeployed graph's actual gas estimate. It neither reads signing credentials nor broadcasts transactions.

## Validation and remaining prerequisites

The client suite passed 16 checks. Independent client/identity adapter verification passed 19 checks, with eight additional temporary-database identity rejection checks. These are local authentication boundary tests, not a successful production Google session or Testnet free claim. TypeScript and scoped lint/format checks passed for the client repair.

The planner/preflight suite passed 12 checks and independent patch review. The new suite is registered in the existing artifact test command, whose CI job builds the required compiler artifacts first. Both TypeScript projects, scoped lint/format, supply-chain checks and the deployed-path website build passed. The baseline secret check passed over 1,217 tracked/unignored files after rerunning with permission to launch its Git subprocess; it is a bounded check, not a full security scan.

Actual official-RPC wallet observation and draft-plan preflight were run. Both correctly remained BLOCKED: balance 0, nonce 0, deployment/signing/broadcast/funding NOT_RUN. The draft-plan check verified the 15 predicted deployment addresses were empty, source/artifact evidence matched and the execution limit was 32,000,000 gas. Its only funding blocker was the unfunded wallet; this does not approve the draft inputs or bypass security admission. An initial parallel wallet read returned no report; the subsequent sequential CLI read completed, retaining the explicit blocked state. There was no retry of a signed transaction or faucet submission.

Target-chain faucet receipt, deployment, AF-USDC claim, PASS subscription/trades, final-Mint launch and Vault transactions remain **NOT_RUN**, with zero transactions broadcast. Production reader remains NOT_DEPLOYED without a manifest, RPC, identity bridge or activated signing keys.

Continuation requires real test ETH, the pending decision on isolated/shared deployment and exact funding parameters, the unchanged contract security admission, and a legitimate verified Google account for the actual free-claim flow. The current reader cannot read the access database directory; any identity bridge must preserve session permissions rather than copy or invent a user session. Stock execution also requires the separately authorized fresh feed/calendar; the display chart is not an execution source.

The existing Slither admission permits nine specific reviewed reports. Another 44 reports have bounded review explanations and unchanged source hashes but lack explicit risk approval. They are not 44 confirmed exploits, and deployment authorization does not silently modify this gate. No detector, required check or admission record was changed. Actual public observations, browser checkpoint screenshot and private unsigned preparation are retained on the server; private wallet files are excluded from Git.
