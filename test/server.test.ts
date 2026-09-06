import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../apps/server/src/app.ts';
import { LocalStore } from '../apps/server/src/store.ts';

const env = { QP_MODE: 'local', QP_ADAPTER: 'mock' };
const origin = 'http://127.0.0.1:4180';
const headers = { host: '127.0.0.1:4180', 'x-quantpass-demo': '1' };
test('static delivery stays inside webroot and finds newly rebuilt assets', async (t) => {
  const directory = await folder(),
    webRoot = resolve(directory, 'web');
  await mkdir(webRoot);
  await writeFile(resolve(webRoot, 'index.html'), '<!doctype html><title>TEST_ONLY</title>');
  await writeFile(resolve(webRoot, '.private'), 'not public');
  const { app } = await buildApp({ dbPath: resolve(directory, 'ledger.sqlite'), env, origin, webRoot });
  t.after(() => app.close());
  const page = await app.inject({ url: '/', headers });
  assert.equal(page.statusCode, 200);
  assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  await writeFile(resolve(webRoot, 'new-build.js'), 'export const scope = "TEST_ONLY";');
  assert.equal((await app.inject({ url: '/new-build.js', headers })).statusCode, 200);
  for (const url of [
    '/.private',
    '/.data/demo.sqlite',
    '/package.json',
    '/%2e%2e/ledger.sqlite',
    '/src/main.tsx',
  ]) {
    assert.ok([403, 404].includes((await app.inject({ url, headers })).statusCode), url);
  }
});
async function folder() {
  await mkdir('.checks', { recursive: true });
  return mkdtemp(resolve('.checks/server-'));
}
async function harness(path?: string) {
  const directory = path || (await folder());
  const options = { dbPath: resolve(directory, 'ledger.sqlite'), env, origin };
  const { app, store } = await buildApp(options);
  async function login(user = 'alice') {
    const result = await app.inject({ method: 'POST', url: '/api/demo/session', headers, payload: { user } });
    assert.equal(result.statusCode, 200);
    assert.match(String(result.headers['set-cookie']), /HttpOnly/);
    assert.match(String(result.headers['set-cookie']), /SameSite=Strict/);
    return String(result.headers['set-cookie']).split(';')[0]!;
  }
  function request(cookie: string, url: string, payload?: unknown) {
    return app.inject({
      method: payload === undefined ? 'GET' : 'POST',
      url,
      headers: { ...headers, cookie },
      ...(payload === undefined
        ? {}
        : {
            payload: JSON.stringify(payload),
            headers: { ...headers, cookie, 'content-type': 'application/json' },
          }),
    });
  }
  async function vault(cookie: string) {
    const result = await request(cookie, '/api/vaults', { strategyId: 'core-flow-demo' });
    assert.equal(result.statusCode, 200);
    return result.json();
  }
  return { app, store, directory, options, login, request, vault };
}

test('complete API journey separates passes, idle, allocation, pending and paid funds', async (t) => {
  const h = await harness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  assert.equal((await h.request(cookie, '/api/strategies')).json()[0].scope, 'TEST_ONLY');
  let state = await h.vault(cookie);
  assert.equal(state.passes, '1000');
  assert.equal(state.idle, '0');
  async function command(id: string, type: string, fields = {}) {
    const result = await h.request(cookie, `/api/vaults/${state.id}/commands`, {
      id,
      type,
      expectedRevision: state.revision,
      ...fields,
    });
    assert.equal(result.statusCode, 200, result.body);
    state = result.json().vault;
  }
  await command('deposit_1', 'deposit', { amount: '1500000000' });
  await command('allocate_1', 'allocate', { amount: '1000000000' });
  assert.equal(state.idle, '500000000');
  assert.equal(state.balances.activeNet, '1000000000');
  await command('start_1', 'start');
  assert.equal(state.status, 'running');
  await command('withdraw_1', 'requestWithdrawal', { amount: '500000000' });
  assert.equal(state.idle, '0');
  assert.equal(state.balances.pending, '500000000');
  assert.equal(state.withdrawalsPaid, '0');
  await command('confirm_1', 'confirmWithdrawal', { withdrawalId: 'withdraw_1' });
  assert.equal(state.balances.pending, '0');
  assert.equal(state.withdrawalsPaid, '500000000');
  await command('stop_1', 'stop');
  assert.equal(state.status, 'stopped');
  assert.equal((await h.vault(cookie)).revision, 6, 'obtaining test passes twice must not reset the ledger');
  const events = (await h.request(cookie, `/api/vaults/${state.id}/audit`)).json();
  assert.equal(events.length, 6);
  assert.equal(events[0].command_type, 'stop');
});

