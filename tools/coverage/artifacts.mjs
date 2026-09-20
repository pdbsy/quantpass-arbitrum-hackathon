import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
export function loadLifecycleArtifacts(directory, manifest, manifestSha256, workflow) {
  const starts = new Map();
  const completes = new Map();
  for (const file of readdirSync(directory).sort()) {
    const match = /^(started|complete)-([a-zA-Z0-9-]+)\.json$/.exec(file);
    assert.ok(match, 'unknown or partially written lifecycle artifact');
    const path = join(directory, file);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    const row = JSON.parse(readFileSync(path));
    assert.equal(row.id, match[2]);
    for (const key of ['candidateCommit', 'candidateTree', 'toolDigest'])
      assert.equal(row[key], manifest[key]);
    assert.equal(row.manifestSha256, manifestSha256);
    assert.equal(row.workflow, workflow);
    assert.equal(row.kind, 'NODE_PROCESS');
    assert.ok(Number.isInteger(row.pid) && row.pid > 0);
    assert.ok(Number.isInteger(row.threadId) && row.threadId >= 0);
    assert.ok(
      Array.isArray(row.command) && row.command.length > 0 && row.command.every((x) => typeof x === 'string'),
    );
    const target = match[1] === 'started' ? starts : completes;
    assert.ok(!target.has(row.id));
    target.set(row.id, row);
  }
  for (const [id, row] of completes) {
    const start = starts.get(id);
    assert.ok(start, 'complete artifact lacks start');
    for (const key of Object.keys(start)) assert.deepEqual(row[key], start[key]);
    assert.equal(row.complete, true);
    assert.ok(Number.isInteger(row.exitCode) && row.exitCode >= 0);
    assert.ok(row.sources && typeof row.sources === 'object' && !Array.isArray(row.sources));
  }
  return [...starts].map(([id, start]) => completes.get(id) || { ...start, complete: false, sources: {} });
}
