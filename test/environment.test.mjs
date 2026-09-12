import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInputs, evaluate, overrideKinds, CONFIG } from '../tools/environment/policy.mjs';
import { validateReport, writeReport } from '../tools/environment/report.mjs';

const root = new URL('../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const inputs = () => ({
  node: readFileSync(new URL('.node-version', root), 'utf8').trim(),
  package: json('package.json'),
  lock: json('package-lock.json'),
  policy: json('planning/development-environment.json'),
  supply: json('planning/supply-chain-policy.json'),
});
const observation = () => ({
  node: inputs().node,
  npm: inputs().package.packageManager.slice(4),
  job: 'verify',
  platform: 'linux',
  arch: 'x64',
  nativeArch: 'x64',
  runtimeAligned: true,
  nativeDependenciesValid: true,
  git: '2.50.1',
  originValid: true,
  rootValid: true,
  head: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  base: 'c'.repeat(40),
  sourceHead: 'a'.repeat(40),
  sourceTree: 'b'.repeat(40),
  context: 'push',
  historyValid: true,
  clean: true,
  hiddenIndex: false,
  authorConfigured: true,
  filesValid: true,
  isolated: true,
  ports: 'PASS',
  overrides: [],
  localMock: true,
  fnm: null,
  image: '20260907.1',
  config: {
    ...CONFIG,
    'engine-strict': 'true',
    'save-exact': 'true',
    'ignore-scripts': 'true',
    'strict-ssl': 'true',
    registry: 'https://registry.npmjs.org/',
    omit: '',
    'legacy-peer-deps': 'false',
  },
  commands: [],
});

test('exact input sources reject engine and root lock drift without mutation', () => {
  const original = inputs();
  assert.doesNotThrow(() => validateInputs(original));
  for (const mutate of [
    (x) => (x.package.engines.node = '>=24'),
    (x) => (x.lock.packages[''].engines.npm = '11.0.0'),
    (x) => (x.package.packageManager = 'pnpm@11.0.0'),
    (x) => (x.policy.extra = true),
  ]) {
    const altered = structuredClone(original);
    mutate(altered);
    assert.throws(() => validateInputs(altered), /environment inputs/);
  }
  assert.deepEqual(original, inputs());
});

