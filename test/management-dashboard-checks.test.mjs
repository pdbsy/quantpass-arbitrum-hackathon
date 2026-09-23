import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CHECK_REGISTRY,
  parseProfileArgs,
  runCheck,
  runChecks,
} from '../tools/management-dashboard/checks.mjs';
import { validateCheckReport } from '../tools/management-dashboard/schema.mjs';
import {
  runEscapedPipeTimeoutFixture,
  runSynchronousKillErrorFixture,
} from './helpers/management-timeout-fixture.mjs';

const commit = '3333333333333333333333333333333333333333';
const tree = '4444444444444444444444444444444444444444';

test(
  'qualified native lint timeout and FAULT_INJECTED synchronous timeout error stay bounded',
  { skip: process.platform === 'win32' },
  async () => {
    // Independent fixtures share the unchanged real 120-second lint deadline in wall time.
    const outcomes = await Promise.allSettled([
      runEscapedPipeTimeoutFixture(),
      runSynchronousKillErrorFixture({ waitForTimeout: true }),
    ]);
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    const [observed, timeoutError] = outcomes.map((outcome) => outcome.value);
    assert.equal(observed.settledBeforeRelease, true, `unbounded after ${observed.elapsedMs}ms`);
    assert.equal(observed.result.record.status, 'FAIL');
    assert.equal(observed.result.record.exitCode, 124);
    assert.equal(observed.result.cleanupConfirmed, false);
    assert.ok(Buffer.byteLength(observed.result.log, 'utf8') <= 160);
    assert.match(observed.result.log, /TIMEOUT/);
    assert.match(observed.result.log, /CLEANUP_UNCONFIRMED/);
    assert.equal(observed.result.log.includes(observed.syntheticToken), false);
    // Boundary injection uses the actual platform and timer, not native Windows coverage.
    assert.equal(timeoutError.signalCalls, 2, 'only initial TERM and one cleanup KILL');
    assert.equal(timeoutError.result.record.status, 'FAIL');
    assert.equal(timeoutError.result.record.exitCode, 124);
    assert.equal(timeoutError.result.cleanupConfirmed, false);
    assert.match(timeoutError.result.log, /^TIMEOUT\nCLEANUP_UNCONFIRMED/);
    assert.match(timeoutError.result.log, /PROCESS_ERROR/);
  },
);

function gitState(overrides = {}) {
  return {
    status: 'READY',
    source: '.git',
    observedAt: '2026-09-08T22:59:00.000Z',
    branch: 'macbeth/dashboard',
    commit,
    tree,
    dirtyFiles: 0,
    aheadBehind: { ahead: 1, behind: 0 },
    recentCommits: [],
    ...overrides,
  };
}

function gitStateSequence(...states) {
  let index = 0;
  return async () => structuredClone(states[Math.min(index++, states.length - 1)]);
}

function clock(...values) {
  const instants = values.map((value) => new Date(value));
  return () => instants.shift() ?? new Date(values.at(-1));
}

test('check registry has unique fixed commands and explicit unregistered checks', () => {
  const ids = CHECK_REGISTRY.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    'typecheck',
    'lint',
    'format',
    'unit',
    'integration',
    'e2e',
    'secret-scan',
    'public-metadata',
    'dependency-audit',
    'build',
    'planning-consistency',
    'foundry',
    'fuzz',
    'invariant',
    'slither',
  ]);

  for (const check of CHECK_REGISTRY) {
    assert.match(check.id, /^[a-z][a-z0-9-]+$/);
    if (check.available) {
      assert.match(check.file, /^(?:node|npm)$/);
      assert.ok(Array.isArray(check.args));
      assert.ok(check.args.every((argument) => typeof argument === 'string'));
      assert.ok(Number.isInteger(check.timeoutMs) && check.timeoutMs > 0);
    } else {
      assert.equal(check.status, 'NOT_RUN');
      assert.equal(check.reason, 'NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR');
      assert.equal('file' in check, false);
      assert.equal('args' in check, false);
    }
  }

  const unitArguments = CHECK_REGISTRY.find((check) => check.id === 'unit').args;
  for (const path of [
    'test/management-dashboard-schema.test.mjs',
    'test/management-dashboard-sources.test.mjs',
    'test/management-dashboard-checks.test.mjs',
    'test/management-dashboard-build.test.mjs',
    'test/management-dashboard-ui.test.mjs',
    'test/management-dashboard-server.test.mjs',
    'test/public-metadata.test.mjs',
    'test/environment.test.mjs',
    'test/environment-git.test.mjs',
    'test/environment-ci.test.mjs',
  ])
    assert.ok(unitArguments.includes(path), `unit evidence must execute ${path}`);
});

