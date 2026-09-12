import { validateCommitIdentity } from './agent-identity.mjs';

const WORKER_BRANCH = /^macbeth0[1-5]\//;
const WORKER_LABEL = /\[Macbeth[^\]]+\]/;
const WORKER_TRAILER = /^Agent-ID:\s*\S+\s*$/m;

export function validateCommitSetIdentity({ branch, prTitle = null, commits }) {
  if (typeof branch !== 'string' || !Array.isArray(commits)) throw new Error('Invalid commit set input');
  const declaredWorker =
    (typeof prTitle === 'string' && WORKER_LABEL.test(prTitle)) ||
    commits.some(
      (commit) =>
        WORKER_LABEL.test(typeof commit.subject === 'string' ? commit.subject : '') ||
        WORKER_TRAILER.test(typeof commit.body === 'string' ? commit.body : ''),
    );
  if (!WORKER_BRANCH.test(branch)) {
    if (declaredWorker) throw new Error('Worker identity requires a registered worker branch prefix');
    return { skipped: true, verified: 0 };
  }
  if (!commits.length) throw new Error('Worker branch range contains no commits');
  for (const commit of commits)
    validateCommitIdentity({
      branch,
      prTitle,
      subject: commit.subject,
      body: commit.body,
    });
  return { skipped: false, verified: commits.length };
}
