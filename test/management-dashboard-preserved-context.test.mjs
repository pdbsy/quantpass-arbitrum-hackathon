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
import { MANAGER_INTEGRATIONS } from '../tools/agent-identity.mjs';
import { validateCommitSetIdentity } from '../tools/agent-identity-set.mjs';

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

async function masterLayout(f, parent = FAIR_LAUNCH_IMPORT.base, tree) {
  const head = git(f.root, [
    'commit-tree',
    tree ?? git(f.root, ['rev-parse', `${f.head}^{tree}`]),
    '-p',
    parent,
    '-m',
    'Merge reviewed Fair Launch import using linear history',
  ]);
  git(f.root, ['checkout', '--quiet', '-B', 'master', head]);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', head]);
  f.event = {
    ref: 'refs/heads/master',
    before: FAIR_LAUNCH_IMPORT.base,
    after: head,
    repository: { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID },
  };
  f.environment = {
    ...f.environment,
    GITHUB_REF: f.event.ref,
    GITHUB_REPOSITORY: CANONICAL_REPOSITORY,
    GITHUB_REPOSITORY_ID: String(CANONICAL_REPOSITORY_ID),
    GITHUB_SHA: head,
  };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  return head;
}

async function integratedFixture(t) {
  const f = await fixture(t);
  const anchor = FAIR_LAUNCH_IMPORT.integration;
  git(f.root, ['fetch', '--quiet', sourceRoot, anchor.commit, anchor.sourceHead]);
  f.sourceBranch = 'codex/ordinary-followup-fixture';
  git(f.root, ['checkout', '--quiet', '-b', f.sourceBranch, anchor.commit]);
  git(f.root, ['branch', '-f', 'master', anchor.commit]);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', anchor.commit]);
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, anchor.sourceHead]);
  await writeFile(join(f.root, 'ordinary-followup.txt'), 'ordinary work after the immutable integration\n');
  git(f.root, ['add', 'ordinary-followup.txt']);
  git(f.root, ['commit', '--quiet', '-m', 'Ordinary follow-up after Fair Launch integration']);
  f.head = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', `refs/remotes/origin/${f.sourceBranch}`, f.head]);
  f.event = {
    ref: `refs/heads/${f.sourceBranch}`,
    before: '0'.repeat(40),
    after: f.head,
    repository: { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID },
  };
  f.environment = {
    ...f.environment,
    GITHUB_REPOSITORY: CANONICAL_REPOSITORY,
    GITHUB_REPOSITORY_ID: String(CANONICAL_REPOSITORY_ID),
    GITHUB_REF: f.event.ref,
    GITHUB_SHA: f.head,
    GITHUB_HEAD_REF: '',
    GITHUB_BASE_REF: '',
  };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  return f;
}

async function integratedPull(f, parent = FAIR_LAUNCH_IMPORT.integration.commit, tree) {
  const merge = git(f.root, [
    'commit-tree',
    tree ?? git(f.root, ['rev-parse', `${f.head}^{tree}`]),
    '-p',
    parent,
    '-p',
    f.head,
    '-m',
    'Ordinary follow-up PR merge fixture',
  ]);
  git(f.root, ['update-ref', 'refs/remotes/pull/48/merge', merge]);
  git(f.root, ['checkout', '--quiet', '--detach', merge]);
  f.event = {
    repository: { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID },
    number: 48,
    pull_request: {
      title: 'Ordinary Fair Launch follow-up',
      head: {
        ref: f.sourceBranch,
        sha: f.head,
        repo: { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID },
      },
      base: {
        ref: 'master',
        sha: FAIR_LAUNCH_IMPORT.integration.commit,
        repo: { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID },
      },
    },
  };
  f.environment = {
    ...f.environment,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/48/merge',
    GITHUB_SHA: merge,
    GITHUB_HEAD_REF: f.sourceBranch,
    GITHUB_BASE_REF: 'master',
  };
  await writeFile(f.eventPath, JSON.stringify(f.event));
}

