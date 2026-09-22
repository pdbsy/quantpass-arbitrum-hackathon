import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { boundedRead, inspectEnvironment, readInputs } from '../tools/environment/observe.mjs';

const repository = resolve(import.meta.dirname, '..');
// These are real isolated fixture probes, never host/hosted admission evidence.
// The supplied environment omits coverage hooks from child npm/Git probes only;
// an explicit NODE_OPTIONS negative still proves the actual admission rule.
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-observe-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'source');
  mkdirSync(root);
  mkdirSync(join(root, 'planning'));
  for (const file of [
    '.node-version',
    'package.json',
    'package-lock.json',
    '.npmrc',
    '.env.example',
    '.gitattributes',
    '.editorconfig',
    'planning/development-environment.json',
    'planning/supply-chain-policy.json',
  ])
    copyFileSync(join(repository, file), join(root, file));
  writeFileSync(join(root, '.gitignore'), '.data/\nnode_modules/\n');
  writeFileSync(join(root, 'source.txt'), 'isolated fixture\n');
  const environment = {
    PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter),
    HOME: parent,
    TMPDIR: parent,
    ...(process.platform === 'win32'
      ? { SystemRoot: process.env.SystemRoot, PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE }
      : {}),
  };
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      env: { ...environment, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'fixture');
  git('config', 'user.name', 'Environment Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('remote', 'add', 'origin', 'https://github.com/pdbsy/quantpass-arbitrum-hackathon.git');
  git('add', '.');
  git('commit', '-m', 'isolated environment source');
  git('update-ref', 'refs/remotes/origin/master', git('rev-parse', 'HEAD'));
  return {
    root,
    parent,
    environment,
    git,
    inspect: (extra = {}) => inspectEnvironment({ root, environment, ...extra }),
  };
}
const status = (report, id) => report.checks.find((check) => check.id === id)?.status;

test('real environment probes bind a clean fixture to exact source and local npm configuration', (t) => {
  const f = fixture(t);
  const report = f.inspect();
  for (const id of [
    'inputs',
    'tools',
    'repository',
    'history',
    'workspace',
    'index',
    'identity',
    'files',
    'isolation',
    'overrides',
    'npm-config',
    'local-mock',
  ])
    assert.equal(status(report, id), 'PASS', id);
  assert.equal(report.head, f.git('rev-parse', 'HEAD'));
  assert.equal(report.tree, f.git('rev-parse', 'HEAD^{tree}'));
  assert.equal(report.context, 'local');
  assert.equal(report.remoteFreshness, 'NOT_RUN');
  assert.equal(status(report, 'contracts'), 'NOT_RUN');
  assert.ok(report.commands.some((c) => c.id === 'npm-version' && c.exitCode === 0));
});

test('injected interpreter settings stop real environment probes before launching npm or Git', (t) => {
  const f = fixture(t);
  const report = f.inspect({
    environment: { ...f.environment, NODE_OPTIONS: '--require=synthetic-never-executed' },
  });
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
  assert.deepEqual(report.commands, []);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-never-executed/);
});

test('real Git hidden-index and origin changes cannot produce eligible source evidence', (t) => {
  const f = fixture(t);
  f.git('update-index', '--assume-unchanged', 'source.txt');
  writeFileSync(join(f.root, 'source.txt'), 'changed hidden bytes\n');
  f.git('remote', 'set-url', 'origin', 'https://example.invalid/unapproved.git');
  const report = f.inspect();
  assert.equal(status(report, 'index'), 'FAIL');
  assert.equal(status(report, 'repository'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('unsafe repository configuration and grafts stop inspection before executable probes', (t) => {
  const f = fixture(t);
  f.git('config', 'filter.synthetic.clean', 'never-execute-this');
  let report = f.inspect();
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.equal(
    report.commands.some((c) => c.id === 'npm-version'),
    false,
  );
  f.git('config', '--remove-section', 'filter.synthetic');
  writeFileSync(join(f.root, '.git/info/grafts'), 'invalid fixture history\n');
  report = f.inspect();
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.equal(
    report.commands.some((c) => c.id === 'npm-version'),
    false,
  );
});

test('shared data, malformed native dependencies and real-mode overrides reject fixture admission', (t) => {
  const f = fixture(t);
  const shared = join(f.parent, 'external-data');
  mkdirSync(shared);
  symlinkSync(shared, join(f.root, '.data'), process.platform === 'win32' ? 'junction' : 'dir');
  mkdirSync(join(f.root, 'node_modules'));
  writeFileSync(join(f.root, 'node_modules/.package-lock.json'), '{');
  const report = f.inspect({ environment: { ...f.environment, QP_MODE: 'live', NODE_ENV: 'production' } });
  assert.equal(status(report, 'isolation'), 'FAIL');
  assert.notEqual(status(report, 'platform'), 'PASS');
  assert.equal(status(report, 'local-mock'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('local fixture cannot masquerade as hosted CI and dirty files remain visible', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'source.txt'), 'changed fixture\n');
  const report = f.inspect({ mode: 'ci' });
  assert.equal(status(report, 'history'), 'BLOCKED');
  assert.equal(status(report, 'workspace'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('bounded environment reads reject symlinks, oversized inputs and invalid UTF-8', (t) => {
  const f = fixture(t);
  const file = join(f.parent, 'input');
  writeFileSync(file, 'valid');
  assert.equal(boundedRead(file, 5), 'valid');
  assert.throws(() => boundedRead(file, 4));
  const link = join(f.parent, 'link');
  symlinkSync(file, link);
  assert.throws(() => boundedRead(link));
  writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => boundedRead(file));
  const node = readFileSync(join(f.root, '.node-version'));
  writeFileSync(join(f.root, '.node-version'), '0.0.0\n');
  assert.throws(() => readInputs(f.root), /Invalid environment inputs/);
  writeFileSync(join(f.root, '.node-version'), node);
  assert.equal(readInputs(f.root).node, node.toString().trim());
});
