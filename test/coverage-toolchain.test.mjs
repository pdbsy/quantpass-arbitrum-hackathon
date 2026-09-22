import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { verifyInstallation } from '../tools/coverage/toolchain.mjs';
import { loadCoverageTools } from '../tools/coverage/toolchain.mjs';
const hash = (v) => createHash('sha256').update(v).digest('hex');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-coverage-tool-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'tool.mjs'), 'export const version = 1;\n');
  return {
    root,
    files: { 'tool.mjs': { type: 'file', sha256: hash('export const version = 1;\n'), bytes: 26 } },
  };
}
test('locked installed bytes validate without executing package code', (t) => {
  const f = fixture(t);
  assert.deepEqual(verifyInstallation(f.root, f.files), { files: 1, symlinks: 0 });
});
test('altered installed bytes and missing files fail before tool import', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'tool.mjs'), 'process.exit(0);\n');
  assert.throws(() => verifyInstallation(f.root, f.files));
  rmSync(join(f.root, 'tool.mjs'));
  assert.throws(() => verifyInstallation(f.root, f.files));
});
test('unreviewed extra files are not silently accepted', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'extra.mjs'), 'export default 1;');
  assert.throws(() => verifyInstallation(f.root, f.files));
});
test('symlink redirection and descriptors escaping the tool root reject', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'tool.mjs'));
  symlinkSync('/etc/passwd', join(f.root, 'tool.mjs'));
  assert.throws(() => verifyInstallation(f.root, f.files));
  assert.throws(() => verifyInstallation(f.root, { '../tool.mjs': f.files['tool.mjs'] }));
});
test('reviewed internal executable symlinks validate, altered targets reject', (t) => {
  const f = fixture(t);
  symlinkSync('tool.mjs', join(f.root, 'entry'));
  f.files.entry = { type: 'symlink', target: 'tool.mjs' };
  assert.deepEqual(verifyInstallation(f.root, f.files), { files: 1, symlinks: 1 });
  f.files.entry.target = 'elsewhere';
  assert.throws(() => verifyInstallation(f.root, f.files));
});
test('split tool inventories retain exact file sets and reject altered or overlapping chunks', async (t) => {
  const { loadInstalledFileRecords } = await import('../tools/coverage/toolchain.mjs');
  const f = fixture(t);
  const a = JSON.stringify(f.files);
  writeFileSync(join(f.root, 'part.json'), a);
  const index = [{ path: 'part.json', sha256: hash(a), records: 1 }];
  assert.deepEqual(loadInstalledFileRecords(f.root, index), f.files);
  assert.throws(() => loadInstalledFileRecords(f.root, [...index, ...index]));
  writeFileSync(join(f.root, 'part.json'), JSON.stringify({}));
  assert.throws(() => loadInstalledFileRecords(f.root, index));
});

test('default coverage prerequisites fail closed when the reviewed install is absent', async (t) => {
  const f = fixture(t);
  const repository = resolve(import.meta.dirname, '..');
  mkdirSync(join(f.root, 'planning'));
  for (const file of ['coverage-toolchain.lock.json', 'coverage-instrumentation.package-lock.json'])
    copyFileSync(join(repository, 'planning', file), join(f.root, 'planning', file));
  const descriptor = JSON.parse(readFileSync(join(repository, 'planning/coverage-toolchain.lock.json')));
  for (const chunk of descriptor.instrumentation.installedFileChunks)
    copyFileSync(join(repository, chunk.path), join(f.root, chunk.path));
  await assert.rejects(loadCoverageTools(f.root), { code: 'ENOENT' });
});