async function integratedMaster(f) {
  const master = git(f.root, [
    'commit-tree',
    git(f.root, ['rev-parse', `${f.head}^{tree}`]),
    '-p',
    FAIR_LAUNCH_IMPORT.integration.commit,
    '-m',
    'Merge ordinary follow-up using linear history',
  ]);
  git(f.root, ['checkout', '--quiet', '-B', 'master', master]);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', master]);
  f.event = {
    ref: 'refs/heads/master',
    before: FAIR_LAUNCH_IMPORT.integration.commit,
    after: master,
    repository: { full_name: CANONICAL_REPOSITORY, id: CANONICAL_REPOSITORY_ID },
  };
  f.environment = {
    ...f.environment,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: f.event.ref,
    GITHUB_SHA: master,
    GITHUB_HEAD_REF: '',
    GITHUB_BASE_REF: '',
  };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  return master;
}

function checkIdentity(f, extra = {}) {
  return fixtureExec(process.execPath, [join(sourceRoot, 'tools/check-agent-identity.mjs')], {
    cwd: f.root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...f.environment,
      GIT_DIR: join(f.root, '.git'),
      GIT_WORK_TREE: f.root,
      ...extra,
    },
  });
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

test('actual first master push verifies all original objects and preserves historical report bytes', async (t) => {
  const f = await fixture(t);
  const original = await Promise.all(recordPaths.map((path) => readFile(join(f.root, path))));
  const master = await masterLayout(f);
  assert.match(checkIdentity(f), /Preserved master identity: 71 original commits retained/);
  assert.deepEqual(await collect(f), f.recorded);
  const snapshot = await checkDashboard(['--check'], { root: f.root, environment: f.environment });
  assert.equal(snapshot.git.commit, PRESERVED_MANAGEMENT_SNAPSHOT.commit);
  assert.notEqual(snapshot.git.commit, master);
  assert.deepEqual(await Promise.all(recordPaths.map((path) => readFile(join(f.root, path)))), original);
  f.environment.GITHUB_EVENT_NAME = 'workflow_dispatch';
  f.event.ref = 'master';
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.match(checkIdentity(f), /exact first squash verified/);
  assert.deepEqual(await collect(f), f.recorded);
});

test('ordinary source pushes and dispatch after the exact integration preserve only historical evidence', async (t) => {
  const f = await integratedFixture(t);
  assert.match(checkIdentity(f), /Integration anchor .* ordinary push identity: 0 worker provenance/);
  assert.deepEqual(await collect(f), f.recorded);
  const first = f.head;
  await writeFile(join(f.root, 'ordinary-followup.txt'), 'second ordinary source change\n');
  git(f.root, ['add', 'ordinary-followup.txt']);
  git(f.root, ['commit', '--quiet', '-m', 'Continue the ordinary source branch']);
  f.head = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', `refs/remotes/origin/${f.sourceBranch}`, f.head]);
  f.event = { ...f.event, before: first, after: f.head };
  f.environment.GITHUB_SHA = f.head;
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.match(checkIdentity(f), /ordinary push identity: 0 worker provenance/);
  assert.deepEqual(await collect(f), f.recorded);
  f.event.ref = f.sourceBranch;
  f.environment.GITHUB_EVENT_NAME = 'workflow_dispatch';
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.match(checkIdentity(f), /ordinary workflow_dispatch identity/);
  assert.deepEqual(await collect(f), f.recorded);
});

test('ordinary follow-up PR and actual master push retain the exact original snapshot', async (t) => {
  const f = await integratedFixture(t);
  const original = await Promise.all(recordPaths.map((path) => readFile(join(f.root, path))));
  await integratedPull(f);
  assert.match(checkIdentity(f), /ordinary pull_request identity: 0 worker provenance/);
  assert.deepEqual(await collect(f), f.recorded);
  await checkDashboard(['--check'], { root: f.root, environment: f.environment });
  const master = await integratedMaster(f);
  assert.match(checkIdentity(f), /ordinary push identity: 0 worker provenance/);
  assert.deepEqual(await collect(f), f.recorded);
  await checkDashboard(['--check'], { root: f.root, environment: f.environment });
  assert.notEqual(master, PRESERVED_MANAGEMENT_SNAPSHOT.commit);
  assert.deepEqual(await Promise.all(recordPaths.map((path) => readFile(join(f.root, path)))), original);
  for (const mutation of [
    (event) => (event.before = FAIR_LAUNCH_IMPORT.base),
    (event) => {
      event.before = FAIR_LAUNCH_IMPORT.source;
      event.after = f.head;
      event.ref = `refs/heads/${f.sourceBranch}`;
    },
  ]) {
    const changed = structuredClone(f.event);
    mutation(changed);
    await writeFile(f.eventPath, JSON.stringify(changed));
    assert.throws(() => checkIdentity(f));
    assert.equal((await collect(f)).status, 'DATA_SOURCE_ERROR');
  }
  await writeFile(f.eventPath, JSON.stringify(f.event));
  f.event.ref = 'master';
  f.environment.GITHUB_EVENT_NAME = 'workflow_dispatch';
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.match(checkIdentity(f), /ordinary workflow_dispatch identity/);
  assert.deepEqual(await collect(f), f.recorded);
});

