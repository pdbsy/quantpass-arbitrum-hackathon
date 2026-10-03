import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import { startProxy } from '../deploy/container/proxy.mjs';
import { buildPublicTestnetApp } from '../apps/server/src/testnet-app.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';
test('real TLS proxy reaches current public app with secure cookies and ingress gates', async (t) => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'af-tls-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const openssl = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(folder, 'key.pem'),
    '-out',
    join(folder, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=testnet.example.invalid',
    '-addext',
    'subjectAltName=DNS:testnet.example.invalid',
  ]);
  assert.equal(openssl.status, 0);
  const origin = 'https://testnet.example.invalid',
    auth = new WalletAuthStore(join(folder, 'auth.sqlite'), origin, {
      challengeTtlMs: 300000,
      sessionTtlMs: 3600000,
      maxRows: 100,
    });
  const app = await buildPublicTestnetApp({ origin, auth, verifyOwner: async () => true });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const cert = readFileSync(join(folder, 'cert.pem'));
  const proxy = await startProxy({
    origin,
    cert,
    key: readFileSync(join(folder, 'key.pem')),
    host: '127.0.0.1',
    port: 0,
    upstreamPort: app.server.address().port,
  });
  t.after(() => new Promise((r) => proxy.close(r)));
  const request = (path, headers = {}, body) =>
    new Promise((resolve, reject) => {
      const raw = body ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: proxy.address().port,
          servername: 'testnet.example.invalid',
          ca: cert,
          path,
          method: raw ? 'POST' : 'GET',
          headers: {
            host: 'testnet.example.invalid',
            ...headers,
            ...(raw ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (s) => (data += s));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        },
      );
      req.on('error', reject);
      req.end(raw);
    });
  assert.equal(
    (
      await request('/api/health', {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'evil.invalid',
        'x-forwarded-for': 'evil',
      })
    ).status,
    200,
  );
  assert.equal((await request('/api/health', { host: 'evil.invalid' })).status, 403);
  assert.equal((await request('/api/health', { origin: 'https://evil.invalid' })).status, 403);
  const owner = '0x1111111111111111111111111111111111111111',
    headers = { origin, 'x-alphaforge-client': '1' };
  assert.equal((await request('/api/testnet/auth/challenge', {}, { owner })).status, 403);
  const challenge = await request('/api/testnet/auth/challenge', headers, { owner });
  assert.equal(challenge.status, 200);
  const login = await request('/api/testnet/auth/verify', headers, {
    owner,
    nonce: JSON.parse(challenge.body).nonce,
    signature: '0x01',
  });
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);
  assert.match(login.headers['set-cookie'][0], /Secure/);
  assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
  assert.equal((await request('/api/demo/session', headers, { user: 'alice' })).status, 404);
});
