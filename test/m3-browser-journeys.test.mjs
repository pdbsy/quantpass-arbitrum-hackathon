import assert from 'node:assert/strict';
import { test } from 'node:test';
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
