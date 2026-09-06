import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import type { view } from '../apps/server/src/app.ts';
type Vault = ReturnType<typeof view>;

test(
  'real HTTP process crash/restart retains committed funds and rejects replay mutation',
  { timeout: 30000 },
  async () => {
    await mkdir('.checks', { recursive: true });
    const directory = await mkdtemp(resolve('.checks/http-e2e-'));
    async function start() {
      const process = fork(
        fileURLToPath(new URL('./fixtures/http-server.ts', import.meta.url)),
        [resolve(directory, 'ledger.sqlite')],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
      );
      let port: number;
      try {
        const [message] = await once(process, 'message', { signal: AbortSignal.timeout(10000) });
        port = (message as { port: number }).port;
      } catch (error) {
        process.kill();
        throw error;
      }
      async function request<T = Record<string, unknown>>(path: string, cookie = '', body?: unknown) {
        return new Promise<{ status: number; cookie: string; body: T }>((accept, reject) => {
          const request = httpRequest(
            {
              hostname: '127.0.0.1',
              port,
              path,
              method: body === undefined ? 'GET' : 'POST',
              headers: {
                host: '127.0.0.1:4180',
                cookie,
                'x-quantpass-demo': '1',
                'content-type': 'application/json',
              },
              signal: AbortSignal.timeout(5000),
            },
            (response) => {
              let data = '';
              response.setEncoding('utf8');
              response.on('data', (chunk) => {
                data += chunk;
              });
              response.on('error', reject);
              response.on('end', () => {
                try {
                  accept({
                    status: response.statusCode || 0,
                    cookie: response.headers['set-cookie']?.[0]?.split(';')[0] || '',
                    body: JSON.parse(data),
                  });
                } catch (error) {
                  reject(error);
                }
              });
            },
          );
          request.on('error', reject);
          request.end(body === undefined ? undefined : JSON.stringify(body));
        });
      }
      async function stop() {
        if (process.exitCode !== null || process.signalCode !== null) return;
        const exited = once(process, 'exit');
        process.kill('SIGKILL');
        await exited;
      }
      return { request, stop };
    }
    const first = await start();
    let vaultId: string, cookie: string;
    const deposit = { type: 'deposit', id: 'http_deposit', expectedRevision: 0, amount: '1500000000' };
    try {
      cookie = (await first.request('/api/demo/session', '', { user: 'alice' })).cookie;
      const created = await first.request<Vault>('/api/vaults', cookie, { strategyId: 'core-flow-demo' });
      assert.equal(created.status, 200);
      vaultId = created.body.id;
      assert.equal((await first.request(`/api/vaults/${vaultId}/commands`, cookie, deposit)).status, 200);
    } finally {
      await first.stop();
    }
    const second = await start();
    try {
      assert.equal((await second.request('/api/vaults', cookie)).status, 401);
      cookie = (await second.request('/api/demo/session', '', { user: 'alice' })).cookie;
      const replay = await second.request<{ vault: Vault; replayed: boolean }>(
        `/api/vaults/${vaultId}/commands`,
        cookie,
        deposit,
      );
      assert.equal(replay.status, 200);
      assert.equal(replay.body.replayed, true);
      assert.equal(replay.body.vault.idle, '1500000000');
      let revision = 1;
      for (const fields of [
        { type: 'allocate', amount: '1000000000' },
        { type: 'start' },
        { type: 'requestWithdrawal', amount: '500000000' },
        { type: 'confirmWithdrawal', withdrawalId: 'http_3' },
        { type: 'stop' },
      ]) {
        const result = await second.request(`/api/vaults/${vaultId}/commands`, cookie, {
          id: `http_${revision}`,
          expectedRevision: revision,
          ...fields,
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        revision++;
      }
      const final = await second.request<Vault>(`/api/vaults/${vaultId}`, cookie);
      assert.equal(final.body.status, 'stopped');
      assert.equal(final.body.idle, '0');
      assert.equal(final.body.withdrawalsPaid, '500000000');
      assert.equal(final.body.balances.activeNet, '1000000000');
    } finally {
      await second.stop();
    }
  },
);
