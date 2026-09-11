import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseTaskRecord, parseWorkerLog } from '../tools/management-dashboard/markdown.mjs';
import {
  collectGitState,
  collectRecordedGitState,
  collectRepositorySources,
} from '../tools/management-dashboard/sources.mjs';

const fixtureRoot = new URL('./fixtures/management-dashboard/', import.meta.url);
const observedAt = '2026-09-08T22:35:18.000Z';

test('worker parser returns documented current state and activity records', async () => {
  const text = await readFile(new URL('worker-valid.md', fixtureRoot), 'utf8');
  const worker = parseWorkerLog(text);

  assert.deepEqual(worker.current, {
    currentTask: 'B5 — CREATE CONTROL CENTER HOMEPAGE',
    status: 'IN_PROGRESS',
    branch: 'macbeth/dashboard',
    lastKnownCommit: 'abc1234',
    blocker: 'NONE',
    lastActivity: '2026-09-08T22:35:18+08:00',
  });
  assert.equal(worker.activities.length, 1);
  assert.equal(worker.activities[0].timestamp, '2026-09-08T22:35:18+08:00');
  assert.equal(worker.activities[0].task, 'B5');
  assert.equal(worker.activities[0].action, 'wrote tests');
});

test('worker parser rejects a present but malformed source', async () => {
  const text = await readFile(new URL('worker-malformed.md', fixtureRoot), 'utf8');
  assert.throws(() => parseWorkerLog(text), /Current status/);
});

test('task parser preserves incomplete and unresolved evidence', () => {
  const task = parseTaskRecord(`# B5 Task Record

Task ID: \`B5\`

Title: \`CONTROL CENTER\`

Worker: \`Worker B / Macbeth\`

Start: \`2026-09-08T22:00:00+08:00\`

Finish: \`NOT_FINISHED\`

Status: \`IN_PROGRESS\`

## Summary

Building the homepage.

## Not fully resolved

- Data collector.
`);

  assert.equal(task.id, 'B5');
  assert.equal(task.status, 'IN_PROGRESS');
  assert.equal(task.finish, 'NOT_FINISHED');
  assert.deepEqual(task.sections['Not fully resolved'], ['Data collector.']);
});

async function createSourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-source-'));
  await mkdir(join(root, 'planning'), { recursive: true });
  await mkdir(join(root, 'docs/management/workers'), { recursive: true });
  await mkdir(join(root, 'docs/management/tasks'), { recursive: true });
  await mkdir(join(root, 'docs/security'), { recursive: true });
  await mkdir(join(root, 'docs/adr'), { recursive: true });
  await writeFile(
    join(root, 'planning/roadmap.json'),
    JSON.stringify({ project: { name: 'QuantPass' }, tasks: [], releaseGates: [] }),
  );
  await writeFile(join(root, 'planning/risk-register.json'), JSON.stringify({ risks: [] }));
  await writeFile(
    join(root, 'planning/security-boundary.json'),
    JSON.stringify({ environment: { chainId: 46630 } }),
  );
  await writeFile(
    join(root, 'docs/management/workers/worker-b.md'),
    await readFile(new URL('worker-valid.md', fixtureRoot), 'utf8'),
  );
  return root;
}

test('repository collector distinguishes missing optional sources from malformed mandatory data', async (t) => {
  const root = await createSourceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const sources = await collectRepositorySources(root, { observedAt });
  assert.equal(sources.roadmap.status, 'READY');
  assert.equal(sources.workers.workerB.status, 'READY');
  assert.equal(sources.workers.workerA.status, 'NOT_AVAILABLE');
  assert.equal(sources.management.currentStatus.status, 'NOT_AVAILABLE');
  assert.equal(sources.management.decisions.status, 'NOT_AVAILABLE');
  assert.equal(sources.management.changelog.status, 'NOT_AVAILABLE');
  assert.equal(sources.documents.host.status, 'NOT_AVAILABLE');
  assert.equal(sources.documents.project.status, 'NOT_AVAILABLE');

  await writeFile(join(root, 'planning/roadmap.json'), '{invalid-json');
  const malformed = await collectRepositorySources(root, { observedAt });
  assert.equal(malformed.roadmap.status, 'DATA_SOURCE_ERROR');
  assert.equal(malformed.roadmap.error, 'INVALID_JSON');
});

