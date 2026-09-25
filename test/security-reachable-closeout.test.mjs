import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { classifySemgrep, classifyOSV, packageKey } from '../tools/security/results.mjs';
import { buildInventory } from '../tools/security/inputs.mjs';
import { stageSources } from '../tools/security/staging.mjs';
import {
  adjudicateGitleaksHistory,
  readGitleaksExceptionProof,
} from '../tools/security/gitleaks-disposition.mjs';
import { compareLocks, classifyAudit, candidateRefs } from '../tools/ci/check-dependency-delta.mjs';
import { validateCommitSetIdentity } from '../tools/agent-identity-set.mjs';
import { verify } from '../tools/verify-ci.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { scanWorkspace } from '../tools/check-secrets.mjs';
import { emit, inspect } from '../tools/ci/context.mjs';
import { installScanner } from '../tools/security/bootstrap.mjs';
import { verifySecretCanary } from '../tools/ci/check-gitleaks.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

function isolatedCheckout(t, { yaml = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-gate-checkout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'repo');
  const head = fixtureExec('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  fixtureExec('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', repository, root], {
    cwd: directory,
  });
  const canonicalRoot = realpathSync(root);
  fixtureExec('git', ['-C', canonicalRoot, 'checkout', '--quiet', '--detach', head], { cwd: directory });
  fixtureExec('git', ['-C', canonicalRoot, 'update-ref', 'refs/remotes/origin/master', head], {
    cwd: directory,
  });
  if (yaml)
    cpSync(join(repository, 'node_modules/yaml'), join(canonicalRoot, 'node_modules/yaml'), {
      recursive: true,
    });
  assert.equal(
    fixtureExec('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: canonicalRoot,
      encoding: 'utf8',
    }),
    '',
  );
  return canonicalRoot;
}

function gitOnlyEnvironment(t) {
  const ambientPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  const gitName = process.platform === 'win32' ? 'git.exe' : 'git';
  const executable = ambientPath
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory.replace(/^"|"$/g, ''), gitName))
    .find(
      (candidate) =>
        existsSync(candidate) &&
        spawnSync(candidate, ['--version'], { env: process.env, encoding: 'utf8' }).status === 0,
    );
  assert.ok(executable, 'A real Git executable is required');
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-git-only-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const gitLink = join(bin, gitName);
  let executionDirectory = bin;
  try {
    symlinkSync(executable, gitLink, 'file');
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    try {
      linkSync(executable, gitLink);
    } catch {
      executionDirectory = dirname(executable);
    }
  }
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
  );
  environment.PATH = executionDirectory;
  if (process.platform === 'win32' && executionDirectory === bin) {
    const probe = spawnSync('git', ['--version'], { env: environment, encoding: 'utf8' });
    if (probe.status !== 0) {
      rmSync(gitLink, { force: true });
      environment.PATH = dirname(executable);
    }
  }
  return environment;
}

