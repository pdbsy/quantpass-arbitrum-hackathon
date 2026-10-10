import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { main as checkDashboard } from '../tools/build-management-dashboard.mjs';
import { collectRecordedGitState } from '../tools/management-dashboard/sources.mjs';
import { PRESERVED_MANAGEMENT_SNAPSHOT } from '../tools/management-dashboard/preserved-context.mjs';
import { FAIR_LAUNCH_IMPORT } from '../tools/preserved-source-identity.mjs';
import { CANONICAL_REPOSITORY, CANONICAL_REPOSITORY_ID } from '../tools/environment/policy.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const git = (root, args, options = {}) =>
  fixtureExec('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trimEnd();
const recordPaths = [
  '.checks/management/latest.json',
  'docs/management/dashboard/data/dashboard.json',
  'docs/management/dashboard/data/build-log.json',
];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'alphaforge-preserved-dashboard-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const root = join(directory, 'repository');
  await mkdir(root);
  git(root, ['init', '--quiet', '-b', 'master']);
  // Fetch actual immutable source objects, rather than inventing an equivalent
  // history or overriding the production import profile in a test.
  git(root, ['fetch', '--quiet', sourceRoot, FAIR_LAUNCH_IMPORT.source]);
  git(root, ['reset', '--hard', '--quiet', 'FETCH_HEAD']);
  git(root, ['switch', '--quiet', '-c', FAIR_LAUNCH_IMPORT.branch]);
  git(root, ['branch', '-f', 'master', FAIR_LAUNCH_IMPORT.base]);
  git(root, ['update-ref', 'refs/remotes/origin/master', FAIR_LAUNCH_IMPORT.base]);
  await writeFile(join(root, 'current-source.txt'), 'ordinary source follow-up\n');
  git(root, ['add', 'current-source.txt']);
  git(root, ['commit', '--quiet', '-m', 'Verify preserved management evidence in current CI']);
  const head = git(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, head]);
  const snapshot = JSON.parse(await readFile(join(root, recordPaths[1]), 'utf8'));
  const eventPath = join(directory, 'event.json');
  const event = {
    ref: `refs/heads/${FAIR_LAUNCH_IMPORT.branch}`,
    after: head,
    repository: { full_name: FAIR_LAUNCH_IMPORT.repository },
  };
  const environment = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: event.ref,
    GITHUB_REPOSITORY: FAIR_LAUNCH_IMPORT.repository,
    GITHUB_SHA: head,
    GITHUB_EVENT_PATH: eventPath,
  };
  await writeFile(eventPath, JSON.stringify(event));
  return { root, head, eventPath, event, environment, recorded: snapshot.git };
}

async function pullLayout(f, parent = FAIR_LAUNCH_IMPORT.base, tree) {
  const sourceTree = git(f.root, ['rev-parse', `${f.head}^{tree}`]);
  const merge = git(f.root, [
    'commit-tree',
    tree ?? sourceTree,
    '-p',
    parent,
    '-p',
    f.head,
    '-m',
    'Canonical PR merge fixture',
  ]);
  git(f.root, ['update-ref', 'refs/remotes/pull/47/merge', merge]);
  git(f.root, ['checkout', '--quiet', '--detach', merge]);
  f.event = {
    repository: { full_name: FAIR_LAUNCH_IMPORT.repository },
    number: 47,
    pull_request: {
      title: 'AlphaForge Fair Launch on-chain test market',
      head: {
        ref: FAIR_LAUNCH_IMPORT.branch,
        sha: f.head,
        repo: { full_name: FAIR_LAUNCH_IMPORT.repository },
      },
      base: {
        ref: 'master',
        sha: FAIR_LAUNCH_IMPORT.base,
        repo: { full_name: FAIR_LAUNCH_IMPORT.repository },
      },
    },
  };
  f.environment = {
    ...f.environment,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/47/merge',
    GITHUB_SHA: merge,
    GITHUB_HEAD_REF: FAIR_LAUNCH_IMPORT.branch,
    GITHUB_BASE_REF: 'master',
  };
  await writeFile(f.eventPath, JSON.stringify(f.event));
}

const collect = (f, environment = f.environment, recorded = f.recorded) =>
  collectRecordedGitState(f.root, 'master', recorded, { environment });
