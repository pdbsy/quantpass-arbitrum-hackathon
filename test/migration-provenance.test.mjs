import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

test('migration inventory accounts for source versions and validates imported artifact hashes', async () => {
  const inventory = await readJson('docs/migration/inventory.json');
  const manifest = await readJson('docs/migration/artifact-provenance.json');
  assert.equal(inventory.canonical_repository, 'pdbsy/quantpass-arbitrum-hackathon');
  assert.ok(inventory.records.length >= 369);
  const states = new Set(['ALREADY_PRESENT', 'MIGRATED', 'SUPERSEDED', 'USER_ACTION_REQUIRED']);
  for (const row of inventory.records) {
    assert.ok(states.has(row.status), row.id);
    assert.match(row.commit, /^[a-f0-9]{40}$/);
    assert.match(row.source_blob, /^[a-f0-9]{40}$/);
    assert.ok(row.reason, row.id);
    if (row.status !== 'USER_ACTION_REQUIRED')
      assert.ok((await lstat(resolve(root, row.target_location))).isFile(), row.target_location);
  }
  for (const artifact of manifest.artifacts) {
    const file = resolve(root, artifact.target_path);
    const rel = relative(root, file);
    assert.ok(rel !== '..' && !rel.startsWith(`..${sep}`), artifact.target_path);
    assert.ok((await lstat(file)).isFile(), artifact.target_path);
    assert.match(artifact.source_commit, /^[a-f0-9]{40}$/);
    assert.match(artifact.original_sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      artifact.migrated_sha256,
      artifact.target_path,
    );
  }
  const protectedUi = await readFile(resolve(root, 'apps/web/prototype/AlphaForge_v3_EN.html'));
  assert.equal(
    createHash('sha256').update(protectedUi).digest('hex'),
    '949627bc39a2076de97d234546ce7bebabda6db330d22b423874063eb0243b45',
  );
});

test('generated Forum uses external assets under the existing dashboard CSP', async () => {
  const page = await readFile(resolve(root, 'docs/management/dashboard/agent-forum.html'), 'utf8');
  assert.match(page, /<script src="\.\/agent-forum-app\.js"><\/script>/);
  assert.match(page, /href="\.\/agent-forum\.css"/);
  assert.doesNotMatch(page, /unsafe-inline|<style>|<script>/);
});
