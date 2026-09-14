import { agentForBranch, validateCommitIdentity, validateCommitProvenance } from './agent-identity.mjs';

const WORKER_LABEL = /\[Macbeth/i;
const WORKER_TRAILER = /^(?:Agent-ID|Task-ID):/im;
const declaresWorker = (commit) =>
  WORKER_LABEL.test(typeof commit.subject === 'string' ? commit.subject : '') ||
  WORKER_TRAILER.test(typeof commit.body === 'string' ? commit.body : '');

export function validateCommitSetIdentity({
  branch,
  prTitle = null,
  commits,
  protectedTarget = branch === 'master',
}) {
  if (typeof branch !== 'string' || !Array.isArray(commits)) throw new Error('Invalid commit set input');
  const declaredWorker =
    (typeof prTitle === 'string' && WORKER_LABEL.test(prTitle)) || commits.some(declaresWorker);
  if (protectedTarget) {
    if (branch !== 'master' || !commits.length) throw new Error('Invalid protected target range');
    const attributed = commits.filter(declaresWorker);
    for (const commit of attributed) validateCommitProvenance(commit);
    return { skipped: false, verified: attributed.length };
  }
  if (!agentForBranch(branch)) {
    if (declaredWorker || /^(?:macbeth|[0-9]{2}\/)/i.test(branch))
      throw new Error('Worker identity requires a registered worker branch prefix');
    return { skipped: true, verified: 0 };
  }
  if (!commits.length) throw new Error('Worker branch range contains no commits');
  for (const commit of commits)
    validateCommitIdentity({ branch, prTitle, subject: commit.subject, body: commit.body });
  return { skipped: false, verified: commits.length };
}
