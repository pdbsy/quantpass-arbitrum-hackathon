# AlphaForge read-only RPC qualification

## Delivered behavior

`tools/automata/probe-rpc.ts` captures a bounded diagnostic snapshot through the existing JsonRpcClient. It exposes no signing, allowance, broadcast or mainnet application-runtime enablement. Its only RPC methods are eth_chainId, eth_getBlockByNumber, eth_getCode and eth_call.

Input validation precedes network activity. Each capture uses one configured endpoint with no automatic provider rotation or retry, a five-second per-request deadline and a thirty-second total deadline. It accepts at most 16 unique contracts and 32 combined code/read operations. HTTP bodies are bounded to 256 KiB; code and returned call bytes to 64 KiB each. External cancellation prevents queued network work and terminates an uncooperative injected transport at the caller boundary.

For an explicit block number, the expected block hash is mandatory. For an explicitly requested `latest` discovery, hash must be null; the first resolved header is then pinned. All bytecode and contract reads use EIP-1898 `{blockHash, requireCanonical: true}`. The collector re-reads the same block number and chain ID before publishing any observations. Wrong chain, missing/wrong block, empty bytecode, unsupported canonical-hash reads, header drift/reorg, invalid clocks and upstream errors reject the capture. A rejection clears provisional contract observations; there is no fallback to latest.

The report contains normalized observations, read-only requests, HTTP status, receipt times and SHA-256 digests of transport response text. It deliberately excludes endpoint URLs and upstream error bodies/messages, which may contain provider credentials. Digests refer to the transport's decoded text, not TLS packets or an independently authenticated chain proof. The existing transport enforces HTTPS and refuses redirects.

A CAPTURED report is evidence of the particular reads that succeeded against that endpoint at that time. It is not finality, audited bytecode equivalence, canonical official-token admission, complete archive coverage, Uniswap liquidity or fork-execution evidence. Complete fork support still requires the relevant historical storage/balance/nonce methods and an actual isolated fork test. Provider honesty and transport integrity remain trust assumptions; this is not a light-client proof or independent provider quorum.

## Operator command

Use the pinned repository Node version. Configure `AF_READONLY_RPC_URL` locally with an authorized read-only endpoint; never put API keys or private keys in chat, tracked configuration or output artifacts. The command does not create credentials or provision a provider account.

```text
node tools/automata/probe-rpc.ts --help
node tools/automata/probe-rpc.ts request.json new-capture.json
```

The request file is bounded to 128 KiB. The output parent must already exist at its canonical path. Output must be new: a complete report is flushed to a private temporary file and published through an exclusive hard link, then the temporary name is removed. Existing files and symlinks cannot be overwritten. This provides atomic publication on filesystems supporting hard links; it does not promise durable directory metadata across power loss. A force-killed process may leave its uniquely named temporary file; incomplete files are never successful reports.

Exit 0 means CAPTURED; exit 1 means rejected capture or input/output failure; exit 2 means invalid command arguments or absent endpoint configuration. Offline help never accesses the endpoint. A rejected network capture is also published for diagnosis when the output destination is valid. Input/output failures do not print path or provider details.

Example research request: inspect the documented V3 factory and V4 PoolManager together. These are read-only candidates, not a decision to use both versions for execution, and do not enable any trading asset:

```json
{
  "chainId": 4663,
  "block": { "number": "latest", "hash": null },
  "contracts": [
    {
      "address": "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
      "calls": []
    },
    {
      "address": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      "calls": []
    }
  ]
}
```

For a repeatable historical read, replace `block.number` with the captured decimal block number and `block.hash` with the captured hash. `calls`, when used, contain `{ "id": "decimals", "data": "0x313ce567" }` entries. Select calls appropriate to the target contract; eth_call can simulate non-view functions, but this tool never submits their state changes.

Address documentation:
- [Uniswap V3 Robinhood deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments)
- [Uniswap V4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [EIP-1898 canonical block references](https://eips.ethereum.org/EIPS/eip-1898)

## Real connectivity result, 2026-09-30

The saved official public endpoint response identifies Cloudflare error 1010 (access denied), not a transient chain failure. Two separate public alternatives, dRPC and PublicNode, were queried once for eth_chainId and also returned HTTP 403 in this environment. No request fingerprint, user-agent impersonation or access-control bypass was attempted. These observations do not prove that those services are unavailable to other authorized clients.

Original evidence is retained in `.checks/market-data/uniswap-qualification-nassbv8q/` and `.checks/market-data/rpc-alternatives-h242s3y4/`, with timestamps, requests and response digests. None of those probes verified chain identity or archive capability. A usable authorized endpoint remains the external prerequisite; no successful real-chain snapshot or Uniswap fill is claimed.

## Reference journal consistency

`replayReference` now recomputes accepted REST observations from the preserved registry/quote/registry receipts, validates their fixed official URLs, digests and timestamp ordering, and compares both normalized results with the stored projection. MarketJournal checks this before inserting an accepted capture and again on read. A fresh payload checksum alone can no longer bless a fabricated normalized price. Failed captures remain available as diagnostic records.

The collector snapshots its selection before awaiting transport, so a caller cannot change the recorded asset by mutating the original object while a request is in flight. This verifies consistency of collected evidence; a malicious writer able to replace all raw sources and digests is outside the protection offered by checksums. The trusted-source collection and operator-review boundary remains necessary.

## Validation scope

Offline behavior tests cover canonical code/read references, wrong-chain and reorg races, access denial, malformed/oversized inputs and responses, cancellation, clock faults, CLI atomic output/refusal to overwrite, reference recomputation and persisted projection corruption. CI uses fixtures only. No Solidity, wallet authorization, fee, slippage, settlement asset or liquidation-duration configuration changed in this slice. Self-review is not independent approval; hosted CI and actual chain/fork tests are separate from local checks.

## Testnet connection update

Later on 2026-09-30, the user configured Alchemy and enabled Robinhood Testnet for their app. Chain ID 46630, header consistency and canonical-hash code/call method probes passed; `.checks/market-data/testnet-connectivity-A4GkA1/report.json` preserves the successful original record. Earlier failed attempts remain saved. The public Mainnet denial described above does not block this qualified Testnet endpoint. Its API Key remains in a private local file and is absent from tracked code and evidence.

These are empty-address RPC capability probes. They do not verify a token/router deployment or historical fork coverage. See [continuous reference collection](QINFRA-CONTINUOUS-MARKET.md) and [Uniswap scope](QINFRA-UNISWAP-SCOPE.md) for the next independent components.