function assertHistoryPrerequisiteRejected(root, reason) {
  const head = fixtureExec('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const child = spawnSync(process.execPath, [join(root, 'tools/ci/check-gitleaks.mjs')], {
    cwd: root,
    env: { ...process.env, GITHUB_EVENT_PATH: '', GITHUB_SHA: '' },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 2, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.reason, reason);
  assert.equal(report.history, undefined);
  assert.equal(report.currentFiles, undefined);
  assert.equal(fixtureExec('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), head);
  assert.equal(
    fixtureExec('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }),
    '',
  );
}

for (const remoteDefault of ['master', 'feature']) {
  test(`actual Gitleaks missing-master rejection is isolated from the ${remoteDefault} clone default`, (t) => {
    const root = isolatedCheckout(t);
    const head = fixtureExec('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const target = `refs/remotes/origin/${remoteDefault}`;
    fixtureExec('git', ['update-ref', target, head], { cwd: root });
    fixtureExec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', target], { cwd: root });
    // Isolate the absent baseline from a second defect: a dangling default alias
    // fails Git fsck before the scanner can report the missing master reference.
    // Both mutations apply only to this disposable fixture, never the source repo.
    fixtureExec('git', ['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'], { cwd: root });
    fixtureExec('git', ['update-ref', '-d', 'refs/remotes/origin/master'], { cwd: root });
    fixtureExec('git', ['fsck', '--connectivity-only', '--no-dangling'], { cwd: root });
    assertHistoryPrerequisiteRejected(root, 'Fetched master ref required for history coverage');
  });
}

test('actual Gitleaks gate also rejects a dangling master default before scanning', (t) => {
  const root = isolatedCheckout(t);
  fixtureExec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master'], {
    cwd: root,
  });
  fixtureExec('git', ['update-ref', '-d', 'refs/remotes/origin/master'], { cwd: root });
  assertHistoryPrerequisiteRejected(root, 'Gitleaks Git history prerequisite failed');
});

test('real environment and CI entrypoints reject injected interpreter settings before starting tools', () => {
  for (const [path, args, mode] of [
    ['tools/check-environment.mjs', [], 'dev'],
    ['tools/check-environment.mjs', ['--ci'], 'ci'],
    ['tools/verify-ci.mjs', [], 'ci'],
  ]) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../${path}`, import.meta.url)), ...args],
      {
        env: { ...process.env, FNM_NODE_DIST_MIRROR: 'https://example.invalid/untrusted-runtime' },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    assert.equal(child.error, undefined);
    assert.ok([1, 2].includes(child.status), child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.mode, mode);
    assert.equal(report.eligibleForEvidence, false);
    assert.equal(report.exitCode, child.status);
    assert.equal(report.checks.find((row) => row.id === 'overrides').status, 'FAIL');
    assert.deepEqual(report.commands, []);
    assert.doesNotMatch(child.stdout + child.stderr, /untrusted-runtime/);
  }
});

test('actual supply-chain CLI rejects an unpinned workflow action in an isolated checkout', (t) => {
  const root = isolatedCheckout(t, { yaml: true });
  const workflow = join(root, '.github/workflows/ci.yml');
  const original = readFileSync(workflow, 'utf8');
  const sbom = join(root, 'docs/security/npm-sbom.spdx.json');
  const originalSbom = readFileSync(sbom);
  const unpinned = original.replace(/(actions\/checkout@)[a-f0-9]{40}/, '$1v7');
  assert.notEqual(unpinned, original, 'the fixture must alter a real pinned action');
  writeFileSync(workflow, unpinned);
  const child = spawnSync(process.execPath, [join(root, 'tools/check-supply-chain.mjs')], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /Invalid supply-chain state: .*unpinned or malformed Action reference/);
  assert.deepEqual(readFileSync(sbom), originalSbom);
});

test('CI report emission preserves failure exits and rejects oversized evidence before output', (t) => {
  const previous = process.exitCode;
  const rows = [];
  const capture = t.mock.method(console, 'log', (value) => rows.push(JSON.parse(value)));
  try {
    for (const [state, expected] of [
      ['PASS', 0],
      ['FAIL', 1],
      ['BLOCKED', 2],
    ]) {
      emit({ state });
      assert.equal(process.exitCode, expected);
      assert.equal(rows.at(-1).state, state);
    }
    assert.throws(() => emit({ state: 'PASS', payload: 'x'.repeat(512 * 1024) }), /bounded output limit/);
    assert.equal(rows.length, 3);
    assert.equal(process.exitCode, 2);
  } finally {
    capture.mock.restore();
    process.exitCode = previous;
  }
});

test('CI source inspection rejects malformed event object identities', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-ci-context-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'event.json');
  const previous = process.env.GITHUB_EVENT_PATH;
  process.env.GITHUB_EVENT_PATH = path;
  try {
    for (const event of [
      { after: 'invalid' },
      { pull_request: { head: { sha: 'a'.repeat(40) }, base: { sha: 'invalid' } } },
    ]) {
      writeFileSync(path, JSON.stringify(event));
      assert.throws(() => inspect(), /Invalid source identity/);
    }
  } finally {
    if (previous === undefined) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = previous;
  }
});

test('unknown scanner and missing canary executable cannot produce scanner admission', async (t) => {
  await assert.rejects(installScanner('unreviewed'), /Unknown scanner/);
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-canary-failure-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(
    () =>
      verifySecretCanary({
        directory,
        binary: join(directory, 'missing-scanner'),
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
        },
      }),
    /history\/redaction canary failed/,
  );
});

test('actual identity CLI refuses malformed events and empty protected ranges', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-identity-entry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const eventPath = join(directory, 'event.json');
  const execute = (args, extra = {}) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../tools/check-agent-identity.mjs', import.meta.url)), ...args],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'local',
          GITHUB_EVENT_PATH: '',
          GITHUB_REF: '',
          GITHUB_SHA: '',
          ...extra,
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
  const args = ['--branch', 'ordinary-fixture', '--base', 'HEAD', '--head', 'HEAD'];
  const ordinary = execute(args);
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.match(ordinary.stdout, /skipped for non-worker branch: ordinary-fixture/);
  for (const event of [null, [], 1]) {
    writeFileSync(eventPath, JSON.stringify(event));
    const child = execute(args, { GITHUB_EVENT_PATH: eventPath });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Invalid GitHub event/);
    assert.equal(child.stdout, '');
  }
  writeFileSync(eventPath, '{}');
  for (const name of ['pull_request', 'merge_group']) {
    const child = execute(args, { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: name });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /identity context|protected merge_group context/);
  }
  const protectedRange = execute(['--branch', 'master', '--base', 'HEAD', '--head', 'HEAD']);
  assert.equal(protectedRange.status, 1);
  assert.match(protectedRange.stderr, /Invalid protected target range/);
});

test('actual gate entrypoints reject arguments before starting any scanner or installer', () => {
  for (const path of [
    'tools/ci/check-gitleaks.mjs',
    'tools/ci/check-semgrep.mjs',
    'tools/ci/check-source-policy.mjs',
    'tools/ci/check-dependency-delta.mjs',
    'tools/ci/verify-contracts.mjs',
  ]) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../${path}`, import.meta.url)), '--invalid'],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: process.env,
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    assert.equal(child.status, 2, path);
    assert.equal(child.signal, null, path);
    const report = JSON.parse(child.stdout);
    assert.equal(report.state, 'BLOCKED', path);
    assert.equal(report.reason, 'Gate accepts no command-line arguments', path);
    assert.equal(child.stderr, '', path);
  }
});

