import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recordBrowserChild, replayBrowserChild } from '../tools/coverage/browser-child.mjs';
const manifest = {
  candidateCommit: 'a'.repeat(40),
  candidateTree: 'b'.repeat(40),
  toolDigest: 'c'.repeat(64),
};
const manifestSha256 = 'd'.repeat(64);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-browser-child-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const raw = join(directory, 'node-raw');
  mkdirSync(raw);
  const runtimeRoot = join(directory, 'runtime-root');
  const driver = 'tools/verify-management-browser.mjs';
  const child = { pid: 1234, code: 0, signal: null };
  const start = {
    ...manifest,
    manifestSha256,
    id: 'child-root',
    workflow: 'BROWSER_MANAGEMENT',
    kind: 'NODE_PROCESS',
    pid: child.pid,
    threadId: 0,
    command: [process.execPath, resolve(runtimeRoot, driver)],
  };
  const source = {
    sha256: 'e'.repeat(64),
    coverage: {
      path: 'handler.mjs',
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } },
      fnMap: {},
      branchMap: {},
      s: { 0: 3 },
      f: {},
      b: {},
    },
  };
  const complete = { ...start, complete: true, exitCode: 0, sources: { 'handler.mjs': source } };
  writeFileSync(join(raw, 'started-child-root.json'), JSON.stringify(start));
  writeFileSync(join(raw, 'complete-child-root.json'), JSON.stringify(complete));
  writeFileSync(join(directory, 'driver.stdout.log'), 'real driver assertions passed\n');
  writeFileSync(join(directory, 'driver.stderr.log'), '');
  const options = { directory, child, runtimeRoot, workflow: 'management' };
  const replay = (receipt) =>
    replayBrowserChild({ directory, receipt, manifest, manifestSha256, workflow: 'management' });
  return { directory, raw, options, complete, replay };
}

test('browser child replay retains real driver/backend counters and binds its successful root process', (t) => {
  const f = fixture(t);
  const receipt = recordBrowserChild(f.options);
  const replay = f.replay(receipt);
  assert.equal(replay.state, 'PASS');
  assert.equal(replay.observations.length, 1);
  assert.equal(replay.observations[0].sources['handler.mjs'].coverage.s['0'], 3);
});
for (const file of ['driver.stdout.log', 'node-raw/complete-child-root.json'])
  test(`browser child rejects changed ${file}`, (t) => {
    const f = fixture(t);
    const receipt = recordBrowserChild(f.options);
    const path = join(f.directory, file);
    writeFileSync(path, readFileSync(path, 'utf8') + '\n');
    assert.throws(() => f.replay(receipt), /artifact/);
  });
test('browser child rejects a successful exit with no root completion', (t) => {
  const f = fixture(t);
  rmSync(join(f.raw, 'complete-child-root.json'));
  const receipt = recordBrowserChild(f.options);
  assert.throws(() => f.replay(receipt), /root/);
});
test('browser child nonzero exit and unflushed start remain failure with a zero-contribution lifecycle', (t) => {
  const f = fixture(t);
  rmSync(join(f.raw, 'complete-child-root.json'));
  const receipt = recordBrowserChild({
    ...f.options,
    child: { ...f.options.child, code: null, signal: 'SIGTERM' },
  });
  const result = f.replay(receipt);
  assert.equal(result.state, 'FAIL');
  assert.equal(result.observations[0].complete, false);
  assert.deepEqual(result.observations[0].sources, {});
});
test('browser child cannot exchange workflow, candidate or root process identities', (t) => {
  const f = fixture(t);
  const receipt = recordBrowserChild(f.options);
  for (const changed of [
    { ...receipt, workflow: 'legacy' },
    { ...receipt, pid: 4321 },
    { ...receipt, driver: 'tools/unrelated.mjs' },
  ])
    assert.throws(() => f.replay(changed));
  writeFileSync(
    join(f.raw, 'complete-child-root.json'),
    JSON.stringify({ ...f.complete, candidateCommit: 'f'.repeat(40) }),
  );
  const rebound = recordBrowserChild(f.options);
  assert.throws(() => f.replay(rebound));
});
