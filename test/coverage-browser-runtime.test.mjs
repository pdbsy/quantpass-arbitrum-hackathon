import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { prepareLegacyRuntime, collectLegacyBrowserCoverage } from '../tools/coverage/browser-legacy.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
function fixture(t) {
  const base = mkdtempSync(resolve(tmpdir(), 'AlphaForge browser runtime 中文 '));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = resolve(base, 'source');
  mkdirSync(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Runtime Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  writeFileSync(resolve(root, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(resolve(root, '.gitignore'), 'node_modules/\n.checks/\noutputs/\n');
  writeFileSync(resolve(root, 'tracked.txt'), 'source bytes\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'first source');
  writeFileSync(resolve(root, 'tracked.txt'), 'second source bytes\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'second source');
  return { root, base };
}
for (const kind of ['clone', 'worktree'])
  test(`browser runtime retains independent Git history from ${kind} and excludes ignored private files`, async (t) => {
    const { root: original, base } = fixture(t);
    const root = kind === 'worktree' ? resolve(base, 'worktree') : original;
    if (kind === 'worktree') git(original, 'worktree', 'add', '-b', 'task', root);
    mkdirSync(resolve(root, '.checks'));
    writeFileSync(resolve(root, '.checks', 'private.txt'), 'must stay at source');
    mkdirSync(resolve(root, 'node_modules'));
    writeFileSync(resolve(root, 'node_modules', 'dependency.txt'), 'private dependency copy');
    const manifest = {
      candidateCommit: git(root, 'rev-parse', 'HEAD'),
      candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'),
      sources: {},
      aliases: {},
    };
    const { runtimeRoot } = await prepareLegacyRuntime({
      root,
      manifest,
      generated: {},
      workflow: 'management',
      outputDirectory: resolve(base, 'runtime-output'),
      nodeModulesDirectory: resolve(root, 'node_modules'),
    });
    assert.equal(git(runtimeRoot, 'rev-parse', 'HEAD'), manifest.candidateCommit);
    assert.equal(git(runtimeRoot, 'rev-parse', 'HEAD^{tree}'), manifest.candidateTree);
    assert.equal(git(runtimeRoot, 'rev-list', '--count', 'HEAD'), '2');
    assert.equal(git(runtimeRoot, 'rev-parse', '--is-shallow-repository'), 'false');
    assert.notEqual(
      git(runtimeRoot, 'rev-parse', '--absolute-git-dir'),
      git(root, 'rev-parse', '--absolute-git-dir'),
    );
    assert.equal(existsSync(resolve(runtimeRoot, '.git', 'objects', 'info', 'alternates')), false);
    assert.equal(existsSync(resolve(runtimeRoot, '.checks', 'private.txt')), false);
    assert.equal(existsSync(resolve(runtimeRoot, 'outputs')), false);
    assert.notEqual(
      statSync(resolve(runtimeRoot, 'node_modules', 'dependency.txt')).ino,
      statSync(resolve(root, 'node_modules', 'dependency.txt')).ino,
    );
    writeFileSync(resolve(runtimeRoot, 'tracked.txt'), 'runtime changed');
    assert.equal(git(runtimeRoot, 'status', '--porcelain'), 'M tracked.txt');
    assert.equal(readFileSync(resolve(root, 'tracked.txt'), 'utf8'), 'second source bytes\n');
    assert.equal(git(root, 'status', '--porcelain'), '');
  });

test('browser runtime rejects a source candidate mismatch', async (t) => {
  const { root, base } = fixture(t);
  mkdirSync(resolve(root, 'node_modules'));
  await assert.rejects(
    prepareLegacyRuntime({
      root,
      manifest: { candidateCommit: '0'.repeat(40), candidateTree: '0'.repeat(40), sources: {}, aliases: {} },
      generated: {},
      workflow: 'management',
      outputDirectory: resolve(base, 'wrong'),
      nodeModulesDirectory: resolve(root, 'node_modules'),
    }),
    /candidate/,
  );
});

test('runtime fallback copies caller dependencies independently and accepts an absent alias inventory', async (t) => {
  const { root, base } = fixture(t);
  const caller = resolve(base, 'caller');
  mkdirSync(resolve(caller, 'node_modules'), { recursive: true });
  writeFileSync(resolve(caller, 'node_modules', 'dependency.txt'), 'caller dependency');
  const manifest = {
    candidateCommit: git(root, 'rev-parse', 'HEAD'),
    candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    sources: {},
  };
  const prior = process.cwd();
  try {
    process.chdir(caller);
    const { runtimeRoot } = await prepareLegacyRuntime({
      root,
      manifest,
      generated: {},
      workflow: 'management',
      outputDirectory: resolve(base, 'fallback'),
    });
    const copied = resolve(runtimeRoot, 'node_modules', 'dependency.txt');
    assert.equal(readFileSync(copied, 'utf8'), 'caller dependency');
    assert.notEqual(statSync(copied).ino, statSync(resolve(caller, 'node_modules', 'dependency.txt')).ino);
    writeFileSync(copied, 'runtime only');
    assert.equal(
      readFileSync(resolve(caller, 'node_modules', 'dependency.txt'), 'utf8'),
      'caller dependency',
    );
    assert.equal(git(root, 'status', '--porcelain'), '');
  } finally {
    process.chdir(prior);
  }
});

test('runtime preparation preserves tracked dependency bytes instead of overwriting candidate history', async (t) => {
  const { root, base } = fixture(t);
  mkdirSync(resolve(root, 'node_modules'));
  writeFileSync(resolve(root, 'node_modules', 'dependency.txt'), 'tracked dependency');
  git(root, 'add', '-f', 'node_modules/dependency.txt');
  git(root, 'commit', '-m', 'tracked dependency fixture');
  const manifest = {
    candidateCommit: git(root, 'rev-parse', 'HEAD'),
    candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    sources: {},
    aliases: {},
  };
  const { runtimeRoot } = await prepareLegacyRuntime({
    root,
    manifest,
    generated: {},
    workflow: 'management',
    outputDirectory: resolve(base, 'tracked-dependency'),
    nodeModulesDirectory: resolve(base, 'unused-override'),
  });
  assert.equal(
    readFileSync(resolve(runtimeRoot, 'node_modules', 'dependency.txt'), 'utf8'),
    'tracked dependency',
  );
  assert.equal(git(runtimeRoot, 'status', '--porcelain'), '');
  assert.equal(git(runtimeRoot, 'rev-parse', 'HEAD'), manifest.candidateCommit);
});

test('the default legacy workflow rejects a missing prototype before any browser launch', async (t) => {
  const { root, base } = fixture(t);
  mkdirSync(resolve(root, 'node_modules'));
  const manifest = {
    candidateCommit: git(root, 'rev-parse', 'HEAD'),
    candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    sources: {},
    aliases: {},
  };
  await assert.rejects(
    collectLegacyBrowserCoverage({
      root,
      manifest,
      generated: {},
      tools: {},
      outputDirectory: resolve(base, 'missing-prototype'),
      nodeModulesDirectory: resolve(root, 'node_modules'),
    }),
    (error) => error.code === 'ENOENT' && /AlphaForge_v3_EN\.html/.test(error.path),
  );
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('browser runtime can use an ignored output under the source without copying itself', async (t) => {
  const { root } = fixture(t);
  mkdirSync(resolve(root, 'node_modules'));
  writeFileSync(resolve(root, 'node_modules', 'dependency.txt'), 'dependency bytes');
  const manifest = {
    candidateCommit: git(root, 'rev-parse', 'HEAD'),
    candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'),
    sources: {},
    aliases: {},
  };
  const { runtimeRoot } = await prepareLegacyRuntime({
    root,
    manifest,
    generated: {},
    workflow: 'management',
    outputDirectory: resolve(root, 'outputs', 'browser'),
  });
  assert.equal(git(runtimeRoot, 'rev-parse', 'HEAD'), manifest.candidateCommit);
  assert.equal(
    readFileSync(resolve(runtimeRoot, 'node_modules', 'dependency.txt'), 'utf8'),
    'dependency bytes',
  );
  assert.equal(existsSync(resolve(runtimeRoot, 'outputs')), false);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

for (const dirty of ['tracked', 'untracked'])
  test(`browser runtime rejects ${dirty} source changes instead of silently omitting them`, async (t) => {
    const { root, base } = fixture(t);
    const manifest = {
      candidateCommit: git(root, 'rev-parse', 'HEAD'),
      candidateTree: git(root, 'rev-parse', 'HEAD^{tree}'),
      sources: {},
      aliases: {},
    };
    writeFileSync(
      resolve(root, dirty === 'tracked' ? 'tracked.txt' : 'new-source.txt'),
      'uncommitted change',
    );
    await assert.rejects(
      prepareLegacyRuntime({
        root,
        manifest,
        generated: {},
        workflow: 'management',
        outputDirectory: resolve(base, 'output'),
      }),
      /clean/,
    );
  });
