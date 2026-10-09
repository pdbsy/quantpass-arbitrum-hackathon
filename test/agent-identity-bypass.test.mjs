import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommitSetIdentity } from '../tools/agent-identity-set.mjs';
import { verifyPreservedSourceImport } from '../tools/preserved-source-identity.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const commit = {
  subject: 'chore(agents): [Macbeth01] update setup',
  body: 'Agent-ID: Macbeth01\nTask-ID: AF-AGENT-SETUP',
};

test('worker-labelled PRs and commits cannot bypass checks on a non-worker branch', () => {
  assert.throws(() =>
    validateCommitSetIdentity({
      branch: 'feature/not-a-worker',
      prTitle: '[Macbeth01][AF-AGENT-SETUP] Worker setup',
      commits: [commit],
    }),
  );
  assert.throws(() =>
    validateCommitSetIdentity({ branch: 'feature/not-a-worker', prTitle: null, commits: [commit] }),
  );
  assert.throws(() =>
    validateCommitSetIdentity({
      branch: 'feature/not-a-worker',
      prTitle: null,
      commits: [
        {
          ...commit,
          subject: 'chore: [Macbeth99] update',
          body: 'Agent-ID: Macbeth99\nTask-ID: AF-AGENT-SETUP',
        },
      ],
    }),
  );
  assert.deepEqual(
    validateCommitSetIdentity({
      branch: 'feature/ordinary',
      prTitle: 'Ordinary maintenance',
      commits: [{ subject: 'docs: clarify notes', body: '' }],
    }),
    { skipped: true, verified: 0 },
  );
});

function preservedFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'af-preserved-source-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }).trim();
  git('init', '-q', '-b', 'fixture');
  git('config', 'user.name', 'Preserved source fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(directory, 'source.txt'), 'original content\n');
  git('add', '.');
  git('commit', '-qm', 'initial fixture');
  const base = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', '[Macbeth01] historical source');
  const source = git('rev-parse', 'HEAD');
  const profile = {
    branch: 'codex/assigned-source-import',
    repository: 'pdbsy/quantpass-arbitrum-hackathon',
    base,
    source,
    originalCommitCount: 1,
  };
  const records = () =>
    git('--no-replace-objects', 'log', '--format=%H%x00%s%x00%b%x1e', `${base}..HEAD`)
      .split('\x1e')
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [sha, subject, body = ''] = row.split('\x00');
        return { sha, subject, body };
      });
  const verify = (overrides = {}) => {
    const head = git('rev-parse', 'HEAD');
    return verifyPreservedSourceImport(profile, {
      branch: profile.branch,
      head,
      prTitle: 'Publish reviewed source',
      pull: {
        head: { ref: profile.branch, sha: head, repo: { full_name: profile.repository } },
        base: { ref: 'master', sha: base, repo: { full_name: profile.repository } },
      },
      commits: records(),
      git,
      ...overrides,
    });
  };
  return { git, base, source, profile, verify };
}

test('assigned source import retains exact original objects while allowing ordinary follow-up', (t) => {
  const fixture = preservedFixture(t);
  fixture.git('commit', '--allow-empty', '-qm', 'docs: describe scanner results');
  assert.deepEqual(fixture.verify(), { preserved: 1, added: 1 });
  assert.throws(() => fixture.verify({ branch: 'codex/unassigned-import' }));
  assert.throws(() => fixture.verify({ commits: [] }));
  assert.throws(() =>
    fixture.verify({
      commits: [{ sha: fixture.source, subject: '[Macbeth01] historical source', body: '' }],
    }),
  );
  assert.throws(() => fixture.verify({ prTitle: '[Macbeth01] new worker claim' }));
});

test('assigned source import rejects substituted history and noncanonical PR binding', (t) => {
  const fixture = preservedFixture(t);
  assert.throws(() =>
    fixture.verify({
      pull: {
        head: {
          ref: fixture.profile.branch,
          sha: fixture.source,
          repo: { full_name: 'untrusted/fork' },
        },
        base: { ref: 'master', sha: fixture.base, repo: { full_name: fixture.profile.repository } },
      },
    }),
  );
  fixture.git('checkout', '-qb', 'rewritten', fixture.base);
  fixture.git(
    '-c',
    'user.name=Rewritten fixture',
    'commit',
    '--allow-empty',
    '-qm',
    '[Macbeth01] historical source',
  );
  fixture.git('commit', '--allow-empty', '-qm', 'different ancestry');
  // Even identical source files cannot substitute for the pinned source commit.
  assert.throws(() => fixture.verify());
});

test('source import exception cannot append new worker labels or identity trailers', (t) => {
  const fixture = preservedFixture(t);
  fixture.git('commit', '--allow-empty', '-qm', '[Macbeth01] new worker attribution');
  assert.throws(() => fixture.verify());
  fixture.git('reset', '--hard', fixture.source);
  fixture.git('commit', '--allow-empty', '-qm', 'ordinary-looking change', '-m', 'Agent-ID: Macbeth01');
  assert.throws(() => fixture.verify());
});

test('source import rejects alternate graft-file ancestry', (t) => {
  const fixture = preservedFixture(t);
  const originalGraftFile = process.env.GIT_GRAFT_FILE;
  try {
    process.env.GIT_GRAFT_FILE = join(tmpdir(), 'af-untrusted-grafts');
    assert.throws(() => fixture.verify(), /alternate graft/);
  } finally {
    if (originalGraftFile === undefined) delete process.env.GIT_GRAFT_FILE;
    else process.env.GIT_GRAFT_FILE = originalGraftFile;
  }
});
