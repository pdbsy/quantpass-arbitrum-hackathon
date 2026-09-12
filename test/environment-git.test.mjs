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
