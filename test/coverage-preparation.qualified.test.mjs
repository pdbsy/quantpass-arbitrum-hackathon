import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as preparation from '../tools/coverage/prepare.mjs';
const repository = resolve(import.meta.dirname, '..');
const instrumentationDirectory = process.env.AF_QUALIFIED_COVERAGE_TOOLS;
assert.ok(instrumentationDirectory, 'qualified instrumentation directory required; never silently skip');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-qualified-coverage-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Coverage fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(root, 'planning'));
  for (const name of ['coverage-toolchain.lock.json', 'coverage-instrumentation.package-lock.json'])
    copyFileSync(join(repository, 'planning', name), join(root, 'planning', name));
  for (const chunk of JSON.parse(readFileSync(join(repository, 'planning/coverage-toolchain.lock.json')))
    .instrumentation.installedFileChunks)
    copyFileSync(join(repository, chunk.path), join(root, chunk.path));
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(root, '.gitignore'), 'outputs/\n');
  writeFileSync(join(root, 'example.ts'), 'export function choose(x: boolean) { return x ? 7 : 9; }\n');
  writeFileSync(join(root, 'types.ts'), 'export interface Value { id: string }\n');
  git('add', '.');
  git('commit', '-qm', 'source');
  return { root, git, options: { instrumentationDirectory, sourceBase: git('rev-parse', 'HEAD').trim() } };
}
test('prepared graph has the full unexecuted denominator and can be independently regenerated', async (t) => {
  const { root, options } = fixture(t);
  const result = await preparation.prepareCoverage(root, options);
  const manifest = JSON.parse(readFileSync(join(result.directory, 'manifest.json')));
  assert.equal(result.status, 'PREPARED_NOT_MEASURED');
  assert.equal(result.sources, 2);
  assert.deepEqual(Object.values(manifest.sources['example.ts'].coverage.b), [[0, 0]]);
  assert.equal(manifest.classifications['types.ts'].kind, 'NO_EXECUTABLE_CODE');
  const replay = await preparation.verifyPrepared(root, result.directory, options);
  assert.equal(replay.manifest.candidateCommit, options.sourceBase);
});
test('replay rejects regenerated-hash tampering and stale source candidates', async (t) => {
  const { root, options, git } = fixture(t);
  const result = await preparation.prepareCoverage(root, options);
  const path = join(result.directory, 'manifest.json');
  const original = readFileSync(path);
  const altered = JSON.parse(original);
  altered.sources['example.ts'].coverage.branchMap = {};
  altered.sources['example.ts'].coverage.b = {};
  writeFileSync(path, JSON.stringify(altered));
  const receiptPath = join(result.directory, 'preparation.json');
  const receiptOriginal = readFileSync(receiptPath);
  const receipt = JSON.parse(receiptOriginal);
  receipt.manifestSha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  await assert.rejects(preparation.verifyPrepared(root, result.directory, options));
  writeFileSync(path, original);
  writeFileSync(receiptPath, receiptOriginal);
  writeFileSync(join(root, 'example.ts'), 'export const changed = 1;\n');
  await assert.rejects(preparation.verifyPrepared(root, result.directory, options));
  git('add', '.');
  git('commit', '-qm', 'different source');
  await assert.rejects(preparation.verifyPrepared(root, result.directory, options));
});
