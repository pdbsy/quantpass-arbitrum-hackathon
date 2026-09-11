import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDashboardServer, resolveDashboardRequestPath } from '../tools/serve-management-dashboard.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-server-'));
  const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-server-outside-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>QuantPass</title>\n');
  await writeFile(join(root, 'app.js'), 'export const ready = true;\n');
  await writeFile(join(root, 'styles.css'), ':root { color: white; }\n');
  await writeFile(join(root, 'data/dashboard.json'), '{"schemaVersion":1}\n');
  await writeFile(join(root, '.hidden'), 'not public\n');
  await writeFile(join(outside, 'secret.json'), '{"secret":true}\n');
  await symlink(join(outside, 'secret.json'), join(root, 'leak.json'));
  return { root, outside };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function rawRequest(origin, options) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(origin, options, (response) => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
    request.end();
  });
}

test('request path resolution rejects ambiguous and encoded paths before filesystem access', () => {
  assert.equal(resolveDashboardRequestPath('/'), 'index.html');
  assert.equal(resolveDashboardRequestPath('/data/dashboard.json?cache=no'), 'data/dashboard.json');
  for (const path of [
    '//example.test/dashboard.json',
    'http://example.test/dashboard.json',
    '/%2e%2e/secret.json',
    '/data/%2e%2e/%2e%2e/secret.json',
    '/data/%5c..%5csecret.json',
    '/.git/config',
    '/%00.json',
    '/%E0%A4%A',
  ]) {
    assert.throws(() => resolveDashboardRequestPath(path), /DENY/, path);
  }
});

test('server accepts only the fixed loopback host', async () => {
  await assert.rejects(
    () => createDashboardServer({ root: process.cwd(), host: '0.0.0.0', port: 0 }),
    /LOOPBACK_HOST_REQUIRED/,
  );
  await assert.rejects(
    () => createDashboardServer({ root: process.cwd(), host: 'localhost', port: 0 }),
    /LOOPBACK_HOST_REQUIRED/,
  );
});

test('server returns allowlisted assets with security headers and HEAD semantics', async (t) => {
  const { root, outside } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const server = await createDashboardServer({ root, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const origin = await listen(server);

  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), geolocation=(), microphone=()');
  assert.match(await response.text(), /QuantPass/);

  const json = await fetch(`${origin}/data/dashboard.json`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-type'), /^application\/json/);

  const head = await fetch(`${origin}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /^text\/javascript/);
  assert.equal(await head.text(), '');
});

test('server fails closed for methods, traversal, dotfiles, unknown types, and escaping symlinks', async (t) => {
  const { root, outside } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(root, 'unknown.txt'), 'not allowlisted\n');
  const server = await createDashboardServer({ root, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const origin = await listen(server);

  const post = await fetch(`${origin}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');

  const spoofedHost = await rawRequest(origin, {
    method: 'GET',
    path: '/',
    headers: { Host: 'attacker.example' },
  });
  assert.equal(spoofedHost.statusCode, 421);

  for (const path of [
    '/.hidden',
    '/.git/config',
    '/unknown.txt',
    '/leak.json',
    '/%2e%2e/secret.json',
    '/data/%2e%2e/%2e%2e/secret.json',
    '/data/%5c..%5csecret.json',
    '/%00.json',
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
