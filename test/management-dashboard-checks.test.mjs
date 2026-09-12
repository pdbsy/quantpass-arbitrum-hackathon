import assert from 'node:assert/strict';
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

const commit = '3333333333333333333333333333333333333333';
const tree = '4444444444444444444444444444444444444444';

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

test('check registry has unique fixed commands and explicit unavailable toolchains', () => {
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
      assert.equal(check.reason, 'APPROVED_TOOLCHAIN_NOT_AVAILABLE');
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
  assert.equal(result.record.reason, 'APPROVED_TOOLCHAIN_NOT_AVAILABLE');
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