test('repository collector rejects an optional symlink that escapes the repository', async (t) => {
  const root = await createSourceFixture();
  const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-outside-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'worker-a.md'), '# Worker A Log\n');
  await symlink(join(outside, 'worker-a.md'), join(root, 'docs/management/workers/worker-a.md'));

  const sources = await collectRepositorySources(root, { observedAt });
  assert.equal(sources.workers.workerA.status, 'DATA_SOURCE_ERROR');
  assert.equal(sources.workers.workerA.error, 'PATH_OUTSIDE_REPOSITORY');
});

test('repository collector rejects an allowlisted source redirected inside the repository', async (t) => {
  const root = await createSourceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateMarker = ['ignored', 'internal', 'credential', 'marker'].join('-');
  await writeFile(join(root, 'private.env'), `${privateMarker}\n`);
  await symlink('../../private.env', join(root, 'docs/management/CURRENT-STATUS.md'));

  const sources = await collectRepositorySources(root, { observedAt });

  assert.equal(sources.management.currentStatus.status, 'DATA_SOURCE_ERROR');
  assert.equal(sources.management.currentStatus.error, 'SYMLINK_NOT_ALLOWED');
  assert.doesNotMatch(JSON.stringify(sources), new RegExp(privateMarker));
});

test('document link collection rejects a directory symlink outside the repository', async (t) => {
  const root = await createSourceFixture();
  const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-docs-outside-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'external.md'), 'outside\n');
  await rm(join(root, 'docs/security'), { recursive: true });
  await symlink(outside, join(root, 'docs/security'));

  const sources = await collectRepositorySources(root, { observedAt });
  assert.equal(sources.documents.security.status, 'DATA_SOURCE_ERROR');
  assert.equal(sources.documents.security.error, 'PATH_OUTSIDE_REPOSITORY');
});

test('document collection rejects a directory redirected to an internal private location', async (t) => {
  const root = await createSourceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateDirectory = join(root, 'private-records');
  const privateBasename = ['ignored', 'wallet', 'inventory'].join('-');
  await mkdir(privateDirectory, { recursive: true });
  await writeFile(join(privateDirectory, `${privateBasename}.md`), '# private\n');
  await rm(join(root, 'docs/security'), { recursive: true });
  await symlink('../private-records', join(root, 'docs/security'));

  const sources = await collectRepositorySources(root, { observedAt });

  assert.equal(sources.documents.security.status, 'DATA_SOURCE_ERROR');
  assert.equal(sources.documents.security.error, 'SYMLINK_NOT_ALLOWED');
  assert.doesNotMatch(JSON.stringify(sources.documents.security), new RegExp(privateBasename));
});