test('admission rejects wrong tools, architecture, registry, TLS, omission and hidden Git state', () => {
  assert.equal(evaluate(inputs(), observation(), 'ci').exitCode, 0);
  for (const mutate of [
    (x) => (x.node = '0.0.0'),
    (x) => (x.npm = '0.0.0'),
    (x) => (x.nativeArch = 'arm64'),
    (x) => (x.config.registry = 'https://registry.npmjs.org/?credential=PRIVATE'),
    (x) => (x.config['strict-ssl'] = 'false'),
    (x) => (x.config.omit = 'optional'),
    (x) => (x.hiddenIndex = true),
    (x) => (x.overrides = ['node']),
    (x) => (x.localMock = false),
    (x) => (x.clean = false),
    (x) => (x.filesValid = false),
    (x) => (x.runtimeAligned = false),
    (x) => (x.job = 'unknown-job'),
    (x) => (x.config['script-shell'] = 'unapproved'),
    (x) => (x.config['allow-scripts'] = 'unapproved'),
  ]) {
    const candidate = observation();
    mutate(candidate);
    const report = evaluate(inputs(), candidate, 'ci');
    assert.equal(report.exitCode, 1);
    assert.equal(report.eligibleForEvidence, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  }
});

test('missing history is BLOCKED; developer dirt is diagnostic only; contracts remain NOT_RUN', () => {
  let o = observation();
  o.historyValid = false;
  assert.equal(evaluate(inputs(), o, 'ci').exitCode, 2);
  o = observation();
  o.clean = false;
  const r = evaluate(inputs(), o, 'dev');
  assert.equal(r.exitCode, 0);
  assert.equal(r.eligibleForEvidence, false);
  assert.equal(r.checks.find((c) => c.id === 'contracts').status, 'NOT_RUN');
  o = observation();
  o.platform = 'darwin';
  o.arch = o.nativeArch = 'arm64';
  assert.equal(evaluate(inputs(), o, 'dev').exitCode, 2);
});

test('override diagnostics never expose values and reject Node/Git/TLS injection', () => {
  assert.deepEqual(
    overrideKinds({
      NODE_OPTIONS: 'PRIVATE',
      GIT_OBJECT_DIRECTORY: 'PRIVATE',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    }),
    ['git', 'node', 'tls'],
  );
  assert.deepEqual(
    overrideKinds({
      PATH: 'PRIVATE',
      npm_config_user_agent: 'npm/11',
      npm_config_registry: 'https://registry.npmjs.org/',
    }),
    [],
  );
});

test('reports enforce shape, freshness, exact tree and safe fixed destination', () => {
  const r = evaluate(inputs(), observation(), 'ci');
  assert.doesNotThrow(() => validateReport(r, { head: r.head, tree: r.tree }));
  for (const change of [
    (x) => delete x.lockSha256,
    (x) => (x.untrusted = 'PRIVATE'),
    (x) => (x.generatedAt = '2000-01-01T00:00:00.000Z'),
    (x) => (x.tree = 'd'.repeat(40)),
    (x) => (x.checks = []),
  ]) {
    const copy = structuredClone(r);
    change(copy);
    assert.throws(() => validateReport(copy, { head: r.head, tree: r.tree }), /environment report/);
  }
  const dir = mkdtempSync(join(tmpdir(), 'quantpass environment 中文 '));
  try {
    writeReport(dir, r);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.checks/environment/report.json'), 'utf8')), r);
    rmSync(join(dir, '.checks'), { recursive: true });
    mkdirSync(join(dir, 'outside'));
    symlinkSync(
      join(dir, 'outside'),
      join(dir, '.checks'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => writeReport(dir, r), /environment report/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installed optional native packages must match the actual platform and CPU', async () => {
  const { nativePackagesValid } = await import('../tools/environment/policy.mjs');
  assert.equal(
    nativePackagesValid(
      { packages: { 'node_modules/native': { os: ['darwin'], cpu: ['arm64'] } } },
      'darwin',
      'arm64',
    ),
    true,
  );
  assert.equal(
    nativePackagesValid(
      { packages: { 'node_modules/native': { os: ['darwin'], cpu: ['x64'] } } },
      'darwin',
      'arm64',
    ),
    false,
  );
  assert.equal(
    nativePackagesValid(
      { packages: { 'node_modules/native': { os: ['win32'], cpu: ['arm64'] } } },
      'darwin',
      'arm64',
    ),
    false,
  );
});

test('Git filter and included configuration is rejected before content-sensitive probes', async () => {
  const { unsafeGitConfig } = await import('../tools/environment/policy.mjs');
  assert.equal(unsafeGitConfig(['core.repositoryformatversion', 'remote.origin.url']), false);
  assert.equal(unsafeGitConfig(['filter.example.clean']), true);
  assert.equal(unsafeGitConfig(['include.path']), true);
  assert.equal(unsafeGitConfig(['includeif.gitdir:example.path']), true);
});

test('SQLite data admission rejects shared hard links and nested symlink directories', async () => {
  const { dataRootIsolated } = await import('../tools/environment/observe.mjs');
  const { writeFileSync, linkSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'environment data '));
  try {
    mkdirSync(join(dir, '.data'));
    writeFileSync(join(dir, '.data/demo.sqlite'), 'fixture');
    assert.equal(dataRootIsolated(dir), true);
    linkSync(join(dir, '.data/demo.sqlite'), join(dir, 'other-ledger'));
    assert.equal(dataRootIsolated(dir), false);
    rmSync(join(dir, 'other-ledger'));
    mkdirSync(join(dir, 'shared'));
    symlinkSync(
      join(dir, 'shared'),
      join(dir, '.data/shared'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.equal(dataRootIsolated(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Intel macOS is outside the user-approved platform scope', () => {
  const o = observation();
  o.platform = 'darwin';
  o.arch = o.nativeArch = 'x64';
  o.job = 'verify-macos';
  assert.equal(evaluate(inputs(), o, 'ci').exitCode, 1);
});
