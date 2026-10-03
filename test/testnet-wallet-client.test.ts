import assert from 'node:assert/strict';
import test from 'node:test';
import { TestnetWalletClient } from '../apps/web/src/testnet-wallet-client.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';
const owner = '0x' + '11'.repeat(20),
  other = '0x' + '22'.repeat(20),
  vault = '0x' + '33'.repeat(20),
  pass = '0x' + '44'.repeat(20),
  usdc = '0x' + '55'.repeat(20);
const origin = 'https://test.alphaforge.example';
const accountVault = (identity = owner) => ({
  id: identity === owner ? 'alice-vault' : 'bob-vault',
  status: 'HEALTHY',
  manifest: { vault, pass, usdc, manifestDigest: '00'.repeat(32) },
  snapshot: { owner: identity },
  performance: null,
});
function challenge() {
  const store = new WalletAuthStore(':memory:', origin, {
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxRows: 10,
  });
  try {
    return store.issue(owner, Date.now());
  } finally {
    store.close();
  }
}
test('wallet login verifies identity again; account or chain changes prevent an owner transaction request', async () => {
  let current = owner,
    chain = '0xb626';
  const calls: string[] = [];
  const provider = {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      calls.push(method);
      if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [current];
      if (method === 'eth_chainId') return chain;
      if (method === 'personal_sign') return '0x' + '01'.repeat(65);
      throw new Error('unexpected wallet side effect');
    },
  };
  const api = async (path: string) =>
    path.endsWith('challenge') ? challenge() : path.endsWith('verify') ? { owner, chainId: 46630 } : {};
  const client = new TestnetWalletClient(provider, api, origin);
  await client.login();
  assert.equal(client.owner, owner);
  const identity = { owner, vault, pass, usdc, blockTimestamp: '1000' };
  current = other;
  await assert.rejects(client.assertOwner(identity), /WALLET_IDENTITY_CHANGED/);
  assert.equal(calls.includes('eth_sendTransaction'), false);
  current = owner;
  chain = '0x1237';
  await assert.rejects(client.assertOwner(identity), /WALLET_WRONG_CHAIN/);
  assert.equal(calls.includes('eth_sendTransaction'), false);
});
test('unsigned preview tampering cannot reach a wallet send or acquire authority from a login', async () => {
  let sends = 0;
  const provider = {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [owner];
      if (method === 'eth_chainId') return '0xb626';
      if (method === 'personal_sign') return '0x' + '01'.repeat(65);
      if (method === 'eth_sendTransaction') {
        ++sends;
        throw new Error('not approved in verification');
      }
      throw new Error();
    },
  };
  const api = async (path: string) =>
    path.endsWith('challenge') ? challenge() : path.endsWith('verify') ? { owner, chainId: 46630 } : {};
  const client = new TestnetWalletClient(provider, api, origin);
  await client.login();
  await assert.rejects(
    client.send(
      { owner, vault, pass, usdc, blockTimestamp: '1000' },
      { kind: 'STOP' },
      { from: owner, to: other, data: '0x43d726d6', value: '0x0', chainId: '0xb626', kind: 'STOP' },
    ),
    /WALLET_PREVIEW_MISMATCH/,
  );
  assert.equal(sends, 0);
});
test('a login prompt must bind the current HTTPS domain, chain, account, nonce and login-only statement', async () => {
  let signatures = 0;
  const provider = {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [owner];
      if (method === 'eth_chainId') return '0xb626';
      if (method === 'personal_sign') {
        ++signatures;
        throw new Error('unexpected prompt');
      }
      throw new Error();
    },
  };
  for (const mutate of [
    (v: ReturnType<typeof challenge>) => ({ ...v, message: 'Authorize all trades' }),
    (v: ReturnType<typeof challenge>) => ({
      ...v,
      message: v.message.replace('Chain ID: 46630', 'Chain ID: 4663'),
    }),
    (v: ReturnType<typeof challenge>) => ({
      ...v,
      message: v.message.replaceAll(origin, 'https://evil.example'),
    }),
    (v: ReturnType<typeof challenge>) => ({ ...v, message: v.message.replace(owner, other) }),
    (v: ReturnType<typeof challenge>) => ({ ...v, nonce: '12'.repeat(24) }),
    (v: ReturnType<typeof challenge>) => ({ ...v, expiresAt: v.expiresAt + 1 }),
  ]) {
    const api = async () => mutate(challenge());
    const client = new TestnetWalletClient(provider, api, origin);
    await assert.rejects(client.login(), /WALLET_CHALLENGE_INVALID/);
  }
  assert.equal(signatures, 0);
});

