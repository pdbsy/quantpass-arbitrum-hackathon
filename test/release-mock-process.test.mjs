import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockSignature, OWNER_A } from '../tools/testing/alphaforge-release-mock/session.mjs';

async function start(directory) {
  const child = spawn(
    process.execPath,
    ['tools/testing/alphaforge-release-mock/serve.mjs', ...(directory ? ['--session=' + directory] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (v) => {
    stdout += v;
  });
  child.stderr.on('data', (v) => {
    stderr += v;
  });
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('MOCK_PROCESS_START_TIMEOUT'));
    }, 10000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('MOCK_PROCESS_EXIT:' + code + ':' + stderr));
    });
    child.stdout.on('data', () => {
      if (stdout.includes('\n')) {
        clearTimeout(timer);
        resolveReady(JSON.parse(stdout.split('\n')[0]));
      }
    });
  });
  let stopped = false;
  return {
    ...ready,
    async request(path, body, cookie = '') {
      return fetch(`http://127.0.0.1:${ready.port}` + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'x-release-mock': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      const result = once(child, 'exit');
      child.kill('SIGTERM');
      const [code, signal] = await result;
      writeFileSync(
        join(ready.directory, `process-${ready.port}.json`),
        JSON.stringify({ mode: 'MOCK', code, signal, stdout, stderr }, null, 2) + '\n',
      );
      assert.equal(code, 0);
      assert.equal(signal, null);
    },
  };
}

test('actual loopback mock child obeys SIGTERM and restart preserves submitted owner intent', async () => {
  let p = await start();
  try {
    const c = await (await p.request('/api/testnet/auth/challenge', { owner: OWNER_A })).json();
    const verify = await p.request('/api/testnet/auth/verify', {
      owner: OWNER_A,
      nonce: c.nonce,
      signature: mockSignature(c.message, OWNER_A),
    });
    assert.equal(verify.status, 200);
    const cookie = verify.headers.get('set-cookie').split(';')[0];
    const prepared = await (
      await p.request(
        '/api/testnet/vaults/mock-owner-a/prepare',
        { action: { kind: 'DEPOSIT', amountUsdc: '1' } },
        cookie,
      )
    ).json();
    const hash = '0x' + 'cd'.repeat(32);
    assert.equal(
      (
        await p.request(
          '/api/testnet/vaults/mock-owner-a/observe',
          { operationId: prepared.operationId, transactionHash: hash },
          cookie,
        )
      ).status,
      200,
    );
    const port = p.port,
      directory = p.directory;
    await p.stop();
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }));
    p = await start(directory);
    const current = await (
      await p.request(
        '/api/testnet/vaults/mock-owner-a/operations/' + prepared.operationId,
        undefined,
        cookie,
      )
    ).json();
    assert.equal(current.state, 'SUBMITTED');
    assert.equal(current.productReady, false);
    assert.equal(current.txHash, hash);
    assert.equal(
      (await fetch(`http://127.0.0.1:${p.port}/api/health`, { signal: AbortSignal.timeout(1000) })).status,
      403,
    );
  } finally {
    await p.stop();
  }
});
