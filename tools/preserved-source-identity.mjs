import { validateCommitSetIdentity } from './agent-identity-set.mjs';
import { MANAGER_INTEGRATIONS } from './agent-identity.mjs';
import { lstatSync } from 'node:fs';
import {
  CANONICAL_REPOSITORY,
  hostedRepositoryMatches,
  repositoryNamesMatch,
} from './environment/policy.mjs';

// The user retired the worker-role requirement for this task. Preserve the
// already authored source objects; this profile grants no merge or chain rights.
export const FAIR_LAUNCH_IMPORT = Object.freeze({
  branch: 'codex/alphaforge-fair-launch-v3-20261009',
  repository: 'pdbsy/quantpass-arbitrum-hackathon',
  base: '3cb9caa810e34d8ff9f9a6c68b5ef674f489689e',
  source: '223d0d1b417b5b4de42319d3ed6bccbaf9a26126',
  originalCommitCount: 71,
  integration: Object.freeze({
    commit: 'd45ac4be5a6269d26f1c642f48fdf6a1f41ddb96',
    tree: '8b89548b95e857828ae2837af7e5a322b94de821',
    sourceHead: '2180cea918669d62c0f2e19a93f80ae23b28df81',
    addedCommitCount: 22,
  }),
});

function commitRecords(read, base, head) {
  return read('log', '--format=%H%x00%s%x00%b%x1e', `${base}..${head}`)
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ''] = record.split('\x00');
      return { sha, subject, body };
    });
}

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

// Preserve the completed, immutable integration as historical evidence. Later
// work has its own tree and remains subject to normal commit identity checks.
export function verifyPreservedIntegrationAnchor(profile, { head, git }) {
  const read = (...args) => git('--no-replace-objects', ...args);
  const anchor = profile.integration;
  const requireProof = (condition) => {
    if (!condition) throw new Error('Preserved integration requires the exact immutable anchor and source');
  };
  for (const sha of [head, anchor?.commit, anchor?.tree, anchor?.sourceHead])
    requireProof(/^[a-f0-9]{40}$/.test(sha ?? ''));
  requireProof(
    read('rev-parse', '--verify', `refs/remotes/origin/${profile.branch}^{commit}`) === anchor.sourceHead,
  );
  requireProof(
    read('rev-list', '--parents', '--max-count=1', anchor.commit) === `${anchor.commit} ${profile.base}`,
  );
  requireProof(read('rev-parse', '--verify', `${anchor.commit}^{tree}`) === anchor.tree);
  requireProof(read('rev-parse', '--verify', `${anchor.sourceHead}^{tree}`) === anchor.tree);
  const imported = verifyPreservedSourceImport(profile, {
    branch: profile.branch,
    head: anchor.sourceHead,
    prTitle: null,
    pull: null,
    commits: commitRecords(read, profile.base, anchor.sourceHead),
    git,
  });
  requireProof(imported.added === anchor.addedCommitCount);
  read('merge-base', '--is-ancestor', anchor.commit, head);
  read('merge-base', '--is-ancestor', anchor.commit, 'refs/remotes/origin/master');
  validateCommitSetIdentity({
    branch: 'master',
    commits: commitRecords(read, anchor.commit, head),
    protectedTarget: head !== anchor.commit,
  });
  return {
    head,
    integrationHead: anchor.commit,
    sourceHead: anchor.sourceHead,
    sourceTree: anchor.tree,
    ...imported,
  };
}

