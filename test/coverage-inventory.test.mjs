import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readSourceSnapshot, isTypeOnly } from '../tools/coverage/inventory.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-cov-source-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.name', 'Coverage fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  for (const p of ['src', 'test', 'docs', 'apps']) mkdirSync(join(root, p));
  writeFileSync(join(root, 'src/unused.ts'), 'export function unused() { return 3; }\n');
  writeFileSync(join(root, 'src/types.d.ts'), 'export interface Value { id: string }\n');
  writeFileSync(join(root, 'docs/task-board.js'), 'globalThis.visible = true;\n');
  writeFileSync(join(root, 'test/example.test.mjs'), 'throw new Error("fixture test excluded");\n');
  git('add', '.');
  git('commit', '-qm', 'source fixture');
  return { root, git };
}
test('Git inventory retains never-run, declarations, and non-app executable paths', (t) => {
  const { root } = fixture(t);
  const r = readSourceSnapshot(root);
  assert.deepEqual(Object.keys(r.sources), ['docs/task-board.js', 'src/types.d.ts', 'src/unused.ts']);
  assert.match(r.candidateCommit, /^[a-f0-9]{40}$/);
  assert.match(r.candidateTree, /^[a-f0-9]{40}$/);
  assert.match(r.sources['src/unused.ts'].text, /return 3/);
});
test('changed and untracked source cannot inherit clean-candidate evidence', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'src/new.js'), 'export const x=1;');
  assert.throws(() => readSourceSnapshot(root));
  rmSync(join(root, 'src/new.js'));
  writeFileSync(join(root, 'src/unused.ts'), 'export const changed=1;');
  assert.throws(() => readSourceSnapshot(root));
});
test('unregistered executable HTML inline source prevents an incomplete denominator', (t) => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, 'apps/other.html'), '<script>globalThis.hidden = 1;</script>');
  git('add', '.');
  git('commit', '-qm', 'new inline source');
  assert.throws(() => readSourceSnapshot(root));
});
test('type-only proof does not mistake runtime imports and re-exports for erased syntax', () => {
  assert.equal(isTypeOnly({ type: 'TSInterfaceDeclaration' }), true);
  assert.equal(
    isTypeOnly({
      type: 'ExportNamedDeclaration',
      exportKind: 'value',
      declaration: { type: 'TSTypeAliasDeclaration' },
    }),
    true,
  );
  assert.equal(isTypeOnly({ type: 'ImportDeclaration', importKind: 'value', specifiers: [] }), false);
  assert.equal(isTypeOnly({ type: 'ExportAllDeclaration', exportKind: 'value' }), false);
  assert.equal(isTypeOnly({ type: 'ExportDefaultDeclaration' }), false);
});
