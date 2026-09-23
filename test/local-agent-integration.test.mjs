import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import * as identity from '../tools/agent-integration-identity.mjs';

// LOCAL API cases run in a temporary local process environment even when their
// enclosing test runner is hosted. Production hosted admission remains unchanged;
// the CLI cases below explicitly assert all three hosted markers are rejected.
function localVerify(root, options) {
  const saved = Object.entries(process.env).filter(([key]) => /^(GITHUB_|ACTIONS_|RUNNER_)/.test(key));
  for (const [key] of saved) delete process.env[key];
  try {
    return identity.verifyLocalManagerIntegration(root, options);
  } finally {
    for (const [key, value] of saved) process.env[key] = value;
  }
}

const branch = 'macbeth01/m3-phase1-closeout';
const task = 'M3-01-PHASE1-CLOSEOUT';
const repository = 'pdbsy/quantpass-arbitrum-hackathon';
test('explicit local integration provider exists separately from hosted verification', () => {
  assert.equal(typeof identity.verifyLocalManagerIntegration, 'function');
});
const available = typeof identity.verifyLocalManagerIntegration === 'function';
test('hosted phase-one accepts only assigned 06 from real origin source pins', async (t) => {
  const s = fixture(t);
  const registry = join(s.root, 'tools/agent-identity.mjs');
  // Reproduce the manager's already registered phase-one profile in this isolated fixture.
  writeFileSync(
    registry,
    readFileSync(registry, 'utf8').replace(
      'export const MANAGER_INTEGRATIONS = Object.freeze([',
      `export const MANAGER_INTEGRATIONS = Object.freeze([Object.freeze({branch:'${branch}',task:'${task}'}),`,
    ),
  );
  const hosted = await import(pathToFileURL(join(s.root, 'tools/agent-integration-identity.mjs')).href);
  s.git('update-ref', 'refs/remotes/origin/master', s.base);
  for (const source of s.sources) s.git('update-ref', `refs/remotes/origin/${source.branch}`, source.head);
  const doc = {
    ...s.manifest,
    sources: s.sources.map(({ agent, task, branch, head }) => ({ agent, task, branch, head })),
  };
  delete doc.provider;
  const record = () => {
    writeFileSync(join(s.root, `docs/management/agents/integrations/${doc.task}.json`), JSON.stringify(doc));
    s.git('add', 'docs');
    s.commit('Macbeth01', doc.task);
    return () =>
      hosted.verifyManagerIntegration(s.root, { branch: doc.branch, head: s.git('rev-parse', 'HEAD') });
  };
  assert.equal(record()().imported, 5);
  const six = doc.sources.find((source) => source.agent === 'Macbeth06');
  s.git('update-ref', `refs/remotes/origin/${six.branch}`, s.base);
  assert.throws(record(), /ancestry/);
  s.git('update-ref', `refs/remotes/origin/${six.branch}`, six.head);
  six.task = 'M3-06-OTHER';
  assert.throws(record(), /06/);
  six.task = 'M3-06-CI-GATES';
  doc.branch = 'macbeth01/AF-M3-CLOSEOUT';
  doc.task = 'AF-M3-CLOSEOUT';
  s.git('switch', '-qc', doc.branch);
  assert.throws(record(), /06|source branch/);
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'af-local-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'master');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('remote', 'add', 'origin', `https://github.com/${repository}.git`);
  git('commit', '--allow-empty', '-qm', 'Base');
  const base = git('rev-parse', 'HEAD');
  const message = (agent, task, label = 'Record') => [
    '-m',
    `[${agent}][${task}] ${label}`,
    '-m',
    `Agent-ID: ${agent}\nTask-ID: ${task}`,
  ];
  const commit = (agent, task) => git('commit', '--allow-empty', ...message(agent, task));
  const sources = [];
  for (const n of [2, 3, 4, 5, 6]) {
    const agent = `Macbeth0${n}`,
      task = n === 6 ? 'M3-06-CI-GATES' : `M3-0${n}-FIXTURE`,
      sourceBranch = `macbeth0${n}/fixture`;
    git('switch', '-qc', sourceBranch, base);
    commit(agent, task);
    const head = git('rev-parse', 'HEAD'),
      local_ref = `refs/remotes/local-macbeth0${n}/fixture`;
    git('update-ref', local_ref, head);
    sources.push({ agent, task, branch: sourceBranch, head, local_ref });
  }
  git('switch', '-qc', branch, base);
  for (const source of sources) git('merge', '--no-ff', ...message('Macbeth01', task), source.head);
  const manifest = { schema_version: 1, provider: 'LOCAL', repository, branch, task, base, sources };
  mkdirSync(join(root, 'docs/management/agents/integrations'), { recursive: true });
  mkdirSync(join(root, 'tools'));
  for (const file of [
    'agent-identity.mjs',
    'agent-integration-identity.mjs',
    'check-local-agent-integration.mjs',
  ]) {
    try {
      copyFileSync(new URL(`../tools/${file}`, import.meta.url), join(root, 'tools', file));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const record = (value = manifest) => {
    writeFileSync(
      join(root, `docs/management/agents/integrations/${task}.local.json`),
      JSON.stringify(value),
    );
    git('add', 'docs');
    commit('Macbeth01', task);
    return git('rev-parse', 'HEAD');
  };
  record();
  const options = () => ({ branch, base, head: git('rev-parse', 'HEAD') });
  return {
    root,
    env,
    git,
    base,
    sources,
    manifest,
    record,
    options,
    message,
    commit,
    check: () => localVerify(root, options()),
  };
}
test(
  'local pinned refs accept preserved worker and manager history without origin source refs',
  { skip: !available },
  (t) => {
    const s = fixture(t);
    const r = s.check();
    assert.equal(r.scope, 'LOCAL');
    assert.equal(r.githubStatus, false);
    assert.equal(r.imported, 5);
    assert.equal(r.verified, 11);
  },
);
test(
  'missing, wrong namespace, mismatched and symbolic local refs are rejected',
  { skip: !available },
  (t) => {
    const s = fixture(t),
      src = s.sources[0];
    s.git('update-ref', '-d', src.local_ref);
    assert.throws(s.check);
    s.git('update-ref', src.local_ref, s.base);
    assert.throws(s.check, /local ref/);
    s.git('update-ref', src.local_ref, src.head);
    s.record({
      ...s.manifest,
      sources: s.sources.map((x) =>
        x === src ? { ...x, local_ref: 'refs/remotes/origin/macbeth02/fixture' } : x,
      ),
    });
    assert.throws(s.check, /local ref/);
    s.record();
    s.git('update-ref', 'refs/remotes/origin/macbeth02/fixture', src.head);
    s.git('symbolic-ref', src.local_ref, 'refs/remotes/origin/macbeth02/fixture');
    assert.throws(s.check, /symbolic/);
  },
);
test('local verifier propagates a real Git symbolic-ref failure beyond ordinary exit one', (t) => {
  const s = fixture(t);
  const ref = s.sources[0].local_ref;
  writeFileSync(join(s.root, '.git', ref), 'ref: refs/heads/..\n');
  const probe = spawnSync('git', ['symbolic-ref', '-q', ref], {
    cwd: s.root,
    env: s.env,
    encoding: 'utf8',
  });
  assert.equal(probe.status, 128);
  assert.throws(s.check, (error) => {
    assert.equal(error.status, 128);
    return true;
  });
});
test('advanced local ref cannot stand in for its pinned source head', { skip: !available }, (t) => {
  const s = fixture(t),
    src = s.sources[0];
  s.git('switch', src.branch);
  s.commit(src.agent, src.task);
  s.git('update-ref', src.local_ref, s.git('rev-parse', 'HEAD'));
  s.git('switch', branch);
  assert.throws(s.check, /local ref/);
});
test(
  'local verifier requires explicit exact base and rejects provider substitution',
  { skip: !available },
  (t) => {
    const s = fixture(t);
    assert.throws(() => localVerify(s.root, { ...s.options(), base: undefined }));
    assert.throws(() => localVerify(s.root, { ...s.options(), base: s.sources[0].head }));
    s.record({ ...s.manifest, provider: 'GITHUB' });
    assert.throws(s.check, /manifest/);
  },
);
test(
  'hosted provider never falls back to local source refs or accepts LOCAL arguments',
  { skip: !available },
  (t) => {
    const s = fixture(t);
    const hostedBranch = 'macbeth01/AF-M3-CLOSEOUT';
    s.git('switch', '-qc', hostedBranch);
    const doc = { ...s.manifest, branch: hostedBranch, task: 'AF-M3-CLOSEOUT' };
    writeFileSync(
      join(s.root, 'docs/management/agents/integrations/AF-M3-CLOSEOUT.json'),
      JSON.stringify(doc),
    );
    s.git('add', 'docs');
    s.commit('Macbeth01', 'AF-M3-CLOSEOUT');
    s.git('update-ref', 'refs/remotes/origin/master', s.base);
    assert.throws(() =>
      identity.verifyManagerIntegration(s.root, {
        branch: hostedBranch,
        head: s.git('rev-parse', 'HEAD'),
        provider: 'LOCAL',
        base: s.base,
      }),
    );
    delete doc.provider;
    doc.sources = doc.sources
      .filter((source) => source.agent !== 'Macbeth06')
      .map(({ agent, task, branch, head }) => ({ agent, task, branch, head }));
    writeFileSync(
      join(s.root, 'docs/management/agents/integrations/AF-M3-CLOSEOUT.json'),
      JSON.stringify(doc),
    );
    s.git('add', 'docs');
    s.commit('Macbeth01', 'AF-M3-CLOSEOUT');
    assert.throws(
      () =>
        identity.verifyManagerIntegration(s.root, {
          branch: hostedBranch,
          head: s.git('rev-parse', 'HEAD'),
          provider: 'LOCAL',
          base: s.base,
        }),
      /origin\/macbeth02|Command failed/,
    );
  },
);
test(
  '06 admission is confined to the assigned source task and phase-one target',
  { skip: !available },
  (t) => {
    const s = fixture(t);
    s.record({
      ...s.manifest,
      sources: s.sources.map((x) => (x.agent === 'Macbeth06' ? { ...x, task: 'M3-06-OTHER' } : x)),
    });
    assert.throws(s.check, /06/);
    assert.throws(() => localVerify(s.root, { ...s.options(), branch: 'macbeth01/other' }));
  },
);
test('local source cannot launder unregistered foreign commits', { skip: !available }, (t) => {
  const s = fixture(t),
    src = s.sources[0];
  s.git('switch', src.branch);
  s.commit('Macbeth03', 'M3-03-FOREIGN');
  s.commit(src.agent, src.task);
  src.head = s.git('rev-parse', 'HEAD');
  s.git('update-ref', src.local_ref, src.head);
  s.git('switch', branch);
  s.git('merge', '--no-ff', ...s.message('Macbeth01', task), src.head);
  s.record();
  assert.throws(s.check, /unregistered provenance/);
});
test(
  'stacked worker accepts independently pinned manager checkpoint and rejects its omission',
  { skip: !available },
  (t) => {
    const s = fixture(t);
    const checkpointBranch = 'macbeth01/fixed-checkpoint';
    const checkpointTask = task;
    s.git('switch', '-qc', checkpointBranch, s.base);
    for (const src of s.sources.filter((x) => x.agent !== 'Macbeth06'))
      s.git('merge', '--no-ff', ...s.message('Macbeth01', checkpointTask), src.head);
    s.commit('Macbeth01', checkpointTask);
    const checkpoint = {
      agent: 'Macbeth01',
      task: checkpointTask,
      branch: checkpointBranch,
      head: s.git('rev-parse', 'HEAD'),
      local_ref: 'refs/remotes/local-macbeth01/fixed-checkpoint',
    };
    s.git('update-ref', checkpoint.local_ref, checkpoint.head);
    const child = s.sources.find((x) => x.agent === 'Macbeth04');
    s.git('switch', child.branch);
    s.git('merge', '--no-ff', ...s.message(child.agent, child.task), checkpoint.head);
    child.head = s.git('rev-parse', 'HEAD');
    s.git('update-ref', child.local_ref, child.head);
    s.git('switch', branch);
    s.git('merge', '--no-ff', ...s.message('Macbeth01', task), child.head);
    s.manifest.sources = [...s.sources, checkpoint];
    s.record();
    assert.equal(s.check().scope, 'LOCAL');
    s.record({ ...s.manifest, sources: s.sources });
    assert.throws(s.check, /unregistered provenance/);
    s.record({ ...s.manifest, sources: [...s.sources, { ...checkpoint, head: undefined }] });
    assert.throws(s.check);
  },
);
test('LOCAL reads committed manifest and rejects replacement history', { skip: !available }, (t) => {
  const s = fixture(t);
  writeFileSync(join(s.root, `docs/management/agents/integrations/${task}.local.json`), '{}');
  assert.equal(s.check().scope, 'LOCAL');
  s.git('update-ref', `refs/replace/${s.base}`, s.sources[0].head);
  assert.throws(s.check, /replace/);
});
test('CLI requires explicit pins, emits only LOCAL and refuses hosted context', { skip: !available }, (t) => {
  const s = fixture(t),
    args = [
      'tools/check-local-agent-integration.mjs',
      '--branch',
      branch,
      '--base',
      s.base,
      '--head',
      s.options().head,
    ];
  const run = (extra = {}, argv = args) =>
    spawnSync(process.execPath, argv, { cwd: s.root, env: { ...s.env, ...extra }, encoding: 'utf8' });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).scope, 'LOCAL');
  for (const marker of ['GITHUB_ACTIONS', 'ACTIONS_RUNTIME_URL', 'RUNNER_OS']) {
    const hosted = run({ [marker]: 'fixture-hosted' });
    assert.equal(hosted.status, 1);
    assert.match(hosted.stderr, /LOCAL entry cannot run in hosted context/);
    assert.equal(hosted.stdout, '');
  }
  assert.notEqual(run({}, args.slice(0, -2)).status, 0);
});