async function rejects(f, error, environment, recorded) {
  const result = await collect(f, environment, recorded);
  assert.equal(result.status, 'DATA_SOURCE_ERROR');
  assert.equal(result.error, error);
  assert.equal(result.commit, undefined);
}

test('exact Fair Launch push and dispatch retain original dashboard evidence without rewriting it', async (t) => {
  const f = await fixture(t);
  const original = await Promise.all(recordPaths.map((path) => readFile(join(f.root, path))));
  assert.deepEqual(await collect(f), f.recorded);
  const snapshot = await checkDashboard(['--check'], { root: f.root, environment: f.environment });
  assert.equal(snapshot.git.commit, PRESERVED_MANAGEMENT_SNAPSHOT.commit);
  assert.notEqual(snapshot.git.commit, f.head);
  assert.deepEqual(await Promise.all(recordPaths.map((path) => readFile(join(f.root, path)))), original);
  const event = { ...f.event, ref: FAIR_LAUNCH_IMPORT.branch };
  await writeFile(f.eventPath, JSON.stringify(event));
  assert.deepEqual(
    await collect(f, { ...f.environment, GITHUB_EVENT_NAME: 'workflow_dispatch' }),
    f.recorded,
  );
});

test('canonical Fair Launch PR verifies current merge graph and frozen historical dashboard', async (t) => {
  const f = await fixture(t);
  await pullLayout(f);
  assert.deepEqual(await collect(f), f.recorded);
  const snapshot = await checkDashboard(['--check'], { root: f.root, environment: f.environment });
  assert.equal(snapshot.git.branch, PRESERVED_MANAGEMENT_SNAPSHOT.branch);
  assert.equal(snapshot.git.tree, PRESERVED_MANAGEMENT_SNAPSHOT.tree);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID', { ...f.environment, GITHUB_SHA: f.head });
  git(f.root, ['update-ref', '-d', 'refs/remotes/pull/47/merge']);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
});

test('renamed Fair Launch push and PR preserve evidence only for the exact repository identity', async (t) => {
  const f = await fixture(t);
  f.environment.GITHUB_REPOSITORY = CANONICAL_REPOSITORY;
  f.environment.GITHUB_REPOSITORY_ID = String(CANONICAL_REPOSITORY_ID);
  f.event.repository = { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.deepEqual(await collect(f), f.recorded);
  await rejects(f, 'RECORDED_GIT_CI_CONTEXT_INVALID', {
    ...f.environment,
    GITHUB_REPOSITORY_ID: String(CANONICAL_REPOSITORY_ID + 1),
  });
  await pullLayout(f);
  f.environment.GITHUB_REPOSITORY = CANONICAL_REPOSITORY;
  f.environment.GITHUB_REPOSITORY_ID = String(CANONICAL_REPOSITORY_ID);
  f.event.repository = { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID };
  for (const side of ['head', 'base'])
    f.event.pull_request[side].repo = { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.deepEqual(await collect(f), f.recorded);
  for (const mutation of [
    (event) => (event.repository.id = CANONICAL_REPOSITORY_ID + 1),
    (event) => (event.repository.full_name = 'other/Alphaforge'),
    (event) => (event.pull_request.head.repo.full_name = 'pdbsy/other'),
    (event) => (event.pull_request.base.repo.full_name = FAIR_LAUNCH_IMPORT.repository),
    (event) => (event.pull_request.head.repo.id = CANONICAL_REPOSITORY_ID + 1),
  ]) {
    const event = structuredClone(f.event);
    mutation(event);
    await writeFile(f.eventPath, JSON.stringify(event));
    const result = await collect(f);
    assert.equal(result.status, 'DATA_SOURCE_ERROR');
    assert.equal(result.commit, undefined);
  }
});

test('preserved dashboard context rejects forks and altered event, base, source, and record identity', async (t) => {
  const f = await fixture(t);
  await pullLayout(f);
  for (const mutation of [
    (event) => {
      event.repository.full_name = 'foreign/repository';
    },
    (event) => {
      event.number = 48;
    },
    (event) => {
      event.pull_request.head.repo.full_name = 'foreign/repository';
    },
    (event) => {
      event.pull_request.base.sha = FAIR_LAUNCH_IMPORT.source;
    },
    (event) => {
      event.pull_request.head.sha = FAIR_LAUNCH_IMPORT.source;
    },
  ]) {
    const event = structuredClone(f.event);
    mutation(event);
    await writeFile(f.eventPath, JSON.stringify(event));
    const result = await collect(f);
    assert.equal(result.status, 'DATA_SOURCE_ERROR');
    assert.equal(result.commit, undefined);
  }
  await writeFile(f.eventPath, JSON.stringify(f.event));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID', f.environment, {
    ...f.recorded,
    tree: FAIR_LAUNCH_IMPORT.base,
  });
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, FAIR_LAUNCH_IMPORT.source]);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, f.head]);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', FAIR_LAUNCH_IMPORT.source]);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
});