test('task collection contains the directory before enumerating external filenames', async (t) => {
  const root = await createSourceFixture();
  const outside = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-tasks-outside-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const externalBasename = ['wallet', 'recovery', 'inventory'].join('-');
  await writeFile(join(outside, `${externalBasename}.md`), '# external task\n');
  await rm(join(root, 'docs/management/tasks'), { recursive: true });
  await symlink(outside, join(root, 'docs/management/tasks'));

  const sources = await collectRepositorySources(root, { observedAt });

  assert.deepEqual(sources.taskRecords, [
    {
      status: 'DATA_SOURCE_ERROR',
      source: 'docs/management/tasks',
      observedAt,
      error: 'PATH_OUTSIDE_REPOSITORY',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(sources.taskRecords), new RegExp(externalBasename));
});

test('repository collection stops after a bounded number of directory entries', async (t) => {
  const root = await createSourceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(
    Array.from({ length: 257 }, (_, index) =>
      writeFile(join(root, 'docs/management/tasks', `ignored-${String(index).padStart(3, '0')}.txt`), 'x'),
    ),
  );

  const sources = await collectRepositorySources(root, { observedAt });

  assert.deepEqual(sources.taskRecords, [
    {
      status: 'DATA_SOURCE_ERROR',
      source: 'docs/management/tasks',
      observedAt,
      error: 'SOURCE_ENTRY_BUDGET_EXCEEDED',
    },
  ]);
});

test('repository collection shares a bounded source-file budget across direct files and links', async (t) => {
  const root = await createSourceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(
    Array.from({ length: 125 }, (_, index) =>
      writeFile(join(root, 'docs/security', `document-${String(index).padStart(3, '0')}.md`), '# doc\n'),
    ),
  );

  const sources = await collectRepositorySources(root, { observedAt });

  assert.equal(sources.documents.security.status, 'DATA_SOURCE_ERROR');
  assert.equal(sources.documents.security.error, 'SOURCE_FILE_BUDGET_EXCEEDED');
});

test('repository collection shares an aggregate byte budget across bounded source reads', async (t) => {
  const root = await createSourceFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const padding = 'x'.repeat(900_000);
  await Promise.all([
    writeFile(join(root, 'planning/roadmap.json'), JSON.stringify({ padding })),
    writeFile(join(root, 'planning/risk-register.json'), JSON.stringify({ padding })),
    writeFile(join(root, 'planning/security-boundary.json'), JSON.stringify({ padding })),
    writeFile(join(root, 'docs/management/CURRENT-STATUS.md'), padding),
    writeFile(join(root, 'docs/management/WORK-QUEUE.md'), padding),
  ]);

  const sources = await collectRepositorySources(root, { observedAt });

  assert.equal(sources.management.currentStatus.status, 'READY');
  assert.equal(sources.management.workQueue.status, 'DATA_SOURCE_ERROR');
  assert.equal(sources.management.workQueue.error, 'SOURCE_AGGREGATE_BYTES_EXCEEDED');
});

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root, message) {
  git(root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'commit',
    '--quiet',
    '-m',
    message,
  ]);
}

async function configureMaliciousFsMonitor(root) {
  const monitor = join(root, 'fsmonitor');
  await writeFile(monitor, '#!/bin/sh\nprintf \'token\\0\'');
  await chmod(monitor, 0o755);
  git(root, ['config', 'core.fsmonitor', monitor]);
  git(root, ['config', 'core.fsmonitorHookVersion', '2']);
}

async function createRecordedGitFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-recorded-layout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet', '-b', 'master']);
  await writeFile(join(root, 'README.md'), 'base\n');
  git(root, ['add', 'README.md']);
  commit(root, 'base');
  const baseCommit = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '--quiet', '-c', 'macbeth/dashboard']);
  await writeFile(join(root, 'recorded.txt'), 'recorded\n');
  git(root, ['add', 'recorded.txt']);
  commit(root, 'recorded');
  const recordedCommit = git(root, ['rev-parse', 'HEAD']);
  const recordedTree = git(root, ['rev-parse', 'HEAD^{tree}']);

  await mkdir(join(root, 'docs/management/dashboard/data'), { recursive: true });
  await writeFile(join(root, 'docs/management/dashboard/data/dashboard.json'), '{}\n');
  git(root, ['add', 'docs/management/dashboard/data/dashboard.json']);
  commit(root, 'generated dashboard closure');
  const headCommit = git(root, ['rev-parse', 'HEAD']);

  git(root, ['switch', '--quiet', '-c', 'forged', baseCommit]);
  await writeFile(join(root, 'forged.txt'), 'forged\n');
  git(root, ['add', 'forged.txt']);
  commit(root, 'forged sibling');
  const forgedCommit = git(root, ['rev-parse', 'HEAD']);
  const forgedTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  git(root, ['switch', '--quiet', 'macbeth/dashboard']);

  return { root, baseCommit, recordedCommit, recordedTree, headCommit, forgedCommit, forgedTree };
}

