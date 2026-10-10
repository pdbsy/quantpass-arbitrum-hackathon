import { validateCommitSetIdentity } from './agent-identity-set.mjs';
import { lstatSync } from 'node:fs';
import { hostedRepositoryMatches, repositoryNamesMatch } from './environment/policy.mjs';

// The user retired the worker-role requirement for this task. Preserve the
// already authored source objects; this profile grants no merge or chain rights.
export const FAIR_LAUNCH_IMPORT = Object.freeze({
  branch: 'codex/alphaforge-fair-launch-v3-20261009',
  repository: 'pdbsy/quantpass-arbitrum-hackathon',
  base: '3cb9caa810e34d8ff9f9a6c68b5ef674f489689e',
  source: '223d0d1b417b5b4de42319d3ed6bccbaf9a26126',
  originalCommitCount: 71,
});

export function verifyPreservedSourceImport(profile, { branch, head, prTitle, pull, commits, git }) {
  if (process.env.GIT_GRAFT_FILE) throw new Error('Preserved source import rejects alternate graft files');
  if (
    branch !== profile.branch ||
    !/^[a-f0-9]{40}$/.test(head) ||
    !/^[a-f0-9]{40}$/.test(profile.base) ||
    !/^[a-f0-9]{40}$/.test(profile.source) ||
    !Number.isSafeInteger(profile.originalCommitCount) ||
    profile.originalCommitCount < 1 ||
    !Array.isArray(commits)
  )
    throw new Error('Preserved source import requires the exact assigned branch and revisions');
  if (
    pull &&
    (pull.head?.ref !== branch ||
      pull.head?.sha !== head ||
      !repositoryNamesMatch(pull.head?.repo?.full_name, profile.repository) ||
      !hostedRepositoryMatches(pull.head?.repo?.full_name, pull.head?.repo?.id) ||
      pull.base?.ref !== 'master' ||
      pull.base?.sha !== profile.base ||
      pull.base?.repo?.full_name !== pull.head?.repo?.full_name ||
      !hostedRepositoryMatches(pull.base?.repo?.full_name, pull.base?.repo?.id))
  )
    throw new Error('Preserved source import requires canonical same-repository PR context');

  // Git object identity preserves authors, timestamps, messages, trees and
  // parent relationships. A rewritten or squashed source cannot qualify.
  const read = (...args) => git('--no-replace-objects', ...args);
  if (read('rev-parse', '--is-shallow-repository') !== 'false')
    throw new Error('Preserved source import requires full history');
  try {
    lstatSync(read('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts'));
    throw new Error('Preserved source import rejects grafted history');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  read('merge-base', '--is-ancestor', profile.base, profile.source);
  read('merge-base', '--is-ancestor', profile.source, head);
  const original = read('rev-list', `${profile.base}..${profile.source}`).split('\n').filter(Boolean);
  if (original.length !== profile.originalCommitCount || original.some((sha) => !/^[a-f0-9]{40}$/.test(sha)))
    throw new Error('Preserved source import requires complete original commit objects');
  const originals = new Set(original);
  const seen = new Set();
  for (const commit of commits) {
    if (!/^[a-f0-9]{40}$/.test(commit.sha) || seen.has(commit.sha))
      throw new Error('Preserved source import has invalid or duplicate commit records');
    seen.add(commit.sha);
  }
  if (original.some((sha) => !seen.has(sha)))
    throw new Error('Preserved source import omitted original commits');
  const actual = read('rev-list', `${profile.base}..${head}`).split('\n').filter(Boolean);
  if (actual.length !== seen.size || actual.some((sha) => !seen.has(sha)))
    throw new Error('Preserved source import omitted or fabricated follow-up commits');
  const added = commits.filter((commit) => !originals.has(commit.sha));
  // New work follows the ordinary branch rules. The historical exception
  // cannot introduce new worker identities or extend to another branch.
  validateCommitSetIdentity({ branch, prTitle, commits: added });
  return { preserved: original.length, added: added.length };
}

// The repository requires linear master history. Admit only the first exact
// squash of this assigned import while retaining every original source object
// through its unchanged source branch; this grants no later master exception.
export function verifyPreservedMasterImport(profile, { head, git }) {
  const reject = () => {
    throw new Error('Preserved master import requires the exact first squash and retained source');
  };
  const read = (...args) => git('--no-replace-objects', ...args);
  if (!/^[a-f0-9]{40}$/.test(head)) reject();
  if (read('rev-parse', '--verify', 'refs/remotes/origin/master^{commit}') !== head) reject();
  if (read('rev-list', '--parents', '--max-count=1', head) !== `${head} ${profile.base}`) reject();
  const sourceHead = read('rev-parse', '--verify', `refs/remotes/origin/${profile.branch}^{commit}`);
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) reject();
  const sourceTree = read('rev-parse', '--verify', `${sourceHead}^{tree}`);
  if (!/^[a-f0-9]{40}$/.test(sourceTree) || read('rev-parse', '--verify', `${head}^{tree}`) !== sourceTree)
    reject();
  const records = (base, end) =>
    read('log', '--format=%H%x00%s%x00%b%x1e', `${base}..${end}`)
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, subject, body = ''] = record.split('\x00');
        return { sha, subject, body };
      });
  const imported = verifyPreservedSourceImport(profile, {
    branch: profile.branch,
    head: sourceHead,
    prTitle: null,
    pull: null,
    commits: records(profile.base, sourceHead),
    git,
  });
  validateCommitSetIdentity({
    branch: 'master',
    commits: records(profile.base, head),
    protectedTarget: true,
  });
  return { head, sourceHead, sourceTree, ...imported };
}
