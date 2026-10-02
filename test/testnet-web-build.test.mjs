import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPublicTestnetApp } from '../apps/server/src/testnet-app.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';
test('the actual Testnet build is served under restrictive CSP and cannot expose local simulator routes', async () => {
  const out = mkdtempSync(join(tmpdir(), 'alphaforge-testnet-web-'));
  let app;
  try {
    execFileSync(process.execPath, ['tools/import-user-ui.mjs'], { stdio: 'pipe' });
    execFileSync(
      process.execPath,
      [
        'node_modules/vite/bin/vite.js',
        'build',
        'apps/web',
        '--config',
        'apps/web/vite.config.ts',
        '--outDir',
        out,
      ],
      { stdio: 'pipe' },
    );
    const html = readFileSync(join(out, 'testnet.html'), 'utf8');
    assert.match(html, /AlphaForge/);
    assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[^<]+/);
    app = await buildPublicTestnetApp({
      origin: 'https://test.example',
      auth: new WalletAuthStore(':memory:', 'https://test.example', {
        challengeTtlMs: 60000,
        sessionTtlMs: 60000,
        maxRows: 10,
      }),
      webRoot: out,
    });
    const headers = { host: 'test.example', 'x-forwarded-proto': 'https' };
    const page = await app.inject({ url: '/', headers });
    assert.equal(page.statusCode, 200);
    assert.equal(page.body, html);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css))"/g)].map(
      (v) => v[1],
    );
    assert.ok(assets.length >= 2);
    for (const url of assets) {
      const response = await app.inject({ url, headers });
      assert.equal(response.statusCode, 200);
      assert.doesNotMatch(response.body, /node:sqlite|AF_TESTNET_RPC_URL|PRIVATE_KEY/);
    }
    for (const url of [
      '/index.html',
      '/automata.html',
      '/reference-paper.html',
      '/task-board.html',
      '/api/demo/state',
      '/api/testnet/executor/start',
      '/assets/../../package.json',
    ])
      assert.equal((await app.inject({ url, headers })).statusCode, 404);
  } finally {
    await app?.close();
    rmSync(out, { recursive: true, force: true });
  }
});
