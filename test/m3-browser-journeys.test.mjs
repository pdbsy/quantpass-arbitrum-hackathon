import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { asAddress, asHexData } from '../packages/chain-adapter/src/types.ts';
import { encodeM3VaultCall } from '../packages/chain-adapter/src/vault-abi.ts';
import {
  createM3InjectedRuntimeFixture,
  m3InjectedRuntimeEvidence,
} from '../apps/web/src/m3-injected-runtime-fixture.ts';
import { analyzeM3WalletRequests, runM3BrowserJourneys } from '../tools/verify-m3-browser.mjs';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const RECIPIENT = asAddress('0x9999999999999999999999999999999999999999');
const VAULT_A = asAddress('0x2222222222222222222222222222222222222222');
const VAULT_B = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const AF_USDC = asAddress('0x3333333333333333333333333333333333333333');

test('browser CLI help documents isolated tool and port inputs without launching a browser', () => {
  const output = execFileSync(process.execPath, ['tools/verify-m3-browser.mjs', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, AF_PLAYWRIGHT_PATH: '/unavailable/no-browser-import.mjs' },
    timeout: 10000,
  });
  assert.match(output, /Usage: node tools\/verify-m3-browser\.mjs/);
  assert.match(output, /AF_M3_BROWSER_PORT/);
  assert.match(output, /AF_M3_BROWSER_EVIDENCE_ROOT/);
});

const browserTool = resolve(
  process.env.AF_PLAYWRIGHT_PATH || '.checks/browser-tools/node_modules/playwright-core/index.mjs',
);
test(
  'real browser CLI rejects nonnumeric, privileged and out-of-range ports before launching a server',
  { skip: !existsSync(browserTool) && 'Approved optional browser tool is not installed' },
  (t) => {
    const evidence = mkdtempSync(join(tmpdir(), 'alphaforge-cli-invalid-port-'));
    t.after(() => rmSync(evidence, { recursive: true, force: true }));
    for (const port of ['not-a-port', '1023', '65536']) {
      const result = spawnSync(process.execPath, ['tools/verify-m3-browser.mjs'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          AF_PLAYWRIGHT_PATH: browserTool,
          AF_M3_BROWSER_EVIDENCE_ROOT: evidence,
          AF_M3_BROWSER_PORT: port,
        },
        timeout: 15000,
      });
      assert.equal(result.error, undefined, port);
      assert.equal(result.signal, null, port);
      assert.equal(result.status, 1, port);
      assert.match(result.stderr, /INVALID_AF_M3_BROWSER_PORT/, port);
      assert.doesNotMatch(result.stdout + result.stderr, /EADDRINUSE|browserType\.launch|ECONNREFUSED/);
    }
  },
);

const word = (value) => value.slice(2).padStart(64, '0');
const amountWord = (value) => value.toString(16).padStart(64, '0');
const send = (to, data) => ({
  method: 'eth_sendTransaction',
  params: [{ from: OWNER, to, data, value: '0x0' }],
});

test('browser journey evidence decodes exact approvals, Pass raw units and Vault actions', () => {
  const requests = [
    send(AF_USDC, asHexData(`0x095ea7b3${word(VAULT_A)}${amountWord(1_000_001n)}`)),
    send(PASS, asHexData(`0x095ea7b3${word(VAULT_A)}${amountWord(1_000_001_000_000_000_000n)}`)),
    send(PASS, asHexData(`0xa9059cbb${word(RECIPIENT)}${amountWord(1n)}`)),
    send(VAULT_A, encodeM3VaultCall('deposit(uint256)', [1_000_001n])),
    send(VAULT_B, encodeM3VaultCall('close()', [])),
  ];

  assert.deepEqual(
    analyzeM3WalletRequests(requests, {
      vaults: [VAULT_A, VAULT_B],
      pass: PASS,
      afUsdc: AF_USDC,
    }),
    [
      { kind: 'APPROVE_AF_USDC', target: AF_USDC, spender: VAULT_A, amount: 1_000_001n },
      {
        kind: 'APPROVE_PASS',
        target: PASS,
        spender: VAULT_A,
        amount: 1_000_001_000_000_000_000n,
      },
      { kind: 'TRANSFER_PASS', target: PASS, recipient: RECIPIENT, amount: 1n },
      { kind: 'DEPOSIT', target: VAULT_A, amount: 1_000_001n },
      { kind: 'CLOSE', target: VAULT_B },
    ],
  );
});

test('browser journey evidence rejects unexpected targets, spenders and malformed wallet sends', () => {
  const options = { vaults: [VAULT_A, VAULT_B], pass: PASS, afUsdc: AF_USDC };
  assert.throws(
    () => analyzeM3WalletRequests([send(RECIPIENT, asHexData('0x1234'))], options),
    /M3_BROWSER_UNEXPECTED_WALLET_TARGET/,
  );
  assert.throws(
    () =>
      analyzeM3WalletRequests(
        [send(AF_USDC, asHexData(`0x095ea7b3${word(RECIPIENT)}${amountWord(1n)}`))],
        options,
      ),
    /M3_BROWSER_UNEXPECTED_APPROVAL_SPENDER/,
  );
  assert.throws(
    () => analyzeM3WalletRequests([{ method: 'eth_sendTransaction', params: [] }], options),
    /M3_BROWSER_INVALID_WALLET_SEND/,
  );
});

