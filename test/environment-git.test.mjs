import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { gitIdentity } from '../tools/environment/observe.mjs';

const repository = 'pdbsy/quantpass-arbitrum-hackathon';
test('real Git fixtures isolate configuration, normalize CRLF and bind detached PR parents', () => {
  const root = mkdtempSync(join(tmpdir(), 'environment 中文 space '));
  const git = (...args) => fixtureExec('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet', '-b', 'master');
    git('config', 'core.autocrlf', 'true');
    writeFileSync(join(root, '中文 Name.txt'), 'one\r\ntwo\r\n');
    git('add', '--all');
    git('commit', '--quiet', '-m', 'base');
    assert.equal(git('show', 'HEAD:中文 Name.txt'), 'one\ntwo');
    const base = git('rev-parse', 'HEAD');
    git('remote', 'add', 'origin', `https://github.com/${repository}.git`);
    git('update-ref', 'refs/remotes/origin/master', base);
    git('switch', '--quiet', '-c', 'macbeth/env-fixture');
    writeFileSync(join(root, 'change.txt'), 'new\n');
    git('add', '--all');
    git('commit', '--quiet', '-m', 'source');
    const head = git('rev-parse', 'HEAD');
    git('switch', '--quiet', 'master');
    git('merge', '--no-ff', '--quiet', 'macbeth/env-fixture', '-m', 'PR integration');
    const merge = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', '--detach', merge);
    const run = (args) => git(...args);
    const identity = gitIdentity(run, {
      event: 'pull_request',
      sha: merge,
      ref: 'refs/pull/9/merge',
      repository,
      head,
      base,
    });
    assert.equal(identity.sourceHead, head);
    assert.equal(identity.base, base);
    assert.equal(identity.head, merge);
    assert.equal(identity.historyValid, true);
    assert.equal(
      gitIdentity(run, {
        event: 'pull_request',
        sha: merge,
        ref: 'refs/pull/9/merge',
        repository,
        head: base,
        base,
      }).historyValid,
      false,
    );
    git('update-index', '--assume-unchanged', 'change.txt');
    assert.match(git('ls-files', '-v'), /h change.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real Git event identities reject unsupported, stale and wrongly bound refs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-event-graph-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => fixtureExec('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '-b', 'master');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture base');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/master', base);
  git('switch', '--quiet', '-c', 'feature');
  writeFileSync(join(root, 'source.txt'), 'source\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture source');
  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const run = (args) => git(...args);
  assert.equal(gitIdentity(run, {}).historyValid, true);
  for (const event of ['push', 'workflow_dispatch']) {
    const valid = { event, sha: head, repository, ref: 'refs/heads/feature' };
    const identity = gitIdentity(run, valid);
    assert.equal(identity.historyValid, true);
    assert.equal(identity.sourceHead, head);
    assert.equal(identity.sourceTree, tree);
    for (const change of [
      { ref: 'refs/tags/feature' },
      { ref: 'refs/heads/master' },
      { ref: 'refs/heads/missing' },
      { repository: 'other/repo' },
      { sha: base },
    ])
      assert.equal(
        gitIdentity(run, { ...valid, ...change }).historyValid,
        false,
        `${event} ${JSON.stringify(change)}`,
      );
  }
  assert.equal(gitIdentity(run, { event: 'schedule', sha: head, repository }).historyValid, false);
  const queue = {
    event: 'merge_group',
    sha: head,
    repository,
    ref: 'refs/heads/gh-readonly-queue/master/fixture',
    head,
    base,
  };
  assert.equal(gitIdentity(run, queue).historyValid, true);
  for (const change of [
    { ref: 'refs/heads/feature' },
    { head: base },
    { head: 'invalid' },
    { base: 'invalid' },
    { base: 'f'.repeat(40) },
  ])
    assert.equal(gitIdentity(run, { ...queue, ...change }).historyValid, false, JSON.stringify(change));
  git('checkout', '--quiet', '--detach');
  assert.equal(gitIdentity(run, {}).historyValid, false, 'detached local checkout has no source branch');
  const unmerged = { event: 'pull_request', sha: head, repository, ref: 'refs/pull/1/merge', head, base };
  assert.equal(gitIdentity(run, unmerged).historyValid, false, 'single-parent commit is not a PR merge');
  git('switch', '--quiet', 'master');
  git('merge', '--quiet', '--no-ff', 'feature', '-m', 'fixture PR merge');
  const merge = git('rev-parse', 'HEAD');
  const pr = { ...unmerged, sha: merge };
  assert.equal(gitIdentity(run, pr).historyValid, true);
  for (const change of [
    { ref: 'refs/pull/0/merge' },
    { base: head },
    { head: base },
    { base: 'invalid' },
    { head: 'invalid' },
  ])
    assert.equal(gitIdentity(run, { ...pr, ...change }).historyValid, false, JSON.stringify(change));
  git('update-ref', '-d', 'refs/remotes/origin/master');
  assert.equal(gitIdentity(run, {}).historyValid, false, 'missing known base fails closed');
});