test('preserved dashboard PR rejects different merge parents or merge tree', async (t) => {
  const f = await fixture(t);
  await pullLayout(f, FAIR_LAUNCH_IMPORT.source);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  await pullLayout(
    f,
    FAIR_LAUNCH_IMPORT.base,
    git(f.root, ['rev-parse', `${FAIR_LAUNCH_IMPORT.base}^{tree}`]),
  );
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
});

test('each preserved historical record rejects a committed byte change in an otherwise valid follow-up', async (t) => {
  const f = await fixture(t);
  for (const path of recordPaths) {
    git(f.root, ['reset', '--hard', '--quiet', f.head]);
    await writeFile(
      join(f.root, path),
      Buffer.concat([await readFile(join(f.root, path)), Buffer.from('\n')]),
    );
    git(f.root, ['add', path]);
    git(f.root, ['commit', '--quiet', '-m', 'Modify historical record fixture']);
    const head = git(f.root, ['rev-parse', 'HEAD']);
    git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, head]);
    await writeFile(f.eventPath, JSON.stringify({ ...f.event, after: head }));
    await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID', { ...f.environment, GITHUB_SHA: head });
  }
});

test('preserved context still rejects dirty indexes, omitted source ancestry, and new worker trailers', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'current-source.txt'), 'dirty source\n');
  await rejects(f, 'RECORDED_GIT_NOT_CLEAN');
  git(f.root, ['reset', '--hard', '--quiet', f.head]);
  git(f.root, ['update-index', '--assume-unchanged', 'current-source.txt']);
  await rejects(f, 'RECORDED_GIT_INDEX_FLAGS_UNSAFE');
  git(f.root, ['update-index', '--no-assume-unchanged', 'current-source.txt']);
  git(f.root, ['commit', '--quiet', '--allow-empty', '-m', 'New task change\n\nAgent-ID: Macbeth01']);
  const labelled = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, labelled]);
  await writeFile(f.eventPath, JSON.stringify({ ...f.event, after: labelled }));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID', { ...f.environment, GITHUB_SHA: labelled });
  git(f.root, ['reset', '--hard', '--quiet', FAIR_LAUNCH_IMPORT.base]);
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, FAIR_LAUNCH_IMPORT.base]);
  await writeFile(f.eventPath, JSON.stringify({ ...f.event, after: FAIR_LAUNCH_IMPORT.base }));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID', {
    ...f.environment,
    GITHUB_SHA: FAIR_LAUNCH_IMPORT.base,
  });
});

test('historical preservation does not authorize third branches, missing events, or merge queues', async (t) => {
  const f = await fixture(t);
  await rejects(f, 'RECORDED_GIT_CI_CONTEXT_INVALID', {
    ...f.environment,
    GITHUB_REF: 'refs/heads/codex/unrelated',
  });
  await writeFile(f.eventPath, '{');
  await rejects(f, 'RECORDED_GIT_CI_CONTEXT_INVALID');
  await writeFile(f.eventPath, JSON.stringify(f.event));
  const eventLink = f.eventPath + '.link';
  try {
    await symlink(f.eventPath, eventLink, 'file');
    await rejects(f, 'RECORDED_GIT_CI_CONTEXT_INVALID', { ...f.environment, GITHUB_EVENT_PATH: eventLink });
  } catch (error) {
    // Native Windows runners may not grant file-symlink creation privileges.
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.diagnostic('Symlink creation unavailable; regular-file identity assertions remain active');
  }
  await rejects(f, 'RECORDED_GIT_CI_CONTEXT_INVALID', {
    ...f.environment,
    GITHUB_EVENT_NAME: 'merge_group',
    GITHUB_REF: 'refs/heads/gh-readonly-queue/master/task',
    GITHUB_BASE_REF: 'master',
    GITHUB_HEAD_REF: FAIR_LAUNCH_IMPORT.branch,
  });
});