test('profile parser accepts only fixed quick/full selections', () => {
  assert.equal(parseProfileArgs([]), 'full');
  assert.equal(parseProfileArgs(['--profile=full']), 'full');
  assert.equal(parseProfileArgs(['--profile=quick']), 'quick');
  assert.throws(() => parseProfileArgs(['--profile=unknown']), /invalid profile/i);
  assert.throws(() => parseProfileArgs(['--command=whoami']), /unknown argument/i);
  assert.throws(() => parseProfileArgs(['--profile=quick', '--profile=full']), /one profile/i);
});

test('runCheck binds a real success to commit, duration, evidence, and sanitized bounded output', async () => {
  const simulatedToken = `${'gh' + 'p_'}ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`;
  const result = await runCheck('lint', {
    root: process.cwd(),
    commit,
    runId: 'run-1',
    clock: clock('2026-09-08T22:40:00.000Z', '2026-09-08T22:40:00.025Z'),
    maxLogBytes: 96,
    runProcess: async () => ({
      exitCode: 0,
      stdout: `lint passed ${simulatedToken} ${'x'.repeat(200)}`,
      stderr: '',
      timedOut: false,
    }),
  });

  assert.deepEqual(result.record, {
    id: 'lint',
    status: 'PASS',
    startedAt: '2026-09-08T22:40:00.000Z',
    finishedAt: '2026-09-08T22:40:00.025Z',
    durationMs: 25,
    exitCode: 0,
    evidence: '.checks/management/run-1/lint.log',
  });
  assert.ok(Buffer.byteLength(result.log, 'utf8') <= 96);
  assert.doesNotMatch(result.log, /ghp_|ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890/);
  assert.match(result.log, /TRUNCATED/);
});

test('runCheck records nonzero and timeout outcomes as failures', async () => {
  const failed = await runCheck('lint', {
    root: process.cwd(),
    commit,
    runId: 'run-2',
    clock: clock('2026-09-08T22:41:00.000Z', '2026-09-08T22:41:00.010Z'),
    runProcess: async () => ({ exitCode: 2, stdout: '', stderr: 'lint failed', timedOut: false }),
  });
  assert.equal(failed.record.status, 'FAIL');
  assert.equal(failed.record.exitCode, 2);
  assert.match(failed.log, /lint failed/);

  const timedOut = await runCheck('e2e', {
    root: process.cwd(),
    commit,
    runId: 'run-3',
    clock: clock('2026-09-08T22:42:00.000Z', '2026-09-08T22:44:00.000Z'),
    runProcess: async () => ({ exitCode: 124, stdout: '', stderr: '', timedOut: true }),
  });
  assert.equal(timedOut.record.status, 'FAIL');
  assert.equal(timedOut.record.exitCode, 124);
  assert.match(timedOut.log, /TIMEOUT/);
});

test('FAULT_INJECTED cleanup uncertainty fails closed and preserves timeout exit 124', async () => {
  for (const [timedOut, observedExitCode, expectedExitCode] of [
    [false, 0, 127],
    [true, 0, 124],
    // A process error after the real timeout must not downgrade its exit classification.
    [true, 127, 124],
  ]) {
    const result = await runCheck('lint', {
      root: process.cwd(),
      commit,
      runId: 'unconfirmed-result',
      runProcess: async () => ({
        exitCode: observedExitCode,
        stdout: 'completed output',
        stderr: '',
        timedOut,
        cleanupConfirmed: false,
      }),
    });
    assert.equal(result.record.status, 'FAIL');
    assert.equal(result.record.exitCode, expectedExitCode);
    assert.equal(result.cleanupConfirmed, false);
    assert.match(result.log, /CLEANUP_UNCONFIRMED/);
    if (timedOut) assert.match(result.log, /^TIMEOUT\n/);
  }
});