function recordedGit(branch, commitHash, treeHash) {
  return {
    status: 'READY',
    source: '.git',
    observedAt,
    branch,
    commit: commitHash,
    tree: treeHash,
    dirtyFiles: 0,
    aheadBehind: { ahead: 999, behind: 999 },
    recentCommits: [{ hash: 'untrusted-derived-value' }],
  };
}

function pushEnvironment(headCommit) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/macbeth/dashboard',
    GITHUB_SHA: headCommit,
  };
}

function integratedPushEnvironment(headCommit) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/master',
    GITHUB_SHA: headCommit,
  };
}

function workflowDispatchEnvironment(headCommit) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/macbeth/dashboard',
    GITHUB_SHA: headCommit,
  };
}

function pullRequestEnvironment(mergeCommit) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/7/merge',
    GITHUB_SHA: mergeCommit,
    GITHUB_BASE_REF: 'master',
    GITHUB_HEAD_REF: 'macbeth/dashboard',
  };
}

function createPullRequestLayout(fixture) {
  const { root, baseCommit, headCommit } = fixture;
  git(root, ['update-ref', 'refs/remotes/origin/master', baseCommit]);
  git(root, ['update-ref', 'refs/remotes/origin/macbeth/dashboard', headCommit]);
  git(root, ['switch', '--quiet', '--detach', baseCommit]);
  git(root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'merge',
    '--quiet',
    '--no-ff',
    '-m',
    'synthetic pull request merge',
    'refs/remotes/origin/macbeth/dashboard',
  ]);
  const mergeCommit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/pull/7/merge', mergeCommit]);
  assert.equal(git(root, ['rev-parse', 'HEAD^1']), baseCommit);
  assert.equal(git(root, ['rev-parse', 'HEAD^2']), headCommit);
  git(root, ['branch', '-D', 'master', 'macbeth/dashboard', 'forged']);
  assert.equal(git(root, ['branch', '--show-current']), '');
  return mergeCommit;
}

function createMergeGroupLayout(fixture) {
  const { root, baseCommit, headCommit } = fixture;
  const queueBranch = `gh-readonly-queue/master/pr-7-${headCommit}`;
  git(root, ['update-ref', 'refs/remotes/origin/master', baseCommit]);
  git(root, ['update-ref', 'refs/remotes/origin/macbeth/dashboard', headCommit]);
  git(root, ['switch', '--quiet', '--detach', baseCommit]);
  git(root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'merge',
    '--quiet',
    '--no-ff',
    '-m',
    'synthetic merge group',
    'refs/remotes/origin/macbeth/dashboard',
  ]);
  const mergeCommit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', `refs/remotes/origin/${queueBranch}`, mergeCommit]);
  git(root, ['branch', '-D', 'master', 'macbeth/dashboard', 'forged']);
  assert.equal(git(root, ['branch', '--show-current']), '');
  return { mergeCommit, queueBranch };
}

function createIntegratedPushLayout(fixture) {
  const { root, baseCommit, headCommit } = fixture;
  git(root, ['update-ref', 'refs/remotes/origin/macbeth/dashboard', headCommit]);
  git(root, ['switch', '--quiet', '-C', 'master', baseCommit]);
  git(root, ['merge', '--quiet', '--squash', 'refs/remotes/origin/macbeth/dashboard']);
  commit(root, 'squashed source branch');
  const integratedCommit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/master', integratedCommit]);
  assert.notEqual(integratedCommit, headCommit);
  assert.equal(git(root, ['rev-parse', 'HEAD^{tree}']), git(root, ['rev-parse', `${headCommit}^{tree}`]));
  return integratedCommit;
}

