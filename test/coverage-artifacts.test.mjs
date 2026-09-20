import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadLifecycleArtifacts } from '../tools/coverage/artifacts.mjs';
const manifest = {
  candidateCommit: 'a'.repeat(40),
  candidateTree: 'b'.repeat(40),
  toolDigest: 'c'.repeat(64),
};
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value));
  return { directory, save };
}
const start = {
  ...manifest,
  manifestSha256: 'd'.repeat(64),
  id: 'sample',
  workflow: 'check',
  kind: 'NODE_PROCESS',
  pid: 123,
  threadId: 0,
  command: ['node', 'example.mjs'],
};
const complete = { ...start, complete: true, exitCode: 0, sources: {} };
test('started but unflushed process is explicitly retained as zero-hit lower bound', (t) => {
  const f = fixture(t);
  f.save('started-sample.json', start);
  const r = loadLifecycleArtifacts(f.directory, manifest, start.manifestSha256, 'check');
  assert.equal(r.length, 1);
  assert.equal(r[0].complete, false);
  assert.deepEqual(r[0].sources, {});
});
test('complete artifact requires matching source-bound start and exact workflow identity', (t) => {
  const f = fixture(t);
  f.save('complete-sample.json', complete);
  assert.throws(() => loadLifecycleArtifacts(f.directory, manifest, start.manifestSha256, 'check'));
  f.save('started-sample.json', start);
  assert.equal(
    loadLifecycleArtifacts(f.directory, manifest, start.manifestSha256, 'check')[0].complete,
    true,
  );
  for (const change of [
    { workflow: 'other' },
    { manifestSha256: 'e'.repeat(64) },
    { id: 'other' },
    { pid: undefined },
    { candidateTree: 'f'.repeat(40) },
  ]) {
    f.save('complete-sample.json', { ...complete, ...change });
    assert.throws(() => loadLifecycleArtifacts(f.directory, manifest, start.manifestSha256, 'check'));
  }
});
test('unknown and partially written artifacts reject instead of dropping input', (t) => {
  const f = fixture(t);
  f.save('mystery.json', {});
  assert.throws(() => loadLifecycleArtifacts(f.directory, manifest, start.manifestSha256, 'check'));
});
