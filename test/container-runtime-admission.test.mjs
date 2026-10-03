import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateProvenance } from '../deploy/container/runtime-admission.mjs';
test('binary provenance rejects mutated binary bytes and forged versions', (t) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'af-provenance-')));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'node'), 'known-node');
  writeFileSync(join(d, 'npm'), 'known-npm');
  const m = {
    platform: 'linux',
    arch: 'x64',
    nodeVersion: '24.21.0',
    npmVersion: '11.19.1',
    nodePath: join(d, 'node'),
    npmPath: join(d, 'npm'),
    nodeSha256: 'd6a3d8e404ebe806695704f766baf59d28b2f3d0c4cce89c69eb26b703db0861',
    npmSha256: '718f2ed529a02ad5eb9868ef204bdf2df62ecb55f31b3f0d28a83c47adf8ad90',
  };
  const observed = {
    platform: 'linux',
    arch: 'x64',
    nodeVersion: '24.21.0',
    npmVersion: '11.19.1',
    nodePath: join(d, 'node'),
    npmPath: join(d, 'npm'),
  };
  assert.doesNotThrow(() => validateProvenance(m, observed));
  writeFileSync(join(d, 'node'), 'tampered');
  assert.throws(() => validateProvenance(m, observed));
  assert.throws(() => validateProvenance(m, { ...observed, nodeVersion: '24.2.0' }));
});