test('Git collector reports real branch, dirty state, history, and ahead/behind', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'master']);
  await writeFile(join(root, 'README.md'), 'base\n');
  git(root, ['add', 'README.md']);
  git(root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'commit',
    '-m',
    'base',
  ]);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', '-c', 'codex/test']);
  await writeFile(join(root, 'feature.txt'), 'feature\n');
  git(root, ['add', 'feature.txt']);
  git(root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'commit',
    '-m',
    'feature',
  ]);
  await writeFile(join(root, 'working.txt'), 'dirty\n');
  await mkdir(join(root, 'docs/management/dashboard/data'), { recursive: true });
  await writeFile(join(root, 'docs/management/dashboard/data/dashboard.json'), '{}\n');
  await writeFile(join(root, 'docs/management/dashboard/data/build-log.json'), '{}\n');

  const state = await collectGitState(root, 'master', {
    excludeDirtyPaths: [
      'docs/management/dashboard/data/dashboard.json',
      'docs/management/dashboard/data/build-log.json',
    ],
  });
  assert.equal(state.status, 'READY');
  assert.equal(state.branch, 'codex/test');
  assert.equal(state.tree, git(root, ['rev-parse', 'HEAD^{tree}']));
  assert.equal(state.dirtyFiles, 1);
  assert.deepEqual(state.aheadBehind, { ahead: 1, behind: 0 });
  assert.equal(state.recentCommits.length, 2);
  assert.equal(state.recentCommits[1].hash, baseCommit);
  assert.equal(state.recentCommits[0].author, 'Macbeth');
});

test('Git collector rejects unsafe dirty-path exclusions', async () => {
  await assert.rejects(
    () => collectGitState(process.cwd(), 'master', { excludeDirtyPaths: ['../outside'] }),
    /invalid dirty-path exclusion/i,
  );
});

for (const [name, flag] of [
  ['assume-unchanged', '--assume-unchanged'],
  ['skip-worktree', '--skip-worktree'],
]) {
  test(`Git collector rejects a tracked ${name} entry`, async (t) => {
    const fixture = await createRecordedGitFixture(t);
    git(fixture.root, ['update-index', flag, 'recorded.txt']);
    await writeFile(join(fixture.root, 'recorded.txt'), 'hidden working-tree change\n');
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), '');

    const state = await collectGitState(fixture.root, 'master');
    assert.equal(state.status, 'DATA_SOURCE_ERROR');
    assert.equal(state.error, 'GIT_QUERY_FAILED');
  });
}

test('recorded Git collector reconstructs immutable fields and rejects dirty snapshots', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quantpass-dashboard-recorded-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'master']);
  await writeFile(join(root, 'README.md'), 'base\n');
  git(root, ['add', 'README.md']);
  git(root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'commit',
    '-m',
    'base',
  ]);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);

  const reconstructed = await collectRecordedGitState(root, 'master', {
    status: 'READY',
    source: '.git',
    observedAt,
    branch: 'master',
    commit,
    tree,
    dirtyFiles: 0,
    aheadBehind: { ahead: 999, behind: 999 },
    recentCommits: [{ hash: 'tampered' }],
  });
  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.tree, tree);
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 0, behind: 0 });
  assert.equal(reconstructed.recentCommits[0].hash, commit);

  const dirty = await collectRecordedGitState(root, 'master', {
    ...reconstructed,
    dirtyFiles: 1,
  });
  assert.equal(dirty.status, 'DATA_SOURCE_ERROR');
  assert.equal(dirty.error, 'RECORDED_GIT_NOT_CLEAN');
});

test('recorded Git collector verifies that the current checkout is clean', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  await writeFile(join(fixture.root, 'recorded.txt'), 'visible working-tree change\n');

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );
  assert.equal(reconstructed.status, 'DATA_SOURCE_ERROR');
  assert.equal(reconstructed.error, 'RECORDED_GIT_NOT_CLEAN');
});

test('recorded Git collector rejects a malicious fsmonitor hook', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  await configureMaliciousFsMonitor(fixture.root);
  await writeFile(join(fixture.root, 'recorded.txt'), 'dirty file hidden by fsmonitor\n');

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );

  assert.equal(reconstructed.status, 'DATA_SOURCE_ERROR');
  assert.equal(reconstructed.error, 'RECORDED_GIT_NOT_CLEAN');
});

