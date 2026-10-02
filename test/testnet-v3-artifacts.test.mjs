import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateV3Artifact } from '../tools/testnet/v3-artifacts.mjs';

const folder = new URL('../deploy/testnet/vendor/', import.meta.url);
test('approved upstream bytecode and the seven-field router tuple cannot be silently substituted', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8'));
  for (const entry of manifest.artifacts) {
    const text = await readFile(new URL(entry.file, folder), 'utf8');
    const artifact = validateV3Artifact(entry, text);
    assert.ok(artifact.bytecode.length > 100);
    for (const changed of [
      { ...entry, version: '9.9.9' },
      { ...entry, sourceCommit: '0'.repeat(40) },
      { ...entry, package: 'unapproved-copy' },
    ])
      assert.throws(() => validateV3Artifact(changed, text), /V3_ARTIFACT_APPROVAL/);
    const changed = JSON.parse(text);
    changed.bytecode = changed.bytecode.slice(0, -2) + (changed.bytecode.endsWith('00') ? '01' : '00');
    assert.throws(() => validateV3Artifact(entry, JSON.stringify(changed)), /V3_ARTIFACT_INTEGRITY/);
    assert.throws(
      () => validateV3Artifact({ ...entry, expiresAt: '2026-09-01T00:00:00Z' }, text),
      /V3_ARTIFACT_EXPIRED/,
    );
  }
});