test('post-integration master push validates every ordinary linear commit in a rebase range', async (t) => {
  const f = await integratedFixture(t);
  git(f.root, ['checkout', '--quiet', '-B', 'master', f.head]);
  git(f.root, ['commit', '--quiet', '--allow-empty', '-m', 'Second linear ordinary master commit']);
  const head = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', head]);
  f.event = {
    ...f.event,
    ref: 'refs/heads/master',
    before: FAIR_LAUNCH_IMPORT.integration.commit,
    after: head,
  };
  f.environment = { ...f.environment, GITHUB_REF: f.event.ref, GITHUB_SHA: head };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.match(checkIdentity(f), /ordinary push identity: 0 worker provenance/);
  assert.deepEqual(await collect(f), f.recorded);
});

test('post-integration PR rejects foreign identity, altered refs, parents, and frozen source', async (t) => {
  const f = await integratedFixture(t);
  await integratedPull(f);
  for (const mutation of [
    (event) => (event.pull_request.head.repo.full_name = 'foreign/Alphaforge'),
    (event) => (event.pull_request.base.repo.id = CANONICAL_REPOSITORY_ID + 1),
    (event) => (event.pull_request.head.ref = FAIR_LAUNCH_IMPORT.branch),
    (event) => (event.pull_request.base.sha = FAIR_LAUNCH_IMPORT.base),
    (event) => (event.pull_request.head.sha = FAIR_LAUNCH_IMPORT.integration.commit),
  ]) {
    const changed = structuredClone(f.event);
    mutation(changed);
    await writeFile(f.eventPath, JSON.stringify(changed));
    assert.throws(() => checkIdentity(f));
    assert.equal((await collect(f)).status, 'DATA_SOURCE_ERROR');
  }
  await writeFile(f.eventPath, JSON.stringify(f.event));
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, FAIR_LAUNCH_IMPORT.source]);
  assert.throws(() => checkIdentity(f));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  git(f.root, [
    'update-ref',
    `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`,
    FAIR_LAUNCH_IMPORT.integration.sourceHead,
  ]);
  await integratedPull(f, FAIR_LAUNCH_IMPORT.base);
  assert.throws(() => checkIdentity(f));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
});

test('post-integration work cannot alter frozen reports or introduce unattributed worker claims', async (t) => {
  const f = await integratedFixture(t);
  const source = f.head;
  await writeFile(
    join(f.root, recordPaths[0]),
    Buffer.concat([await readFile(join(f.root, recordPaths[0])), Buffer.from('\n')]),
  );
  git(f.root, ['add', recordPaths[0]]);
  git(f.root, ['commit', '--quiet', '-m', 'Alter immutable historical report fixture']);
  f.head = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', `refs/remotes/origin/${f.sourceBranch}`, f.head]);
  await integratedPull(f);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  git(f.root, ['checkout', '--quiet', f.sourceBranch]);
  git(f.root, ['reset', '--hard', '--quiet', source]);
  git(f.root, ['commit', '--quiet', '--allow-empty', '-m', '[Macbeth01] Unattributed new source work']);
  f.head = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', `refs/remotes/origin/${f.sourceBranch}`, f.head]);
  await integratedPull(f);
  assert.throws(() => checkIdentity(f));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
});