for (const [name, flag] of [
  ['assume-unchanged', '--assume-unchanged'],
  ['skip-worktree', '--skip-worktree'],
]) {
  test(`recorded Git collector rejects a tracked ${name} entry`, async (t) => {
    const fixture = await createRecordedGitFixture(t);
    git(fixture.root, ['update-index', flag, 'recorded.txt']);
    await writeFile(join(fixture.root, 'recorded.txt'), 'hidden working-tree change\n');
    assert.equal(git(fixture.root, ['status', '--porcelain=v1']), '');

    const reconstructed = await collectRecordedGitState(
      fixture.root,
      'master',
      recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
      { observedAt, environment: {} },
    );
    assert.equal(reconstructed.status, 'DATA_SOURCE_ERROR');
    assert.equal(reconstructed.error, 'RECORDED_GIT_INDEX_FLAGS_UNSAFE');
  });
}

test('recorded Git collector validates a normal local named-branch checkout', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );

  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.branch, 'macbeth/dashboard');
  assert.equal(reconstructed.commit, fixture.recordedCommit);
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 1, behind: 0 });
  assert.equal(reconstructed.recentCommits[0].hash, fixture.recordedCommit);
  assert.notEqual(reconstructed.recentCommits[0].hash, fixture.headCommit);
});

test('Git collectors reject a named source branch with no common base history', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  const sourceTree = git(fixture.root, ['rev-parse', 'HEAD^{tree}']);
  const unrelatedBase = git(fixture.root, [
    '-c',
    'user.name=Macbeth',
    '-c',
    'user.email=pdbsy@users.noreply.github.com',
    'commit-tree',
    sourceTree,
    '-m',
    'unrelated base',
  ]);
  git(fixture.root, ['update-ref', 'refs/heads/master', unrelatedBase]);

  const current = await collectGitState(fixture.root, 'master');
  assert.equal(current.status, 'DATA_SOURCE_ERROR');
  assert.equal(current.error, 'GIT_QUERY_FAILED');

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );
  assert.equal(reconstructed.status, 'DATA_SOURCE_ERROR');
  assert.equal(reconstructed.error, 'RECORDED_GIT_GRAPH_MISMATCH');
});

test('Git collectors accept diverged source and base tips that retain a common ancestor', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  git(fixture.root, ['update-ref', 'refs/heads/master', fixture.forgedCommit]);

  const current = await collectGitState(fixture.root, 'master');
  assert.equal(current.status, 'READY');
  assert.deepEqual(current.aheadBehind, { ahead: 2, behind: 1 });

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );
  assert.equal(reconstructed.status, 'READY');
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 1, behind: 1 });
});

test('recorded Git collector rejects descendant runtime, test, workflow, and package changes', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  await Promise.all([
    mkdir(join(fixture.root, 'src'), { recursive: true }),
    mkdir(join(fixture.root, 'test'), { recursive: true }),
    mkdir(join(fixture.root, '.github/workflows'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(fixture.root, 'src/runtime.ts'), 'export const changed = true;\n'),
    writeFile(join(fixture.root, 'test/runtime.test.ts'), 'export {};\n'),
    writeFile(join(fixture.root, '.github/workflows/ci.yml'), 'name: changed\n'),
    writeFile(join(fixture.root, 'package.json'), '{"name":"changed"}\n'),
  ]);
  git(fixture.root, ['add', 'src', 'test', '.github', 'package.json']);
  commit(fixture.root, 'unrelated descendant changes');

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );

  assert.equal(reconstructed.status, 'DATA_SOURCE_ERROR');
  assert.equal(reconstructed.error, 'RECORDED_GIT_DESCENDANT_PATH_MISMATCH');
});