test(
  'FAULT_INJECTED synchronous group signal error does not reenter cleanup',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runSynchronousKillErrorFixture();
    assert.equal(result.signalCalls, 1);
    assert.equal(result.result.record.status, 'FAIL');
    assert.equal(result.result.record.exitCode, 127);
    assert.equal(result.result.cleanupConfirmed, false);
    assert.match(result.result.log, /CLEANUP_UNCONFIRMED/);
    assert.match(result.result.log, /PROCESS_ERROR/);
    assert.deepEqual(result.evidence, {
      errorMessage: 'CHECK_PROCESS_CLEANUP_UNCONFIRMED',
      signalCalls: 1,
      latest: 'previous complete evidence',
      files: ['typecheck.log'],
    });
  },
);

test('FAULT_INJECTED unconfirmed cleanup cannot produce PASS or replace complete evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-check-cleanup-unconfirmed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const priorPath = join(root, '.checks/management/latest.json');
  await mkdir(join(root, '.checks/management'), { recursive: true });
  await writeFile(priorPath, 'previous complete evidence\n');
  const syntheticToken = `${'gh' + 'p_'}ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`;
  let calls = 0;
  await assert.rejects(
    runChecks({
      root,
      profile: 'quick',
      runId: 'unconfirmed-cleanup',
      maxLogBytes: 96,
      collectGitState: gitStateSequence(gitState()),
      runProcess: async () => {
        calls++;
        return calls === 1
          ? { exitCode: 0, stdout: 'typecheck complete', stderr: '', timedOut: false }
          : {
              exitCode: 0,
              stdout: syntheticToken,
              stderr: '',
              timedOut: false,
              cleanupConfirmed: false,
            };
      },
    }),
    /CHECK_PROCESS_CLEANUP_UNCONFIRMED/,
  );
  assert.equal(calls, 2);
  assert.equal(await readFile(priorPath, 'utf8'), 'previous complete evidence\n');
  const evidenceDirectory = join(root, '.checks/management/unconfirmed-cleanup');
  assert.deepEqual(await readdir(evidenceDirectory), ['lint.log']);
  const diagnostic = await readFile(join(evidenceDirectory, 'lint.log'), 'utf8');
  assert.ok(Buffer.byteLength(diagnostic, 'utf8') <= 96);
  assert.match(diagnostic, /CLEANUP_UNCONFIRMED/);
  assert.equal(diagnostic.includes(syntheticToken), false);
});

test('unavailable checks stay NOT_RUN without invoking a process', async () => {
  let processCalls = 0;
  const result = await runCheck('foundry', {
    root: process.cwd(),
    commit,
    runId: 'run-4',
    clock: clock('2026-09-08T22:45:00.000Z'),
    runProcess: async () => {
      processCalls++;
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
  });
  assert.equal(result.record.status, 'NOT_RUN');
  assert.equal(result.record.exitCode, null);
  assert.equal(result.record.reason, 'NOT_REGISTERED_IN_MANAGEMENT_COLLECTOR');
  assert.equal(processCalls, 0);
});

test('runChecks writes a complete validated report and per-check logs atomically', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-checks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let tick = 0;
  const base = Date.parse('2026-09-08T23:00:00.000Z');
  const report = await runChecks({
    root,
    commit,
    profile: 'quick',
    clock: () => new Date(base + tick++ * 5),
    runId: 'fixed-run',
    runProcess: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
    collectGitState: gitStateSequence(gitState(), gitState()),
  });

  assert.equal(validateCheckReport(report), report);
  assert.equal(report.complete, true);
  assert.equal(report.profile, 'quick');
  assert.equal(report.branch, 'macbeth/dashboard');
  assert.equal(report.commit, commit);
  assert.equal(report.tree, tree);
  assert.equal(
    report.checks.some((check) => check.id === 'dependency-audit'),
    false,
  );
  assert.equal(
    report.checks.some((check) => check.id === 'foundry' && check.status === 'NOT_RUN'),
    true,
  );

  const persisted = JSON.parse(await readFile(join(root, '.checks/management/latest.json'), 'utf8'));
  assert.deepEqual(persisted, report);
  assert.equal(await readFile(join(root, '.checks/management/fixed-run/lint.log'), 'utf8'), 'ok\n');
});

