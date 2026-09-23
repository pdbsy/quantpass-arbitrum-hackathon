import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('dashboard contains synchronous response failures before and after sending headers', () => {
  const program = `
    import assert from 'node:assert/strict';
    import { mkdtemp, rm, writeFile } from 'node:fs/promises';
    import { ServerResponse } from 'node:http';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createDashboardServer } from './tools/serve-management-dashboard.mjs';
    const root = await mkdtemp(join(tmpdir(), 'alphaforge-response-boundary-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Healthy fixture</title>');
    const server = await createDashboardServer({ root, port: 0 });
    const original = ServerResponse.prototype.writeHead;
    let beforeRemaining = 2;
    let afterRemaining = 1;
    const faults = [];
    ServerResponse.prototype.writeHead = function(...args) {
      if (this.req.url === '/index.html?fault=before' && beforeRemaining-- > 0) {
        faults.push({ boundary: 'before', headersSent: this.headersSent });
        throw new Error('FAULT_INJECTED synchronous response serialization failure');
      }
      const result = original.apply(this, args);
      if (this.req.url === '/index.html?fault=after' && afterRemaining-- > 0) {
        faults.push({ boundary: 'after', headersSent: this.headersSent });
        throw new Error('FAULT_INJECTED synchronous response completion failure');
      }
      return result;
    };
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const origin = 'http://127.0.0.1:' + server.address().port;
      const before = await fetch(origin + '/index.html?fault=before');
      assert.equal(before.status, 500);
      assert.equal(await before.text(), 'Internal Server Error\\n');
      assert.equal(before.headers.get('cache-control'), 'no-store');
      assert.equal(before.headers.get('x-content-type-options'), 'nosniff');
      await assert.rejects(fetch(origin + '/index.html?fault=after'), { name: 'TypeError' });
      const healthy = await fetch(origin + '/index.html');
      assert.equal(healthy.status, 200);
      assert.match(await healthy.text(), /Healthy fixture/);
      assert.deepEqual(faults, [
        { boundary: 'before', headersSent: false },
        { boundary: 'before', headersSent: false },
        { boundary: 'after', headersSent: true },
      ]);
      console.log('PASS: bounded transport failures, no success body on failure, subsequent request healthy');
    } finally {
      ServerResponse.prototype.writeHead = original;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.match(child.stdout, /PASS: bounded transport failures/);
});

test('environment CLI module import does not run probes, print output or rewrite report evidence', async () => {
  const reportPath = resolve(root, '.checks/environment/report.json');
  const before = await readFile(reportPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const program = `
    import assert from 'node:assert/strict';
    assert.equal(process.argv[1], undefined);
    const entry = await import('./tools/check-environment.mjs');
    assert.equal(typeof entry.main, 'function');
    assert.equal(process.exitCode, undefined);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
  const after = await readFile(reportPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  assert.deepEqual(after, before);
});