test('recorded Git collector rejects a forbidden intermediate change even when later reverted', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  await mkdir(join(fixture.root, 'src'), { recursive: true });
  await writeFile(join(fixture.root, 'src/transient-runtime.ts'), 'export const leaked = true;\n');
  git(fixture.root, ['add', 'src/transient-runtime.ts']);
  commit(fixture.root, 'transient forbidden change');
  git(fixture.root, ['rm', 'src/transient-runtime.ts']);
  commit(fixture.root, 'revert transient forbidden change');

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );

  assert.equal(reconstructed.status, 'DATA_SOURCE_ERROR');
  assert.equal(reconstructed.error, 'RECORDED_GIT_DESCENDANT_PATH_MISMATCH');
});

test('recorded Git collector validates a GitHub push checkout with only origin/master', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  git(fixture.root, ['update-ref', 'refs/remotes/origin/master', fixture.baseCommit]);
  git(fixture.root, ['branch', '-D', 'master']);
  assert.throws(() => git(fixture.root, ['show-ref', '--verify', '--quiet', 'refs/heads/master']));

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: pushEnvironment(fixture.headCommit) },
  );

  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.branch, 'macbeth/dashboard');
  assert.equal(reconstructed.commit, fixture.recordedCommit);
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 1, behind: 0 });
  assert.equal(reconstructed.recentCommits[0].hash, fixture.recordedCommit);
});

test('recorded Git collector validates an equivalent linear-history integration push', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  const integratedCommit = createIntegratedPushLayout(fixture);

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: integratedPushEnvironment(integratedCommit) },
  );

  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.branch, 'macbeth/dashboard');
  assert.equal(reconstructed.commit, fixture.recordedCommit);
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 1, behind: 0 });

  await writeFile(join(fixture.root, 'forged-after-merge.txt'), 'forged\n');
  git(fixture.root, ['add', 'forged-after-merge.txt']);
  commit(fixture.root, 'forged integrated tree');
  const forgedHead = git(fixture.root, ['rev-parse', 'HEAD']);
  git(fixture.root, ['update-ref', 'refs/remotes/origin/master', forgedHead]);
  const forged = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: integratedPushEnvironment(forgedHead) },
  );
  assert.equal(forged.status, 'DATA_SOURCE_ERROR');
  assert.equal(forged.error, 'RECORDED_GIT_GRAPH_MISMATCH');
});

test('recorded Git collector validates an equivalent local master integration', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  createIntegratedPushLayout(fixture);

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );

  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.branch, 'macbeth/dashboard');
  assert.equal(reconstructed.commit, fixture.recordedCommit);
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 1, behind: 0 });

  await writeFile(join(fixture.root, 'forged-local-integration.txt'), 'forged\n');
  git(fixture.root, ['add', 'forged-local-integration.txt']);
  commit(fixture.root, 'forged local integrated tree');
  const forged = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: {} },
  );
  assert.equal(forged.status, 'DATA_SOURCE_ERROR');
  assert.equal(forged.error, 'RECORDED_GIT_GRAPH_MISMATCH');
});

test('recorded Git collector validates a GitHub workflow dispatch on the recorded branch', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  git(fixture.root, ['update-ref', 'refs/remotes/origin/master', fixture.baseCommit]);
  git(fixture.root, ['branch', '-D', 'master']);

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: workflowDispatchEnvironment(fixture.headCommit) },
  );

  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.branch, 'macbeth/dashboard');
  assert.equal(reconstructed.commit, fixture.recordedCommit);
});

test('recorded Git collector validates the logical head of a detached GitHub pull request', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  const mergeCommit = createPullRequestLayout(fixture);

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: pullRequestEnvironment(mergeCommit) },
  );

  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.branch, 'macbeth/dashboard');
  assert.equal(reconstructed.commit, fixture.recordedCommit);
  assert.notEqual(reconstructed.commit, mergeCommit);
  assert.deepEqual(reconstructed.aheadBehind, { ahead: 1, behind: 0 });
  assert.equal(reconstructed.recentCommits[0].hash, fixture.recordedCommit);
});

