import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateInputs,
  evaluate,
  overrideKinds,
  nativePackagesValid,
  CONFIG,
} from '../tools/environment/policy.mjs';
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

test('empty and approved overrides stay clean while proxy, mirror and npm overrides are rejected', () => {
  assert.deepEqual(overrideKinds({ NODE_OPTIONS: '', FNM_NODE_DIST_MIRROR: 'https://nodejs.org/dist' }), []);
  assert.deepEqual(
    overrideKinds({
      FNM_NODE_DIST_MIRROR: 'https://example.invalid/node',
      https_proxy: 'https://example.invalid/proxy',
      npm_config_unreviewed_setting: 'synthetic',
    }),
    ['download-source', 'npm', 'proxy'],
  );
});

test('environment policy rejects malformed native inventory and unsupported report inputs', () => {
  for (const lock of [null, {}, { packages: null }, { packages: 'invalid' }])
    assert.equal(nativePackagesValid(lock, 'linux', 'x64'), false);
  assert.equal(nativePackagesValid({ packages: { '': {} } }, 'linux', 'x64'), true);
  assert.throws(() => evaluate(inputs(), observation(), 'production'), /Invalid environment mode/);
  const report = evaluate(inputs(), { ...observation(), platform: 'unrecognized', arch: 'unknown' }, 'ci');
  assert.equal(report.exitCode, 1);
  assert.equal(report.eligibleForEvidence, false);
  assert.equal(report.platform, null);
  assert.equal(report.arch, null);
  const missingPorts = evaluate(inputs(), { ...observation(), ports: 'unknown' }, 'ci');
  assert.equal(missingPorts.checks.find((item) => item.id === 'ports').status, 'BLOCKED');
  assert.equal(missingPorts.exitCode, 2);
  assert.equal(missingPorts.eligibleForEvidence, false);
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

test('new CI gates are admitted only on their assigned native platform', () => {
  for (const [job, platform, arch] of [
    ['contracts-m3-macos', 'darwin', 'arm64'],
    ['source-policy-js', 'linux', 'x64'],
    ['dependency-delta-audit', 'linux', 'x64'],
    ['semgrep-ce', 'linux', 'x64'],
    ['osv-scanner', 'linux', 'x64'],
    ['gitleaks', 'linux', 'x64'],
  ]) {
    const candidate = { ...observation(), job, platform, arch, nativeArch: arch };
    assert.equal(evaluate(inputs(), candidate, 'ci').exitCode, 0);
    assert.equal(evaluate(inputs(), { ...candidate, platform: 'win32' }, 'ci').exitCode, 1);
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

test('failed atomic report writes preserve the prior report and remove their temporary file', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-report-atomic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = evaluate(inputs(), observation(), 'ci');
  const destination = writeReport(root, report);
  const before = readFileSync(destination);
  const original = fs.writeFileSync;
  const hook = t.mock.method(fs, 'writeFileSync', (target, ...args) => {
    if (typeof target === 'number') {
      const failure = new Error('synthetic disk full');
      failure.code = 'ENOSPC';
      throw failure;
    }
    return original(target, ...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => writeReport(root, report), { code: 'ENOSPC' });
    assert.deepEqual(readFileSync(destination), before);
    assert.deepEqual(fs.readdirSync(join(root, '.checks/environment')), ['report.json']);
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(writeReport(root, report), destination);
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

test('environment report rejects forged eligibility, status and command evidence', () => {
  const valid = evaluate(inputs(), observation(), 'ci');
  for (const mutate of [
    (r) => {
      r.mode = 'production';
    },
    (r) => {
      r.scope = 'mainnet';
    },
    (r) => {
      r.remoteFreshness = 'PASS';
    },
    (r) => {
      r.baseObservedAt = 'invalid';
    },
    (r) => {
      r.lockSha256 = 'unbound';
    },
    (r) => {
      r.platform = 'unknown';
    },
    (r) => {
      r.arch = 'x86';
    },
    (r) => {
      r.context = 'self-review';
    },
    (r) => {
      r.generatedAt = new Date(Date.now() + 120000).toISOString();
    },
    (r) => {
      r.checks[0].status = 'WARN';
    },
    (r) => {
      r.checks[0].status = 'NOT_RUN';
    },
    (r) => {
      r.checks[0].extra = true;
    },
    (r) => {
      r.checks.at(-1).status = 'PASS';
    },
    (r) => {
      r.eligibleForEvidence = false;
    },
    (r) => {
      r.exitCode = 1;
    },
    (r) => {
      r.head = null;
    },
    (r) => {
      r.node = null;
    },
    (r) => {
      r.commands = null;
    },
    (r) => {
      r.commands = Array(81).fill({ id: 'git-version', exitCode: 0 });
    },
    (r) => {
      r.commands = [{ id: 'unregistered', exitCode: 0 }];
    },
    (r) => {
      r.commands = [{ id: 'git-version', exitCode: -1 }];
    },
    (r) => {
      r.commands = [{ id: 'git-version', exitCode: 256 }];
    },
    (r) => {
      r.commands = [{ id: 'git-version', exitCode: 0, stdout: 'untrusted' }];
    },
  ]) {
    const report = structuredClone(valid);
    mutate(report);
    assert.throws(() => validateReport(report));
  }
  for (const key of ['head', 'tree', 'base', 'sourceHead', 'sourceTree', 'node', 'npm', 'git', 'image']) {
    const report = structuredClone(valid);
    report[key] = 'invalid';
    assert.throws(() => validateReport(report));
  }
  assert.throws(() => validateReport(valid, { branch: 'fixture' }));
  for (const status of ['FAIL', 'BLOCKED']) {
    const report = structuredClone(valid);
    report.checks[0].status = status;
    report.exitCode = status === 'FAIL' ? 1 : 2;
    report.eligibleForEvidence = false;
    report.commands = [{ id: 'git-version', exitCode: null }];
    report.head = null;
    report.node = null;
    assert.equal(validateReport(report), report);
  }
  const warning = evaluate(inputs(), { ...observation(), clean: false }, 'dev');
  assert.equal(validateReport(warning).eligibleForEvidence, false);
});

test('environment writer refuses hard-linked or symlinked report destinations and safely replaces its own file', async (t) => {
  const { linkSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'alphaforge-report-destination-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const report = evaluate(inputs(), observation(), 'ci');
  const destination = writeReport(dir, report);
  const original = readFileSync(destination, 'utf8');
  const linked = join(dir, 'shared');
  linkSync(destination, linked);
  assert.throws(() => writeReport(dir, report), /environment report/);
  assert.equal(readFileSync(linked, 'utf8'), original);
  rmSync(destination);
  symlinkSync(linked, destination);
  assert.throws(() => writeReport(dir, report), /environment report/);
  assert.equal(readFileSync(linked, 'utf8'), original);
  rmSync(destination);
  writeReport(dir, report);
  const next = { ...report, generatedAt: new Date().toISOString() };
  writeReport(dir, next);
  assert.deepEqual(JSON.parse(readFileSync(destination, 'utf8')), next);
  assert.equal(readFileSync(linked, 'utf8'), original);
});