test('repeated and competing requests cannot deposit twice or overwrite a revision', async (t) => {
  const h = await harness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    state = await h.vault(cookie);
  const url = `/api/vaults/${state.id}/commands`;
  const command = { id: 'same_request', expectedRevision: 0, type: 'deposit', amount: '1000000' };
  const results = await Promise.all([h.request(cookie, url, command), h.request(cookie, url, command)]);
  assert.deepEqual(
    results.map((r) => r.statusCode),
    [200, 200],
  );
  assert.equal(results[1]!.json().replayed, true);
  assert.equal(results[1]!.json().vault.idle, '1000000');
  assert.equal((await h.request(cookie, url, { ...command, amount: '2000000' })).statusCode, 409);
  const competing = await Promise.all(
    ['next_a', 'next_b'].map((id) => h.request(cookie, url, { ...command, id, expectedRevision: 1 })),
  );
  assert.deepEqual(competing.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(h.store.get(state.id, 'alice').idle, '2000000');
});

test('rejects unauthenticated, cross-user, cross-origin and malformed requests', async (t) => {
  const h = await harness();
  t.after(() => h.app.close());
  const alice = await h.login(),
    bob = await h.login('bob');
  const state = await h.vault(alice),
    url = `/api/vaults/${state.id}`;
  assert.equal((await h.request('', '/api/vaults')).statusCode, 401);
  assert.equal((await h.request(bob, '/api/vaults')).json().length, 0);
  for (const path of [url, `${url}/audit`]) assert.equal((await h.request(bob, path)).statusCode, 404);
  const command = { id: 'blocked', type: 'deposit', expectedRevision: 0, amount: '1' };
  assert.equal((await h.request(bob, `${url}/commands`, command)).statusCode, 404);
  for (const payload of [
    { ...command, role: 'owner' },
    { ...command, amount: 1 },
    { ...command, amount: '1.1' },
    { ...command, expectedRevision: '0' },
    { ...command, amount: '-1' },
  ]) {
    assert.equal((await h.request(alice, `${url}/commands`, payload)).statusCode, 400);
  }
  for (const extra of [
    { origin: 'https://attacker.invalid' },
    { host: 'attacker.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { 'x-quantpass-demo': '' },
  ]) {
    assert.equal(
      (
        await h.app.inject({
          method: 'POST',
          url: `${url}/commands`,
          headers: { ...headers, cookie: alice, ...extra },
          payload: command,
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(h.store.get(state.id, 'alice').revision, 0);
  await assert.rejects(buildApp({ ...h.options, env: { QP_MODE: 'production', QP_ADAPTER: 'mock' } }));
  await assert.rejects(buildApp({ ...h.options, origin: 'https://example.com' }));
});

test('service restart preserves ledger and receipts but invalidates demo sessions', async () => {
  const first = await harness();
  let stateId: string, oldCookie: string;
  const command = { id: 'before_restart', type: 'deposit', amount: '1500000000', expectedRevision: 0 };
  try {
    oldCookie = await first.login();
    const state = await first.vault(oldCookie);
    stateId = state.id;
    assert.equal(
      (await first.request(oldCookie, `/api/vaults/${stateId}/commands`, command)).statusCode,
      200,
    );
  } finally {
    await first.app.close();
  }
  const second = await harness(first.directory);
  try {
    assert.equal((await second.request(oldCookie!, '/api/vaults')).statusCode, 401);
    const cookie = await second.login();
    const state = await second.vault(cookie);
    assert.equal(state.id, stateId!);
    assert.equal(state.idle, '1500000000');
    const replay = await second.request(cookie, `/api/vaults/${stateId!}/commands`, command);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(replay.json().vault.revision, 1);
  } finally {
    await second.app.close();
  }
});

test('audit insert failure rolls back snapshot update and returns a non-sensitive error', async (t) => {
  const h = await harness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    state = await h.vault(cookie);
  h.store.db.exec(
    "CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'private fixture detail'); END;",
  );
  const result = await h.request(cookie, `/api/vaults/${state.id}/commands`, {
    id: 'rollback',
    type: 'deposit',
    amount: '100',
    expectedRevision: 0,
  });
  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.json(), { error: 'LOCAL_OPERATION_FAILED' });
  assert.equal(h.store.get(state.id, 'alice').idle, '0');
  assert.equal(h.store.get(state.id, 'alice').revision, 0);
  assert.equal(h.store.audit('alice', state.id).length, 0);
});

test('SQLite online backup reopens independently, preserves receipts and does not overwrite', async (t) => {
  const h = await harness();
  t.after(() => h.app.close());
  const state = h.store.obtainTestPasses('alice', 'core-flow-demo');
  const command = {
    id: 'backup_deposit',
    type: 'deposit' as const,
    amount: '123456789',
    expectedRevision: 0,
  };
  h.store.command('alice', state.id, { id: 'alice', role: 'owner' }, command);
  const target = resolve(h.directory, 'backup.sqlite');
  await h.store.backupTo(target);
  await assert.rejects(h.store.backupTo(target), /BACKUP_TARGET_EXISTS/);
  const restored = new LocalStore(target);
  try {
    assert.equal(restored.get(state.id, 'alice').idle, '123456789');
    assert.equal(restored.command('alice', state.id, { id: 'alice', role: 'owner' }, command).replayed, true);
    assert.equal(restored.audit('alice', state.id).length, 1);
  } finally {
    restored.close();
  }
});

test('corrupted stored snapshots fail closed without exposing SQL or file details', async (t) => {
  const h = await harness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    state = await h.vault(cookie);
  h.store.db.prepare('UPDATE vaults SET digest = ? WHERE id = ?').run('corrupt', state.id);
  const result = await h.request(cookie, `/api/vaults/${state.id}`);
  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.json(), { error: 'LOCAL_OPERATION_FAILED' });
});