test('recorded Git collector validates a detached GitHub merge-group checkout by graph', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  const { mergeCommit, queueBranch } = createMergeGroupLayout(fixture);
  const environment = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'merge_group',
    GITHUB_REF: `refs/heads/${queueBranch}`,
    GITHUB_SHA: mergeCommit,
  };

  const reconstructed = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment },
  );
  assert.equal(reconstructed.status, 'READY');
  assert.equal(reconstructed.commit, fixture.recordedCommit);

  git(fixture.root, ['update-ref', 'refs/remotes/origin/macbeth/dashboard', fixture.forgedCommit]);
  const forgedSource = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment },
  );
  assert.equal(forgedSource.status, 'DATA_SOURCE_ERROR');
});

test('recorded Git collector rejects forged pull-request branch and commit identity', async (t) => {
  const fixture = await createRecordedGitFixture(t);
  const mergeCommit = createPullRequestLayout(fixture);
  const recorded = recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.recordedTree);

  const forgedEnvironmentBranch = await collectRecordedGitState(fixture.root, 'master', recorded, {
    observedAt,
    environment: {
      ...pullRequestEnvironment(mergeCommit),
      GITHUB_HEAD_REF: 'attacker/dashboard',
    },
  });
  assert.equal(forgedEnvironmentBranch.status, 'DATA_SOURCE_ERROR');

  const forgedRecordedBranch = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('attacker/dashboard', fixture.recordedCommit, fixture.recordedTree),
    { observedAt, environment: pullRequestEnvironment(mergeCommit) },
  );
  assert.equal(forgedRecordedBranch.status, 'DATA_SOURCE_ERROR');

  const forgedCheckoutSha = await collectRecordedGitState(fixture.root, 'master', recorded, {
    observedAt,
    environment: {
      ...pullRequestEnvironment(mergeCommit),
      GITHUB_SHA: fixture.headCommit,
    },
  });
  assert.equal(forgedCheckoutSha.status, 'DATA_SOURCE_ERROR');

  const partialContext = await collectRecordedGitState(fixture.root, 'master', recorded, {
    observedAt,
    environment: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request' },
  });
  assert.equal(partialContext.status, 'DATA_SOURCE_ERROR');

  git(fixture.root, ['update-ref', 'refs/remotes/origin/master', fixture.forgedCommit]);
  const forgedBase = await collectRecordedGitState(fixture.root, 'master', recorded, {
    observedAt,
    environment: pullRequestEnvironment(mergeCommit),
  });
  assert.equal(forgedBase.status, 'DATA_SOURCE_ERROR');
  git(fixture.root, ['update-ref', 'refs/remotes/origin/master', fixture.baseCommit]);

  git(fixture.root, ['update-ref', 'refs/remotes/origin/macbeth/dashboard', fixture.recordedCommit]);
  const forgedRemoteBranch = await collectRecordedGitState(fixture.root, 'master', recorded, {
    observedAt,
    environment: pullRequestEnvironment(mergeCommit),
  });
  assert.equal(forgedRemoteBranch.status, 'DATA_SOURCE_ERROR');
  git(fixture.root, ['update-ref', 'refs/remotes/origin/macbeth/dashboard', fixture.headCommit]);

  const forgedRecordedCommit = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.forgedCommit, fixture.forgedTree),
    { observedAt, environment: pullRequestEnvironment(mergeCommit) },
  );
  assert.equal(forgedRecordedCommit.status, 'DATA_SOURCE_ERROR');

  const forgedRecordedTree = await collectRecordedGitState(
    fixture.root,
    'master',
    recordedGit('macbeth/dashboard', fixture.recordedCommit, fixture.forgedTree),
    { observedAt, environment: pullRequestEnvironment(mergeCommit) },
  );
  assert.equal(forgedRecordedTree.status, 'DATA_SOURCE_ERROR');
  assert.equal(forgedRecordedTree.error, 'RECORDED_GIT_TREE_MISMATCH');
});

test('Git collector rejects hostile base refs before invoking Git revision parsing', async () => {
  await assert.rejects(() => collectGitState(process.cwd(), '--help'), /invalid base ref/i);
  await assert.rejects(() => collectGitState(process.cwd(), 'master..attacker'), /invalid base ref/i);
});