test('anchored follow-up evidence cannot bypass registered manager integration admission', async (t) => {
  const f = await integratedFixture(t);
  const manager = MANAGER_INTEGRATIONS[0];
  git(f.root, ['checkout', '--quiet', '-b', manager.branch, FAIR_LAUNCH_IMPORT.integration.commit]);
  const subject = `[Macbeth01][${manager.task}] Ordinary manager-looking fixture`;
  const body = `Agent-ID: Macbeth01\nTask-ID: ${manager.task}`;
  git(f.root, ['commit', '--quiet', '--allow-empty', '-m', subject, '-m', body]);
  const head = git(f.root, ['rev-parse', 'HEAD']);
  assert.equal(
    validateCommitSetIdentity({ branch: manager.branch, commits: [{ subject, body }] }).verified,
    1,
  );
  git(f.root, ['update-ref', `refs/remotes/origin/${manager.branch}`, head]);
  f.event = { ...f.event, ref: `refs/heads/${manager.branch}`, after: head };
  f.environment = { ...f.environment, GITHUB_REF: f.event.ref, GITHUB_SHA: head };
  await writeFile(f.eventPath, JSON.stringify(f.event));
  assert.throws(() => checkIdentity(f));
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
});

test('master admission rejects mismatched hosted identity, event head, and original base', async (t) => {
  const f = await fixture(t);
  await masterLayout(f);
  for (const mutation of [
    (event) => (event.repository.full_name = 'other/Alphaforge'),
    (event) => (event.repository.id = CANONICAL_REPOSITORY_ID + 1),
    (event) => (event.ref = `refs/heads/${FAIR_LAUNCH_IMPORT.branch}`),
    (event) => (event.after = f.head),
    (event) => (event.before = FAIR_LAUNCH_IMPORT.source),
    (event) => {
      event.before = FAIR_LAUNCH_IMPORT.source;
      event.after = f.head;
    },
    (event) => {
      event.ref = 'refs/heads/feature/ordinary';
      event.before = FAIR_LAUNCH_IMPORT.source;
      event.after = f.head;
    },
    (event) => {
      event.ref = `refs/heads/${FAIR_LAUNCH_IMPORT.branch}`;
      event.before = FAIR_LAUNCH_IMPORT.source;
      event.after = f.head;
    },
  ]) {
    const changed = structuredClone(f.event);
    mutation(changed);
    await writeFile(f.eventPath, JSON.stringify(changed));
    assert.throws(() => checkIdentity(f));
    const result = await collect(f);
    assert.equal(result.status, 'DATA_SOURCE_ERROR');
    assert.equal(result.commit, undefined);
  }
  await writeFile(f.eventPath, JSON.stringify(f.event));
  const wrongId = { GITHUB_REPOSITORY_ID: String(CANONICAL_REPOSITORY_ID + 1) };
  assert.throws(() => checkIdentity(f, wrongId));
  await rejects(f, 'RECORDED_GIT_CI_CONTEXT_INVALID', { ...f.environment, ...wrongId });
});

test('master dashboard proof rejects changed tree, wrong parent, and later master history', async (t) => {
  const f = await fixture(t);
  await masterLayout(f, FAIR_LAUNCH_IMPORT.source);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  await masterLayout(
    f,
    FAIR_LAUNCH_IMPORT.base,
    git(f.root, ['rev-parse', `${FAIR_LAUNCH_IMPORT.base}^{tree}`]),
  );
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  const firstMaster = await masterLayout(f);
  git(f.root, ['update-ref', '-d', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`]);
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID');
  git(f.root, ['update-ref', `refs/remotes/origin/${FAIR_LAUNCH_IMPORT.branch}`, f.head]);
  git(f.root, ['commit', '--quiet', '--allow-empty', '-m', 'Later ordinary master change']);
  const later = git(f.root, ['rev-parse', 'HEAD']);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', later]);
  await writeFile(f.eventPath, JSON.stringify({ ...f.event, before: firstMaster, after: later }));
  // This fabricated earlier squash is unrelated to the immutable integration
  // anchor; recognizing a follow-up context does not admit its source proof.
  await rejects(f, 'RECORDED_GIT_PRESERVED_SOURCE_INVALID', { ...f.environment, GITHUB_SHA: later });
  // A normal later master range gets ordinary identity validation, not an import exemption.
  assert.match(
    checkIdentity(f, { GITHUB_SHA: later }),
    /Identity lifecycle push: 0 worker provenance record/,
  );
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