test('runChecks refuses to execute or publish evidence from a dirty initial tree', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-checks-dirty-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let processCalls = 0;

  await assert.rejects(
    () =>
      runChecks({
        root,
        commit,
        profile: 'quick',
        runId: 'dirty-run',
        runProcess: async () => {
          processCalls++;
          return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
        },
        collectGitState: gitStateSequence(gitState({ dirtyFiles: 1 })),
      }),
    /CHECK_GIT_NOT_CLEAN/,
  );
  assert.equal(processCalls, 0);
  await assert.rejects(() => readFile(join(root, '.checks/management/latest.json'), 'utf8'), {
    code: 'ENOENT',
  });
});

test('runChecks preserves prior evidence when the checked tree changes before publication', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-checks-changing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reportPath = join(root, '.checks/management/latest.json');
  await mkdir(join(root, '.checks/management'), { recursive: true });
  await writeFile(reportPath, 'previous valid evidence\n');
  let processCalls = 0;

  await assert.rejects(
    () =>
      runChecks({
        root,
        commit,
        profile: 'quick',
        runId: 'changing-run',
        runProcess: async () => {
          processCalls++;
          return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
        },
        collectGitState: gitStateSequence(gitState(), gitState({ dirtyFiles: 1 })),
      }),
    /CHECK_GIT_CHANGED_DURING_RUN/,
  );
  assert.equal(processCalls, 1);
  assert.equal(await readFile(reportPath, 'utf8'), 'previous valid evidence\n');
});

test('runChecks rejects symlinked evidence directories without writing outside the repository', async (t) => {
  for (const link of ['.checks', '.checks/management']) {
    const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-checks-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-checks-target-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const externalReport = join(outside, 'latest.json');
    await writeFile(externalReport, 'external sentinel\n');
    if (link === '.checks/management') await mkdir(join(root, '.checks'));
    await symlink(outside, join(root, link));
    let processCalls = 0;

    await assert.rejects(
      () =>
        runChecks({
          root,
          commit,
          profile: 'quick',
          runId: 'symlink-run',
          runProcess: async () => {
            processCalls++;
            return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
          },
          collectGitState: gitStateSequence(gitState()),
        }),
      /CHECK_EVIDENCE_PATH_UNSAFE/,
    );
    assert.equal(processCalls, 0);
    assert.equal(await readFile(externalReport, 'utf8'), 'external sentinel\n');
    assert.deepEqual(await readdir(outside), ['latest.json']);
  }
});

test('runChecks removes an incomplete temporary report when the final rename fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-checks-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.checks/management/latest.json'), { recursive: true });

  await assert.rejects(() =>
    runChecks({
      root,
      commit,
      profile: 'quick',
      clock: clock('2026-09-08T23:10:00.000Z'),
      runId: 'failed-write',
      runProcess: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
      collectGitState: gitStateSequence(gitState(), gitState()),
    }),
  );

  const managementFiles = await readdir(join(root, '.checks/management'));
  assert.deepEqual(
    managementFiles.filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('runCheck rejects unknown IDs instead of accepting an arbitrary command', async () => {
  await assert.rejects(
    () => runCheck('whoami', { root: process.cwd(), commit, runId: 'run-5' }),
    /unknown check/i,
  );
});

test('real check process bounds output, preserves failure and never exposes an inherited credential', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-check-process-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'node emit.mjs' } }));
  await writeFile(
    join(root, 'emit.mjs'),
    "import { writeFileSync } from 'node:fs'; if (process.env.ALPHAFORGE_TEST_SECRET) process.exit(9); writeFileSync('runtime.json', JSON.stringify({ executable: process.execPath, node: process.versions.node })); process.stdout.write('x'.repeat(200000)); process.stderr.write('y'.repeat(200000));",
  );
  const old = process.env.ALPHAFORGE_TEST_SECRET;
  process.env.ALPHAFORGE_TEST_SECRET = 'synthetic-local-marker';
  t.after(() => {
    if (old === undefined) delete process.env.ALPHAFORGE_TEST_SECRET;
    else process.env.ALPHAFORGE_TEST_SECRET = old;
  });
  const result = await runCheck('lint', { root, commit, runId: 'actual-process', maxLogBytes: 80 });
  assert.equal(
    result.record.status,
    'PASS',
    JSON.stringify({
      exitCode: result.record.exitCode,
      cleanupConfirmed: result.cleanupConfirmed,
      log: result.log,
    }),
  );
  assert.deepEqual(JSON.parse(await readFile(join(root, 'runtime.json'), 'utf8')), {
    executable: process.execPath,
    node: process.versions.node,
  });
  assert.ok(Buffer.byteLength(result.log) <= 80);
  assert.match(result.log, /TRUNCATED/);
  assert.doesNotMatch(result.log, /synthetic-local-marker/);
  await writeFile(join(root, 'emit.mjs'), 'process.exit(7);');
  const failure = await runCheck('lint', { root, commit, runId: 'actual-failure' });
  assert.equal(failure.record.status, 'FAIL');
  assert.equal(failure.record.exitCode, 7);
});

