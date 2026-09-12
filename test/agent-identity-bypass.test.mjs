import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommitSetIdentity } from '../tools/agent-identity-set.mjs';

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