test('DEV fixture evidence records runtime identity and real provider activity', async () => {
  const fixture = createM3InjectedRuntimeFixture();
  fixture.setCorrectNetwork();
  await fixture.runtime.connect();
  await fixture.selectSecondVault();

  const evidence = m3InjectedRuntimeEvidence(fixture);
  assert.equal(evidence.snapshot.vaultSelection.selected.vaultAddress, VAULT_B);
  assert.equal(evidence.snapshot.wallet.address, OWNER);
  assert.equal(evidence.snapshot.onchain.owner, 'UNKNOWN');
  assert.equal(
    evidence.providerRequests.some((request) => request.method === 'eth_requestAccounts'),
    true,
  );
  assert.doesNotThrow(() => JSON.stringify(evidence));
});

test('reusable browser workflow rejects non-loopback origins before touching the browser', async () => {
  for (const origin of [
    'https://example.invalid',
    'http://127.0.0.1:4197/path',
    'http://user:password@127.0.0.1:4197',
  ])
    await assert.rejects(
      runM3BrowserJourneys({}, { origin, evidenceDirectory: '/unused' }),
      /M3_BROWSER_REQUIRES_LOOPBACK_ORIGIN/,
    );
});

test('wallet evidence rejects malformed envelopes, nonzero native value, and mismatched token calldata', () => {
  const options = { vaults: [VAULT_A, VAULT_B], pass: PASS, afUsdc: AF_USDC };
  const valid = send(VAULT_A, encodeM3VaultCall('deposit(uint256)', [1n]));
  for (const transaction of [
    null,
    1,
    [],
    {},
    ...['to', 'from', 'data', 'value'].map((field) => {
      const copy = { ...valid.params[0] };
      delete copy[field];
      return copy;
    }),
    ...Object.entries({ to: 'invalid', from: 'invalid', data: '0xnothex', value: '0x1' }).map(
      ([key, value]) => ({ ...valid.params[0], [key]: value }),
    ),
  ]) {
    assert.throws(
      () => analyzeM3WalletRequests([{ method: 'eth_sendTransaction', params: [transaction] }], options),
      /M3_BROWSER_INVALID_WALLET_SEND/,
    );
  }
  for (const [to, data, code] of [
    [PASS, '0x095ea7b3', 'INVALID_APPROVAL'],
    [PASS, `0x095ea7b3${word(VAULT_A)}${amountWord(1n)}00`, 'INVALID_APPROVAL'],
    [VAULT_A, `0x095ea7b3${word(VAULT_A)}${amountWord(1n)}`, 'INVALID_APPROVAL'],
    [PASS, '0xa9059cbb', 'INVALID_PASS_TRANSFER'],
    [PASS, `0xa9059cbb${word(RECIPIENT)}${amountWord(1n)}00`, 'INVALID_PASS_TRANSFER'],
    [AF_USDC, `0xa9059cbb${word(RECIPIENT)}${amountWord(1n)}`, 'INVALID_PASS_TRANSFER'],
    [PASS, '0x12345678', 'UNEXPECTED_TOKEN_CALL'],
    [VAULT_A, '0x12345678', 'INVALID_VAULT_CALL'],
    [VAULT_A, '0xb6b55f25', 'INVALID_VAULT_CALL'],
  ]) {
    assert.throws(
      () => analyzeM3WalletRequests([send(to, asHexData(data))], options),
      new RegExp(`M3_BROWSER_${code}`),
    );
  }
  assert.deepEqual(analyzeM3WalletRequests([{ method: 'eth_accounts', params: [] }], options), []);
});

test('wallet evidence preserves exact withdraw and rescue identities and uint256 precision', () => {
  const maximum = (1n << 256n) - 1n;
  const requests = [
    send(VAULT_A, encodeM3VaultCall('withdraw(uint256)', [maximum])),
    send(VAULT_B, encodeM3VaultCall('rescueUntrackedToken(address)', [RECIPIENT])),
    send(VAULT_B, encodeM3VaultCall('rescueNative()', [])),
    send(PASS, asHexData(`0xa9059cbb${word(RECIPIENT)}${amountWord(maximum)}`)),
  ];
  const before = structuredClone(requests);
  assert.deepEqual(
    analyzeM3WalletRequests(requests, { vaults: [VAULT_A, VAULT_B], pass: PASS, afUsdc: AF_USDC }),
    [
      { kind: 'WITHDRAW', target: VAULT_A, amount: maximum },
      { kind: 'RESCUE_UNTRACKED_TOKEN', target: VAULT_B, token: RECIPIENT },
      { kind: 'RESCUE_NATIVE', target: VAULT_B },
      { kind: 'TRANSFER_PASS', target: PASS, recipient: RECIPIENT, amount: maximum },
    ],
  );
  assert.deepEqual(requests, before);
});