test('check runner rejects missing identities and captures launcher exceptions as failed evidence', async () => {
  for (const patch of [
    { commit: undefined },
    { commit: 'short' },
    { runId: undefined },
    { runId: '../escape' },
  ])
    await assert.rejects(runCheck('lint', { root: process.cwd(), commit, runId: 'fixture', ...patch }));
  const failed = await runCheck('lint', {
    root: process.cwd(),
    commit,
    runId: 'failed-launch',
    runProcess: async () => {
      throw Error('sensitive launcher detail');
    },
  });
  assert.equal(failed.record.status, 'FAIL');
  assert.equal(failed.record.exitCode, 127);
  assert.match(failed.log, /PROCESS_ERROR/);
  assert.doesNotMatch(failed.log, /sensitive/);
  const silent = await runCheck('lint', {
    root: process.cwd(),
    commit,
    runId: 'silent',
    runProcess: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
  });
  assert.equal(silent.log, '(no output)\n');
});

test('runChecks rejects absent source identity before running checks or replacing prior evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-check-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.checks/management'), { recursive: true });
  const reportPath = join(root, '.checks/management/latest.json');
  await writeFile(reportPath, 'previous evidence\n');
  for (const patch of [{ commit: undefined }, { tree: undefined }, { branch: '../escape' }]) {
    let calls = 0;
    await assert.rejects(
      runChecks({
        root,
        runId: 'invalid-identity',
        collectGitState: gitStateSequence(gitState(patch)),
        runProcess: async () => {
          calls++;
          return { exitCode: 0, stdout: 'ok', stderr: '', timedOut: false };
        },
      }),
      /CHECK_GIT_NOT_CLEAN/,
    );
    assert.equal(calls, 0);
    assert.equal(await readFile(reportPath, 'utf8'), 'previous evidence\n');
    assert.deepEqual(await readdir(join(root, '.checks/management')), ['latest.json']);
  }
});

test('runChecks defaults to full and binds automatic run IDs to the actual clean source', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-check-defaults-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runChecks({
    root,
    collectGitState: gitStateSequence(gitState()),
    runProcess: async () => ({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
  });
  assert.equal(result.profile, 'full');
  assert.equal(result.commit, commit);
  assert.equal(result.tree, tree);
  assert.ok(result.checks.some((check) => check.id === 'dependency-audit' && check.status === 'PASS'));
  assert.ok(result.checks.some((check) => check.id === 'slither' && check.status === 'NOT_RUN'));
  assert.deepEqual(JSON.parse(await readFile(join(root, '.checks/management/latest.json'), 'utf8')), result);
  const evidence = result.checks.find((check) => check.id === 'lint').evidence;
  assert.match(evidence, /333333333333\/lint\.log$/);
  assert.equal(await readFile(join(root, evidence), 'utf8'), 'ok\n');
});

test('runChecks obtains source identity from actual Git when no collector override is supplied', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-check-real-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    fixtureExec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '-b', 'master');
  await writeFile(join(root, '.gitignore'), '.checks/\n');
  git('add', '.gitattributes', '.gitignore');
  git('commit', '--quiet', '-m', 'fixture');
  const expectedCommit = git('rev-parse', 'HEAD');
  const expectedTree = git('rev-parse', 'HEAD^{tree}');
  const report = await runChecks({
    root,
    profile: 'quick',
    runId: 'actual-git',
    runProcess: async () => ({ exitCode: 0, stdout: 'fixture check result', stderr: '', timedOut: false }),
  });
  assert.equal(report.commit, expectedCommit);
  assert.equal(report.tree, expectedTree);
  assert.equal(report.branch, 'master');
  assert.equal(git('status', '--porcelain'), '');
  assert.deepEqual(JSON.parse(await readFile(join(root, '.checks/management/latest.json'), 'utf8')), report);
});