test('dependency delta blocks malformed event ranges before invoking npm audit', (t) => {
  const root = isolatedCheckout(t, { yaml: true });
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-dependency-event-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const eventPath = join(directory, 'event.json');
  writeFileSync(eventPath, JSON.stringify({ before: 'invalid', after: 'a'.repeat(40) }));
  const child = spawnSync(process.execPath, [join(root, 'tools/ci/check-dependency-delta.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_EVENT_PATH: eventPath,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(child.status, 2, JSON.stringify({ stdout: child.stdout, stderr: child.stderr }));
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.state, 'BLOCKED');
  assert.match(report.reason, /Missing exact base\/head/);
  assert.doesNotMatch(child.stdout, /invalid/);
});

test('contract gate blocks before toolchain stages when native Python is unavailable', (t) => {
  const root = isolatedCheckout(t);
  const environment = gitOnlyEnvironment(t);
  const gitProbe = spawnSync('git', ['--version'], { env: environment, encoding: 'utf8' });
  assert.equal(gitProbe.status, 0);
  assert.match(gitProbe.stdout, /^git version /);
  const pythonProbe = spawnSync('python3.12', ['--version'], { env: environment, encoding: 'utf8' });
  assert.equal(pythonProbe.error?.code, 'ENOENT');
  const child = spawnSync(process.execPath, [join(root, 'tools/ci/verify-contracts.mjs')], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(child.status, 2, JSON.stringify({ stdout: child.stdout, stderr: child.stderr }));
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  assert.notEqual(child.stdout, '', JSON.stringify({ status: child.status, stderr: child.stderr }));
  const report = JSON.parse(child.stdout);
  assert.equal(report.state, 'BLOCKED');
  assert.equal(report.reason, 'Native Python prerequisite unavailable');
});

test('environment CLI writes the bounded report only after validation', (t) => {
  const root = isolatedCheckout(t);
  const reportPath = join(root, '.checks/environment/report.json');
  const child = spawnSync(process.execPath, [join(root, 'tools/check-environment.mjs'), '--write-report'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(child.error, undefined);
  assert.ok([0, 1, 2].includes(child.status));
  const report = JSON.parse(child.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.exitCode, child.status);
  assert.equal(existsSync(reportPath), true);
  assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report);
});

test('environment CLI rejects malformed source JSON without writing a report or disclosing values', (t) => {
  const root = isolatedCheckout(t);
  const reportPath = join(root, '.checks/environment/report.json');
  writeFileSync(join(root, 'planning/development-environment.json'), '{"synthetic":');
  const child = spawnSync(process.execPath, [join(root, 'tools/check-environment.mjs'), '--write-report'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stderr);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /^Environment check BLOCKED:/);
  assert.doesNotMatch(child.stderr, /synthetic/);
  assert.equal(existsSync(reportPath), false);
});

test('actual bootstrap and integration entrypoints reject malformed local invocation', () => {
  for (const [path, args, status, message] of [
    ['tools/bootstrap-ci-npm.mjs', ['--invalid'], 2, /BLOCKED at inputs/],
    ['tools/check-environment.mjs', ['--ci', '--ci'], 2, /Environment check BLOCKED/],
    ['tools/check-local-agent-integration.mjs', [], 1, /Require --branch, --base and --head/],
    [
      'tools/check-local-agent-integration.mjs',
      ['--branch', 'fixture', '--branch', 'fixture', '--head', 'HEAD'],
      1,
      /Invalid LOCAL arguments/,
    ],
    ['tools/local-ci/run.mjs', [], 2, /Local CI BLOCKED/],
    ['tools/verify-ci.mjs', ['--invalid'], 2, /CI verification BLOCKED/],
  ]) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../${path}`, import.meta.url)), ...args],
      {
        env: process.env,
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    assert.equal(child.status, status, path);
    assert.match(child.stderr, message, path);
    assert.equal(child.stdout, '', path);
  }
});

test('hosted npm bootstrap refuses synthetic invalid contexts before touching the installed runtime', () => {
  for (const invalid of [
    { GITHUB_ACTIONS: 'false' },
    { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_REPOSITORY: 'unapproved/repository' },
    { FNM_NODE_DIST_MIRROR: 'https://example.invalid/node' },
  ]) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../tools/bootstrap-ci-npm.mjs', import.meta.url))],
      {
        env: {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          RUNNER_ENVIRONMENT: 'github-hosted',
          GITHUB_REPOSITORY: 'pdbsy/quantpass-arbitrum-hackathon',
          ...invalid,
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    assert.equal(child.status, 2);
    assert.match(child.stderr, /BLOCKED at inputs/);
    assert.equal(child.stdout, '');
  }
});

test('secret baseline rejects environment files and read errors while retaining its explicit binary boundary', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-secret-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  fixtureExec('git', ['init', '--quiet', '-b', 'master'], { cwd: root });
  writeFileSync(join(root, '.env.example'), 'MODE=mock\n');
  writeFileSync(join(root, 'asset.bin'), Buffer.from([65, 0, 66]));
  await scanWorkspace(root);
  writeFileSync(join(root, '.env.local'), 'MODE=mock\n');
  await assert.rejects(scanWorkspace(root), /\.env\.local: environment-file/);
  rmSync(join(root, '.env.local'));
  const source = join(root, 'source.txt');
  writeFileSync(source, 'ordinary source\n');
  fixtureExec('git', ['add', 'source.txt'], { cwd: root });
  rmSync(source);
  await scanWorkspace(root);
  mkdirSync(source);
  await assert.rejects(scanWorkspace(root), (error) => error.code === 'EISDIR');
  rmSync(source, { recursive: true });
  const synthetic = ['ghp', '_', 'A'.repeat(36)].join('');
  writeFileSync(source, synthetic);
  await assert.rejects(scanWorkspace(root), (error) => {
    assert.match(error.message, /source\.txt: github-token/);
    assert.doesNotMatch(error.message, new RegExp(synthetic));
    return true;
  });
});

// Malformed scanner success must not admit findings with incomplete identities.
test('Semgrep rejects contradictory exits and incomplete finding locations', () => {
  const finding = { check_id: 'fixture.rule', path: 'fixture.ts', start: { line: 1 } };
  const report = { version: '1.177.0', results: [finding], errors: [], paths: { scanned: ['fixture.ts'] } };
  assert.equal(classifySemgrep({ status: 1, report }, ['fixture.ts'], '1.177.0').state, 'FAIL');
  assert.equal(classifySemgrep({ status: 0, report }, ['fixture.ts'], '1.177.0').state, 'BLOCKED');
  for (const patch of [{ check_id: '' }, { path: 'outside.ts' }, { start: {} }, { start: { line: 0 } }]) {
    assert.equal(
      classifySemgrep(
        { status: 1, report: { ...report, results: [{ ...finding, ...patch }] } },
        ['fixture.ts'],
        '1.177.0',
      ).state,
      'BLOCKED',
    );
  }
});

test('OSV rejects malformed package identities and partial advisory rows', () => {
  for (const entry of [
    null,
    { name: '' },
    { name: 'fixture', commit: '--bad' },
    { name: 'fixture', ecosystem: 'unknown', version: '1.0.0' },
    { name: 'fixture', ecosystem: 'npm', version: '' },
  ])
    assert.throws(() => packageKey(entry));
  const packageValue = { ecosystem: 'npm', name: 'fixture', version: '1.0.0' };
  const run = (result, status = 0) => classifyOSV({ status, report: { results: [result] } }, [packageValue]);
  assert.equal(run({ packages: [{ package: packageValue }] }).state, 'PASS');
  for (const result of [
    { packages: null },
    { packages: [], error: 'fixture failure' },
    { packages: [{ package: packageValue, vulnerabilities: {} }] },
    { packages: [{ package: packageValue, vulnerabilities: [{ id: '' }] }] },
  ])
    assert.equal(run(result).state, 'BLOCKED');
  assert.equal(
    run({ packages: [{ package: packageValue, vulnerabilities: [{ id: 'OSV-FIXTURE-1' }] }] }, 1).state,
    'FAIL',
  );
});

function inventory() {
  return {
    npmLock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/fixture': { version: '1.0.0' } } },
    pythonLocks: [`fixture==1.0.0 --hash=sha256:${'a'.repeat(64)}\n`],
    contractLock: {
      openzeppelin: { version: '5.4.0' },
      foundry: { version: '1.5.1', commit: 'b'.repeat(40) },
      solc: { version: '0.8.31' },
    },
    browserPackage: {
      source: 'planning/coverage-toolchain.lock.json#browser.package',
      name: 'playwright-core',
      version: '1.62.1',
      url: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.1.tgz',
      sha256: 'a'.repeat(64),
      bytes: 1,
    },
  };
}

test('inventory refuses duplicate extra sources, invalid byte counts and missing contract pins', () => {
  const value = inventory();
  assert.equal(buildInventory(value).browserEntries, 1);
  for (const bytes of [0, -1, 1.2, '1'])
    assert.throws(
      () => buildInventory({ ...value, browserPackage: { ...value.browserPackage, bytes } }),
      /browser package bytes/,
    );
  const graph = { source: 'fixture-lock.json', lock: value.npmLock };
  assert.throws(() => buildInventory({ ...value, extraNpmLocks: [graph, graph] }), /Duplicate coverage/);
  assert.throws(() => buildInventory({ ...value, extraNpmLocks: [null] }), /Duplicate coverage/);
  for (const field of ['openzeppelin', 'foundry', 'solc']) {
    const changed = structuredClone(value);
    delete changed.contractLock[field];
    assert.throws(() => buildInventory(changed), /Incomplete custom contract/);
  }
  const changed = structuredClone(value);
  delete changed.contractLock.foundry.commit;
  assert.throws(() => buildInventory(changed), /Incomplete custom contract/);
});

test('staging refuses empty or ambiguous coverage and NUL inputs without copying them', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'af-stage-closeout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'),
    destination = join(root, 'scan');
  mkdirSync(source);
  mkdirSync(destination);
  writeFileSync(join(source, 'input.txt'), Buffer.from([65, 0, 66]));
  for (const paths of [[], ['input.txt', 'input.txt'], ['input.txt']])
    assert.throws(() => stageSources(source, destination, paths));
  writeFileSync(join(source, 'input.txt'), 'ordinary text');
  assert.equal(stageSources(source, destination, ['input.txt']).files, 1);
});

test('historical disposition rejects non-date observations while retaining raw findings', () => {
  const value = {
    status: 10,
    report: [
      {
        RuleID: 'generic-api-key',
        Commit: '69330dfffeceb86cf793fa0163ff4f72a466f3eb',
        File: 'docs/product/PHASE1-PRODUCT-WALLET-FLOWS.md',
        StartLine: 12,
        EndLine: 12,
      },
    ],
  };
  const proof = readGitleaksExceptionProof(new URL('../', import.meta.url));
  assert.ok(proof);
  for (const date of [null, '2026-09-23T00:00:00Z', new Date(NaN)]) {
    const result = adjudicateGitleaksHistory(value, proof, date);
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.raw.state, 'FAIL');
    assert.deepEqual(result.dispositions, []);
  }
});

test('dependency deltas and audit reports refuse missing graphs and contradictory findings', () => {
  for (const [base, head] of [
    [null, {}],
    [{}, null],
    [{ packages: {} }, {}],
  ])
    assert.throws(() => compareLocks(base, head), /Lock package graph/);
  const empty = {
    auditReportVersion: 2,
    metadata: {
      dependencies: { total: 1 },
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
    vulnerabilities: {},
  };
  assert.equal(classifyAudit({ status: 0, report: empty }).state, 'PASS');
  for (const counts of [
    { ...empty.metadata.vulnerabilities, total: 1 },
    { ...empty.metadata.vulnerabilities, low: -1 },
  ])
    assert.equal(
      classifyAudit({
        status: 0,
        report: { ...empty, metadata: { ...empty.metadata, vulnerabilities: counts } },
      }).state,
      'BLOCKED',
    );
  assert.equal(classifyAudit({ status: 1, report: empty }).state, 'BLOCKED');
  assert.equal(
    classifyAudit({ status: 0, report: { ...empty, vulnerabilities: { fixture: { severity: 'unknown' } } } })
      .state,
    'BLOCKED',
  );
  for (const event of [{}, { merge_group: {} }])
    assert.throws(() => candidateRefs('merge_group', event, {}), /Missing exact/);
  assert.throws(() => candidateRefs('untrusted-event', {}, {}), /Unsupported event/);
});

test('identity ranges reject malformed inputs and empty protected or worker ranges', () => {
  for (const value of [
    { branch: null, commits: [] },
    { branch: 'feature', commits: null },
    { branch: 'master', commits: [] },
    { branch: 'feature', commits: [], protectedTarget: true },
    { branch: 'macbeth06/fixture', commits: [] },
  ])
    assert.throws(() => validateCommitSetIdentity(value));
  assert.deepEqual(
    validateCommitSetIdentity({ branch: 'feature', commits: [{ subject: null, body: null }] }),
    { skipped: true, verified: 0 },
  );
  assert.deepEqual(
    validateCommitSetIdentity({ branch: 'master', commits: [{ subject: 'ordinary change', body: '' }] }),
    { skipped: false, verified: 0 },
  );
});

test('CI wrapper propagates abnormal process status and failed post-run admission', () => {
  const good = { exitCode: 0, head: 'a', tree: 'b', lockSha256: 'c' };
  for (const status of [null, -1, undefined, NaN])
    assert.equal(verify({ inspect: () => good, run: () => status, emit: () => {} }), 2);
  for (const exitCode of [1, 2]) {
    let index = 0;
    assert.equal(
      verify({ inspect: () => (index++ ? { ...good, exitCode } : good), run: () => 0, emit: () => {} }),
      exitCode,
    );
  }
});