test('Testnet reads distinguish failed initial read from verified empty and suppress late owner data', async () => {
  const ui = await import('../apps/web/src/testnet-ui-state.ts').catch(() => null);
  assert.ok(ui?.TestnetAccountReader, 'generation-bound Testnet account reader is required');
  const queue: (() => Promise<unknown>)[] = [
    async () => {
      throw new Error('unavailable');
    },
    async () => ({ owner, chainId: 46630, vaults: [] }),
  ];
  const reader = new ui.TestnetAccountReader(async () => queue.shift()!());
  reader.connect(owner);
  await reader.refresh();
  assert.equal(reader.snapshot.phase, 'DISCONNECTED');
  await reader.refresh();
  assert.equal(reader.snapshot.phase, 'EMPTY');
  let finish!: (value: unknown) => void;
  queue.push(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const read = reader.refresh();
  reader.connect(other);
  finish({ chainId: 46630, vaults: [{ id: 'old-owner' }] });
  await read;
  assert.equal(reader.snapshot.owner, other);
  assert.deepEqual(reader.snapshot.vaults, []);
  assert.equal(reader.snapshot.phase, 'LOADING');
});

test('failed or superseded refresh cannot expose a healthy cached Vault or overwrite a newer result', async () => {
  const ui = await import('../apps/web/src/testnet-ui-state.ts').catch(() => null);
  assert.ok(ui?.TestnetAccountReader);
  let result: () => Promise<unknown> = async () => ({ owner, chainId: 46630, vaults: [accountVault()] });
  const reader = new ui.TestnetAccountReader(async () => result());
  reader.connect(owner);
  await reader.refresh();
  assert.equal(reader.snapshot.phase, 'READY');
  result = async () => {
    throw new Error('unavailable');
  };
  await reader.refresh();
  assert.equal(reader.snapshot.phase, 'STALE');
  assert.equal(reader.snapshot.vaults.length, 1, 'cache may be displayed only with stale state');
  let reject!: (error: Error) => void;
  result = () =>
    new Promise((_resolve, no) => {
      reject = no;
    });
  const older = reader.refresh();
  result = async () => ({ owner, chainId: 46630, vaults: [] });
  await reader.refresh();
  reject(new Error('late failure'));
  await older;
  assert.equal(reader.snapshot.phase, 'EMPTY');
  assert.equal(reader.snapshot.error, null);
  reader.connect(null);
  assert.deepEqual(reader.snapshot.vaults, []);
  assert.equal(reader.snapshot.phase, 'DISCONNECTED');
});

test('corrupt or ambiguous retained intent never becomes permission to send again', async () => {
  const ui = await import('../apps/web/src/testnet-ui-state.ts').catch(() => null);
  assert.ok(ui?.parseTestnetIntent);
  assert.deepEqual(ui.parseTestnetIntent('{"kind":"STOP","operationId":"operation-1","hash":null}'), {
    kind: 'STOP',
    operationId: 'operation-1',
    hash: null,
  });
  for (const raw of [
    '{',
    'null',
    '{}',
    '{"kind":"UNKNOWN","operationId":null,"hash":null}',
    '{"kind":"STOP","operationId":null,"hash":null}',
    '{"kind":"STOP","operationId":"operation-1","hash":"bad"}',
  ])
    assert.throws(() => ui.parseTestnetIntent(raw), /INTENT_STORAGE_INVALID/);
});

test('slow account reads finish before periodic polling schedules another request', async (t) => {
  const ui = await import('../apps/web/src/testnet-ui-state.ts');
  assert.ok(ui.pollTestnetAccount, 'polling must wait for a bounded read to finish');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reads = 0;
  let complete!: (value: unknown) => void;
  const reader = new ui.TestnetAccountReader(() => {
    reads++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  reader.connect(owner);
  const stop = ui.pollTestnetAccount(reader);
  t.mock.timers.tick(5000);
  t.mock.timers.tick(10000);
  assert.equal(reads, 1, 'a slow request must not be perpetually superseded');
  complete({ owner, chainId: 46630, vaults: [] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reader.snapshot.phase, 'EMPTY');
  t.mock.timers.tick(5000);
  assert.equal(reads, 2);
  stop();
  reader.connect(null);
  complete({ chainId: 46630, vaults: [{ id: 'late' }] });
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(10000);
  assert.equal(reads, 2);
  assert.deepEqual(reader.snapshot.vaults, []);
});

test('shared-session changes cannot publish Bob data or empty results under Alice', async () => {
  const { TestnetAccountReader } = await import('../apps/web/src/testnet-ui-state.ts');
  for (const vaults of [[accountVault(other)], []]) {
    let response = { owner, chainId: 46630, vaults: [accountVault()] };
    const reader = new TestnetAccountReader<ReturnType<typeof accountVault>>(() => Promise.resolve(response));
    const emitted: (typeof reader.snapshot)[] = [];
    reader.subscribe((state) => emitted.push(state));
    reader.connect(owner);
    assert.equal(await reader.refresh(), true);
    response = { owner: other, chainId: 46630, vaults };
    const before = emitted.length;
    assert.equal(await reader.refresh(), false);
    assert.equal(reader.snapshot.owner, null);
    assert.equal(reader.snapshot.phase, 'DISCONNECTED');
    assert.equal(reader.snapshot.error, 'TESTNET_ACCOUNT_IDENTITY_CHANGED');
    assert.deepEqual(reader.snapshot.vaults, []);
    assert.ok(!emitted.slice(before).some((state) => state.vaults.some((v) => v.snapshot?.owner === other)));
    assert.equal(await reader.refresh(), false, 'manual login is required; reads do not reconnect');
  }
});

test('owner-bound responses reject missing or invalid identities and contradictory snapshots', async () => {
  const { TestnetAccountReader } = await import('../apps/web/src/testnet-ui-state.ts');
  const invalid: unknown[] = [
    { chainId: 46630, vaults: [] },
    { owner: null, chainId: 46630, vaults: [] },
    { owner: 'malformed', chainId: 46630, vaults: [] },
    { owner: '0x' + '00'.repeat(20), chainId: 46630, vaults: [] },
    { owner, chainId: 46630, vaults: [{ ...accountVault(), snapshot: {} }] },
    { owner, chainId: 46630, vaults: [{ ...accountVault(), snapshot: { owner: 'malformed' } }] },
    { owner, chainId: 46630, vaults: [{ ...accountVault(), snapshot: { owner: other } }] },
    { owner, chainId: 46630, vaults: [{ ...accountVault(), snapshot: undefined }] },
  ];
  for (const value of invalid) {
    let response: unknown = { owner, chainId: 46630, vaults: [accountVault()] };
    const reader = new TestnetAccountReader(() => Promise.resolve(response));
    reader.connect(owner);
    await reader.refresh();
    response = value;
    assert.equal(await reader.refresh(), false);
    assert.equal(reader.snapshot.owner, null);
    assert.equal(reader.snapshot.phase, 'DISCONNECTED');
    assert.deepEqual(reader.snapshot.vaults, []);
    assert.match(reader.snapshot.error!, /TESTNET_ACCOUNT_IDENTITY_(INVALID|CHANGED)/);
  }
});

test('same-owner envelope binds both verified empty and unavailable snapshot views', async () => {
  const { TestnetAccountReader } = await import('../apps/web/src/testnet-ui-state.ts');
  for (const vaults of [[], [accountVault()], [{ ...accountVault(), status: 'SYNCING', snapshot: null }]]) {
    const reader = new TestnetAccountReader(() => Promise.resolve({ owner, chainId: 46630, vaults }));
    reader.connect(owner);
    assert.equal(await reader.refresh(), true);
    assert.equal(reader.snapshot.owner, owner);
    assert.equal(reader.snapshot.phase, vaults.length ? 'READY' : 'EMPTY');
    assert.deepEqual(reader.snapshot.vaults, vaults);
  }
});

test('a superseded mismatched identity cannot log out a newer slow owner read', async () => {
  const { TestnetAccountReader } = await import('../apps/web/src/testnet-ui-state.ts');
  let finish!: (value: unknown) => void;
  let response = () =>
    new Promise<unknown>((resolve) => {
      finish = resolve;
    });
  const reader = new TestnetAccountReader<ReturnType<typeof accountVault>>(() => response());
  reader.connect(owner);
  const older = reader.refresh();
  reader.connect(other);
  response = () => Promise.resolve({ owner: other, chainId: 46630, vaults: [accountVault(other)] });
  await reader.refresh();
  finish({ owner: 'malformed', chainId: 46630, vaults: [accountVault()] });
  await older;
  assert.equal(reader.snapshot.owner, other);
  assert.equal(reader.snapshot.phase, 'READY');
  assert.equal(reader.snapshot.vaults[0]!.snapshot.owner, other);
  assert.equal(reader.snapshot.error, null);
});