test('a missing process working directory yields failed evidence and a bounded generic error', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-check-missing-cwd-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const failed = await runCheck('lint', { root: join(root, 'absent'), commit, runId: 'missing-cwd' });
  assert.equal(failed.record.status, 'FAIL');
  assert.equal(failed.record.exitCode, 127);
  assert.equal(failed.log, 'PROCESS_ERROR\n');
});

test('runCheck records a process terminated by signal as a failure with bounded evidence', async () => {
  const result = await runCheck('lint', {
    root: process.cwd(),
    commit,
    runId: 'signal-run',
    clock: clock('2026-09-08T22:46:00.000Z', '2026-09-08T22:46:00.010Z'),
    runProcess: async () => ({
      exitCode: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: 'terminated',
      timedOut: false,
    }),
  });
  assert.equal(result.record.status, 'FAIL');
  assert.equal(result.record.exitCode, null);
  assert.match(result.log, /terminated/);
});

for (const replacement of ['directory', 'file']) {
  test(`evidence creation validates a competing process ${replacement} after native EEXIST`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'alphaforge-checks-mkdir-race-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = join(await fsPromises.realpath(root), '.checks');
    const original = fsPromises.mkdir;
    let raced = false;
    let nativeError;
    let commands = 0;
    const run = () =>
      runChecks({
        root,
        commit,
        profile: 'quick',
        runId: 'real-mkdir-race',
        collectGitState: gitStateSequence(gitState()),
        runProcess: async () => {
          commands++;
          return { exitCode: 7, stdout: '', stderr: 'deliberate fixture command failure', timedOut: false };
        },
      });
    try {
      fsPromises.mkdir = async (path, options) => {
        if (path !== target || raced) return original(path, options);
        raced = true;
        const actor = spawnSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import {mkdirSync,writeFileSync} from 'node:fs'; process.argv[2]==='directory'?mkdirSync(process.argv[1]):writeFileSync(process.argv[1],'competing file');",
            target,
            replacement,
          ],
          { encoding: 'utf8', timeout: 15000 },
        );
        assert.equal(actor.error, undefined);
        assert.equal(actor.status, 0, actor.stderr);
        try {
          return await original(path, options);
        } catch (error) {
          nativeError = error.code;
          throw error;
        }
      };
      syncBuiltinESMExports();
      if (replacement === 'file') {
        await assert.rejects(run, /CHECK_EVIDENCE_PATH_UNSAFE/);
        assert.equal(commands, 0);
        assert.equal(await readFile(target, 'utf8'), 'competing file');
      } else {
        const report = await run();
        assert.ok(commands > 0);
        assert.ok(report.checks.every((row) => row.status === 'FAIL' || row.status === 'NOT_RUN'));
        assert.deepEqual(JSON.parse(await readFile(join(target, 'management/latest.json'), 'utf8')), report);
        assert.deepEqual((await readdir(join(target, 'management'))).sort(), [
          'latest.json',
          'real-mkdir-race',
        ]);
      }
    } finally {
      fsPromises.mkdir = original;
      syncBuiltinESMExports();
    }
    assert.equal(raced, true);
    assert.equal(nativeError, 'EEXIST');
  });
}

test(
  'evidence creation propagates actual parent permission failure without running checks',
  {
    skip: process.platform === 'win32' || process.getuid?.() === 0,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'alphaforge-checks-parent-permission-'));
    t.after(async () => {
      await fsPromises.chmod(root, 0o700);
      await rm(root, { recursive: true, force: true });
    });
    let commands = 0;
    await fsPromises.chmod(root, 0o500);
    await assert.rejects(
      () =>
        runChecks({
          root,
          commit,
          profile: 'quick',
          runId: 'permission-denied',
          collectGitState: gitStateSequence(gitState()),
          runProcess: async () => {
            commands++;
            throw Error('must not run');
          },
        }),
      (error) => ['EACCES', 'EPERM'].includes(error.code),
    );
    assert.equal(commands, 0);
    assert.deepEqual(await readdir(root), []);
  },
);
