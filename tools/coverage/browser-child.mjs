import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadLifecycleArtifacts } from './artifacts.mjs';
const drivers = { legacy: 'tools/verify-ui-browser.mjs', management: 'tools/verify-management-browser.mjs' };
function artifacts(directory) {
  const raw = resolve(directory, 'node-raw');
  assert.ok(
    lstatSync(raw).isDirectory() && !lstatSync(raw).isSymbolicLink(),
    'invalid child artifact directory',
  );
  return [
    'driver.stdout.log',
    'driver.stderr.log',
    ...readdirSync(raw)
      .sort()
      .map((name) => `node-raw/${name}`),
  ].map((file) => {
    const path = resolve(directory, file);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'invalid child artifact');
    const bytes = readFileSync(path);
    return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
}
export function recordBrowserChild({ directory, child, runtimeRoot, workflow }) {
  assert.ok(Object.hasOwn(drivers, workflow), 'unknown browser child workflow');
  return {
    workflow,
    driver: drivers[workflow],
    runtimeRoot,
    pid: child.pid,
    exitCode: child.code,
    signal: child.signal,
    artifacts: artifacts(directory),
  };
}
export function replayBrowserChild({ directory, receipt, manifest, manifestSha256, workflow }) {
  assert.ok(Object.hasOwn(drivers, workflow), 'unknown browser child workflow');
  assert.equal(receipt.workflow, workflow);
  assert.equal(receipt.driver, drivers[workflow]);
  assert.equal(receipt.runtimeRoot, resolve(directory, 'runtime-root'));
  assert.ok(Number.isInteger(receipt.pid) && receipt.pid > 0);
  assert.ok(receipt.exitCode === null || (Number.isInteger(receipt.exitCode) && receipt.exitCode >= 0));
  assert.ok(receipt.signal === null || typeof receipt.signal === 'string');
  assert.deepEqual(artifacts(directory), receipt.artifacts, 'browser child artifact changed');
  const observations = loadLifecycleArtifacts(
    resolve(directory, 'node-raw'),
    manifest,
    manifestSha256,
    `BROWSER_${workflow.toUpperCase()}`,
  );
  const root = observations.find((row) => row.pid === receipt.pid && row.threadId === 0);
  assert.ok(root, 'browser child root lifecycle absent');
  assert.deepEqual(
    root.command,
    [process.execPath, resolve(receipt.runtimeRoot, receipt.driver)],
    'browser child root command differs',
  );
  const state = receipt.exitCode === 0 && receipt.signal === null ? 'PASS' : 'FAIL';
  if (state === 'PASS')
    assert.ok(root.complete && root.exitCode === 0, 'browser child root completion absent');
  if (root.complete && receipt.exitCode !== null) assert.equal(root.exitCode, receipt.exitCode);
  return { state, observations };
}
