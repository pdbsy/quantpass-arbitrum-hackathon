import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../../apps/server/src/app.ts';

export async function productHarness(dbPath?: string) {
  await mkdir('.checks', { recursive: true });
  const directory = await mkdtemp(resolve('.checks/af-be01-'));
  const path = dbPath ?? resolve(directory, 'ledger.sqlite');
  const { app, store } = await buildApp({
    dbPath: path,
    env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
    origin: 'http://127.0.0.1:4180',
  });
  const headers = { host: '127.0.0.1:4180', 'x-quantpass-demo': '1' };
  async function login(user = 'alice') {
    const result = await app.inject({ method: 'POST', url: '/api/demo/session', headers, payload: { user } });
    assert.equal(result.statusCode, 200);
    return String(result.headers['set-cookie']).split(';')[0]!;
  }
  function request(cookie: string, url: string, payload?: unknown) {
    return app.inject({
      method: payload === undefined ? 'GET' : 'POST',
      url,
      headers: { ...headers, cookie, 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  }
  async function claim(cookie: string, strategyId = 'core-flow-demo') {
    const result = await request(cookie, '/api/vaults', { strategyId });
    assert.equal(result.statusCode, 200, result.body);
    return result.json();
  }
  return { app, store, path, directory, login, request, claim };
}
