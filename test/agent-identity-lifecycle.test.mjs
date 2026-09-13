import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const subject = '[Macbeth01][AF-MIGRATION] Consolidate migration';
const body = 'Agent-ID: Macbeth01\nTask-ID: AF-MIGRATION';
const prTitle = '[Macbeth01][AF-MIGRATION] Consolidate migration';
function scenario(t, { commits = [{ subject, body }], mergeCheckout = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'af-identity-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const name of [
    'GITHUB_HEAD_REF',
    'GITHUB_REF',
    'GITHUB_SHA',
    'GITHUB_EVENT_PATH',
    'GITHUB_EVENT_NAME',
  ])
    delete env[name];
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'fixture');
  git('config', 'user.name', 'Lifecycle fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  git('add', '.gitattributes');
  git('commit', '-qm', 'docs: initial fixture');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/master', base);
  for (const commit of commits) git('commit', '--allow-empty', '-qm', commit.subject, '-m', commit.body);
  const head = git('rev-parse', 'HEAD');
  if (mergeCheckout) git('commit', '--allow-empty', '-qm', '[Macbeth99] unrelated checkout');
  mkdirSync(join(root, 'tools'));
  for (const name of ['agent-identity.mjs', 'agent-identity-set.mjs', 'check-agent-identity.mjs'])
    copyFileSync(new URL(`../tools/${name}`, import.meta.url), join(root, 'tools', name));
  return {
    base,
    head,
    run(eventName, payload, extraEnv = {}) {
      const path = join(root, 'event.json');
      writeFileSync(path, JSON.stringify(payload));
      return spawnSync(process.execPath, ['tools/check-agent-identity.mjs'], {
        cwd: root,
        env: { ...env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: path, GITHUB_SHA: head, ...extraEnv },
        encoding: 'utf8',
      });
    },
  };
}
function outcome(result, pass) {
  assert.equal(result.status === 0, pass, result.stdout + result.stderr);
}

test('PR event validates source head/ref even while checkout is a synthetic merge commit', (t) => {
  const s = scenario(t, { mergeCheckout: true });
  const result = s.run('pull_request', {
    pull_request: {
      title: prTitle,
      head: { sha: s.head, ref: 'macbeth01/AF-MIGRATION-work' },
      base: { sha: s.base, ref: 'master' },
    },
  });
  outcome(result, true);
  assert.match(result.stdout, new RegExp(s.head.slice(0, 12)));
});
for (const [branch, pass] of [
  ['macbeth01/AF-MIGRATION-work', true],
  ['macbeth02/AF-MIGRATION-work', false],
  ['feature/ordinary', false],
  ['master', true],
]) {
  test(`push event ${branch} enforces source identity or protected provenance`, (t) => {
    const s = scenario(t);
    outcome(s.run('push', { ref: `refs/heads/${branch}`, before: s.base, after: s.head }), pass);
  });
}
for (const commit of [
  { subject: '[Macbeth99] invalid', body: 'Agent-ID: Macbeth99\nTask-ID: AF-MIGRATION' },
  { subject, body: 'Agent-ID: Macbeth01' },
  { subject, body: '' },
  { subject, body: 'Agent-ID: Macbeth02\nTask-ID: AF-MIGRATION' },
  { subject: '[Macbeth0x] malformed', body },
]) {
  test(`master fails closed for incomplete or contradictory provenance: ${commit.subject} / ${commit.body}`, (t) => {
    const s = scenario(t, { commits: [commit] });
    outcome(s.run('push', { ref: 'refs/heads/master', before: s.base, after: s.head }), false);
  });
}
test('rebase result validates every worker-attributed commit on master', (t) => {
  const s = scenario(t, {
    commits: [
      { subject, body },
      {
        subject: '[Macbeth02][AF-MIGRATION] Reviewed contribution',
        body: 'Agent-ID: Macbeth02\nTask-ID: AF-MIGRATION',
      },
    ],
  });
  outcome(s.run('push', { ref: 'refs/heads/master', before: s.base, after: s.head }), true);
});
test('squash result validates single complete worker provenance on master', (t) => {
  const s = scenario(t, {
    commits: [{ subject: 'feat: [Macbeth01] consolidate AlphaForge into canonical repository', body }],
  });
  outcome(s.run('push', { ref: 'refs/heads/master', before: s.base, after: s.head }), true);
});
test('merge_group validates worker provenance using explicit protected base and group SHAs', (t) => {
  const s = scenario(t);
  outcome(
    s.run('merge_group', {
      merge_group: {
        base_ref: 'refs/heads/master',
        base_sha: s.base,
        head_sha: s.head,
        head_ref: 'refs/heads/gh-readonly-queue/master/pr-11-fixture',
      },
    }),
    true,
  );
});
test('merge_group does not turn a non-protected target into a provenance bypass', (t) => {
  const s = scenario(t);
  outcome(
    s.run('merge_group', {
      merge_group: {
        base_ref: 'refs/heads/feature/ordinary',
        base_sha: s.base,
        head_sha: s.head,
        head_ref: 'refs/heads/gh-readonly-queue/feature/pr-11-fixture',
      },
    }),
    false,
  );
});
for (const ref of ['master', 'macbeth01/AF-MIGRATION-work']) {
  test(`workflow_dispatch ${ref} explicitly validates current commit/range`, (t) => {
    const s = scenario(t);
    const result = s.run('workflow_dispatch', { ref: `refs/heads/${ref}` });
    outcome(result, true);
    assert.match(result.stdout, new RegExp(s.head.slice(0, 12)));
  });
}
test('workflow_dispatch master does not skip malformed current provenance', (t) => {
  const s = scenario(t, { commits: [{ subject: '[Macbeth99] invalid', body }] });
  outcome(s.run('workflow_dispatch', { ref: 'refs/heads/master' }), false);
});