// Bind ordinary follow-up evidence to the real hosted checkout and event. This
// does not exempt any post-integration commits from their normal branch rules.
export function verifyPreservedHostedFollowup(profile, { environment, event, head, git }) {
  const read = (...args) => git('--no-replace-objects', ...args);
  const requireContext = (condition) => {
    if (!condition)
      throw new Error('Preserved follow-up requires canonical hosted context and ordinary provenance');
  };
  const fullSha = (sha) => /^[a-f0-9]{40}$/.test(sha ?? '');
  const eventName = environment.GITHUB_EVENT_NAME;
  requireContext(
    environment.GITHUB_ACTIONS === 'true' &&
      ['push', 'workflow_dispatch', 'pull_request'].includes(eventName),
  );
  requireContext(
    environment.GITHUB_REPOSITORY === CANONICAL_REPOSITORY &&
      hostedRepositoryMatches(CANONICAL_REPOSITORY, environment.GITHUB_REPOSITORY_ID),
  );
  requireContext(
    event.repository?.full_name === CANONICAL_REPOSITORY &&
      hostedRepositoryMatches(CANONICAL_REPOSITORY, event.repository?.id),
  );
  requireContext(
    fullSha(head) &&
      environment.GITHUB_SHA === head &&
      read('rev-parse', '--verify', 'HEAD^{commit}') === head,
  );
  const masterBase = read('rev-parse', '--verify', 'refs/remotes/origin/master^{commit}');
  let branch,
    base,
    candidate,
    prTitle = null;
  if (eventName === 'pull_request') {
    const match = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/.exec(environment.GITHUB_REF ?? '');
    const pull = event.pull_request;
    requireContext(match && event.number === Number(match[1]) && environment.GITHUB_BASE_REF === 'master');
    branch = pull?.head?.ref;
    candidate = pull?.head?.sha;
    base = pull?.base?.sha;
    requireContext(
      typeof branch === 'string' &&
        branch !== 'master' &&
        branch !== profile.branch &&
        environment.GITHUB_HEAD_REF === branch,
    );
    requireContext(fullSha(base) && fullSha(candidate) && pull.base.ref === 'master' && base === masterBase);
    for (const side of ['head', 'base'])
      requireContext(
        pull[side].repo?.full_name === CANONICAL_REPOSITORY &&
          hostedRepositoryMatches(CANONICAL_REPOSITORY, pull[side].repo?.id),
      );
    requireContext(read('rev-parse', '--verify', `refs/remotes/pull/${match[1]}/merge^{commit}`) === head);
    requireContext(read('rev-list', '--parents', '--max-count=1', head) === `${head} ${base} ${candidate}`);
    requireContext(
      read('rev-parse', '--verify', `${head}^{tree}`) ===
        read('rev-parse', '--verify', `${candidate}^{tree}`),
    );
    prTitle = pull.title ?? null;
  } else {
    const match = /^refs\/heads\/(.+)$/.exec(environment.GITHUB_REF ?? '');
    requireContext(
      match &&
        [undefined, ''].includes(environment.GITHUB_BASE_REF) &&
        [undefined, ''].includes(environment.GITHUB_HEAD_REF),
    );
    branch = match[1];
    requireContext(
      branch !== profile.branch &&
        (event.ref === environment.GITHUB_REF || (eventName === 'workflow_dispatch' && event.ref === branch)),
    );
    candidate = head;
    requireContext(eventName !== 'push' || event.after === head);
    if (branch === 'master') {
      requireContext(masterBase === head);
      base = eventName === 'push' ? event.before : read('rev-parse', '--verify', `${head}^`);
      requireContext(fullSha(base));
      requireContext(read('rev-list', '--min-parents=2', `${base}..${head}`) === '');
    } else {
      base = masterBase;
      if (eventName === 'push' && event.before !== '0'.repeat(40)) {
        requireContext(fullSha(event.before));
        read('merge-base', '--is-ancestor', event.before, head);
      }
    }
  }
  read('check-ref-format', `refs/heads/${branch}`);
  requireContext(!MANAGER_INTEGRATIONS.some((integration) => integration.branch === branch));
  requireContext(read('rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`) === candidate);
  read('merge-base', '--is-ancestor', profile.integration.commit, base);
  read('merge-base', '--is-ancestor', base, candidate);
  const anchored = verifyPreservedIntegrationAnchor(profile, { head: candidate, git });
  requireContext(
    read(
      'log',
      '--format=%H',
      `${profile.integration.commit}..${candidate}`,
      '--',
      ...MANAGER_INTEGRATIONS.map(({ task }) => `docs/management/agents/integrations/${task}.json`),
    ) === '',
  );
  const ordinary = validateCommitSetIdentity({
    branch,
    prTitle,
    commits: commitRecords(read, base, candidate),
    protectedTarget: branch === 'master',
  });
  return { ...anchored, head, branch, base, candidate, masterBase, ordinary };
}
