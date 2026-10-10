import { execFileSync } from 'node:child_process';
import { constants, fstatSync, lstatSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FAIR_LAUNCH_IMPORT,
  verifyPreservedSourceImport,
  verifyPreservedMasterImport,
  verifyPreservedHostedFollowup,
} from '../preserved-source-identity.mjs';
import {
  CANONICAL_REPOSITORY,
  hostedRepositoryMatches,
  repositoryNamesMatch,
} from '../environment/policy.mjs';

// This snapshot remains evidence for its original source, never for a newer
// Fair Launch commit. Its original manifest and closure are immutable objects.
export const PRESERVED_MANAGEMENT_SNAPSHOT = Object.freeze({
  branch: 'codex/alphaforge-w5-linux-git-release-20261004',
  commit: '0af1c5c192286b6199855259f0bae27ca0ffda2a',
  tree: '40b816499fd09e16605a6deaee4031b1b33f2983',
  closure: 'c0bba0abc80a056a0a61d6a3fbf960cd768d3ac1',
});
const historicalPaths = [
  '.checks/management/latest.json',
  'docs/management/dashboard/data/dashboard.json',
  'docs/management/dashboard/data/build-log.json',
];

function requireContext(condition) {
  if (!condition) throw new Error('Invalid preserved management context');
}

function boundedFileBytes(path) {
  requireContext(typeof path === 'string' && path.length > 0 && path.length <= 4096);
  const expected = lstatSync(path);
  requireContext(expected.isFile() && !expected.isSymbolicLink() && expected.nlink === 1);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = fstatSync(fd);
    requireContext(
      before.isFile() &&
        before.nlink === 1 &&
        before.size <= 1024 * 1024 &&
        before.dev === expected.dev &&
        before.ino === expected.ino &&
        before.size === expected.size &&
        before.mtimeMs === expected.mtimeMs &&
        before.ctimeMs === expected.ctimeMs,
    );
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    const after = fstatSync(fd);
    const named = lstatSync(path);
    requireContext(
      size === before.size &&
        after.dev === before.dev &&
        after.ino === before.ino &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs &&
        after.ctimeMs === before.ctimeMs &&
        named.isFile() &&
        !named.isSymbolicLink() &&
        named.nlink === 1 &&
        named.dev === before.dev &&
        named.ino === before.ino &&
        named.size === before.size &&
        named.mtimeMs === before.mtimeMs &&
        named.ctimeMs === before.ctimeMs,
    );
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}

function eventPayload(path) {
  const value = JSON.parse(boundedFileBytes(path).toString('utf8'));
  requireContext(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

export function preservedManagementContext(environment, baseBranch, recordedBranch) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) return null;
  const branch = FAIR_LAUNCH_IMPORT.branch;
  const eventName = environment.GITHUB_EVENT_NAME;
  const squashedMaster =
    ['push', 'workflow_dispatch'].includes(eventName) && environment.GITHUB_REF === 'refs/heads/master';
  const ordinaryBranch =
    (['push', 'workflow_dispatch'].includes(eventName) &&
      /^refs\/heads\/.+$/.test(environment.GITHUB_REF ?? '') &&
      ![`refs/heads/${branch}`, 'refs/heads/master'].includes(environment.GITHUB_REF)) ||
    (eventName === 'pull_request' && environment.GITHUB_HEAD_REF !== branch);
  const assigned =
    (['push', 'workflow_dispatch'].includes(eventName) &&
      environment.GITHUB_REF === `refs/heads/${branch}`) ||
    (eventName === 'pull_request' && environment.GITHUB_HEAD_REF === branch) ||
    squashedMaster ||
    ordinaryBranch;
  if (!assigned || recordedBranch !== PRESERVED_MANAGEMENT_SNAPSHOT.branch) return null;
  requireContext(environment.GITHUB_ACTIONS === 'true' && baseBranch === 'master');
  requireContext(repositoryNamesMatch(environment.GITHUB_REPOSITORY, FAIR_LAUNCH_IMPORT.repository));
  requireContext(hostedRepositoryMatches(environment.GITHUB_REPOSITORY, environment.GITHUB_REPOSITORY_ID));
  requireContext(/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? ''));
  const event = eventPayload(environment.GITHUB_EVENT_PATH);
  requireContext(event.repository?.full_name === environment.GITHUB_REPOSITORY);
  requireContext(hostedRepositoryMatches(event.repository.full_name, event.repository.id));
  const firstMaster =
    squashedMaster &&
    (event.before === FAIR_LAUNCH_IMPORT.base ||
      (eventName === 'workflow_dispatch' &&
        environment.GITHUB_SHA === FAIR_LAUNCH_IMPORT.integration.commit));
  if (ordinaryBranch || (squashedMaster && !firstMaster)) {
    requireContext(environment.GITHUB_REPOSITORY === CANONICAL_REPOSITORY);
    let followupBranch;
    if (eventName === 'pull_request') {
      const match = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/.exec(environment.GITHUB_REF ?? '');
      followupBranch = event.pull_request?.head?.ref;
      requireContext(
        match &&
          event.number === Number(match[1]) &&
          environment.GITHUB_BASE_REF === 'master' &&
          environment.GITHUB_HEAD_REF === followupBranch,
      );
      requireContext(
        typeof followupBranch === 'string' && followupBranch !== 'master' && followupBranch !== branch,
      );
    } else {
      followupBranch = /^refs\/heads\/(.+)$/.exec(environment.GITHUB_REF ?? '')?.[1];
      requireContext(
        followupBranch &&
          [undefined, ''].includes(environment.GITHUB_BASE_REF) &&
          [undefined, ''].includes(environment.GITHUB_HEAD_REF),
      );
      requireContext(
        event.ref === environment.GITHUB_REF ||
          (eventName === 'workflow_dispatch' && event.ref === followupBranch),
      );
      requireContext(eventName !== 'push' || event.after === environment.GITHUB_SHA);
    }
    return {
      kind: 'preserved_source',
      eventName,
      branch: followupBranch,
      sha: environment.GITHUB_SHA,
      pull: null,
      integratedFollowup: true,
      comparisonBaseCommit: FAIR_LAUNCH_IMPORT.base,
      environment: Object.fromEntries(
        [
          'GITHUB_ACTIONS',
          'GITHUB_EVENT_NAME',
          'GITHUB_REF',
          'GITHUB_BASE_REF',
          'GITHUB_HEAD_REF',
          'GITHUB_REPOSITORY',
          'GITHUB_REPOSITORY_ID',
          'GITHUB_SHA',
        ].map((field) => [field, environment[field]]),
      ),
      event,
    };
  }
  if (squashedMaster) {
    requireContext(environment.GITHUB_REPOSITORY === CANONICAL_REPOSITORY);
    requireContext(
      [undefined, ''].includes(environment.GITHUB_BASE_REF) &&
        [undefined, ''].includes(environment.GITHUB_HEAD_REF),
    );
    requireContext(
      event.ref === 'refs/heads/master' || (eventName === 'workflow_dispatch' && event.ref === 'master'),
    );
    requireContext(
      eventName !== 'push' ||
        (event.before === FAIR_LAUNCH_IMPORT.base && event.after === environment.GITHUB_SHA),
    );
    return {
      kind: 'preserved_source',
      eventName,
      branch: 'master',
      sha: environment.GITHUB_SHA,
      pull: null,
      squashedMaster: true,
      comparisonBaseCommit: FAIR_LAUNCH_IMPORT.base,
    };
  }
  if (eventName === 'pull_request') {
    const match = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/.exec(environment.GITHUB_REF ?? '');
    requireContext(match && event.number === Number(match[1]) && environment.GITHUB_BASE_REF === baseBranch);
    requireContext(event.pull_request?.head?.ref === branch);
    return {
      kind: 'preserved_source',
      eventName,
      branch,
      sha: environment.GITHUB_SHA,
      number: match[1],
      pull: event.pull_request,
    };
  }
  requireContext(
    [undefined, ''].includes(environment.GITHUB_BASE_REF) &&
      [undefined, ''].includes(environment.GITHUB_HEAD_REF),
  );
  requireContext(
    event.ref === `refs/heads/${branch}` || (eventName === 'workflow_dispatch' && event.ref === branch),
  );
  requireContext(eventName !== 'push' || event.after === environment.GITHUB_SHA);
  return { kind: 'preserved_source', eventName, branch, sha: environment.GITHUB_SHA, pull: null };
}

export function verifyPreservedManagementSource(root, context, head, base, recorded) {
  const runGit = (...args) =>
    execFileSync('git', ['-c', 'core.fsmonitor=false', '--no-replace-objects', ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
      },
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const git = (...args) =>
    runGit(...args)
      .toString('utf8')
      .trimEnd();
  requireContext(context.sha === head);
  if (!context.integratedFollowup)
    requireContext(context.squashedMaster ? base === head : base === FAIR_LAUNCH_IMPORT.base);
  for (const field of ['branch', 'commit', 'tree'])
    requireContext(recorded[field] === PRESERVED_MANAGEMENT_SNAPSHOT[field]);
  const followup = context.integratedFollowup
    ? verifyPreservedHostedFollowup(FAIR_LAUNCH_IMPORT, {
        environment: context.environment,
        event: context.event,
        head,
        git,
      })
    : null;
  if (followup) requireContext(followup.masterBase === base && followup.branch === context.branch);
  const sourceHead =
    followup?.sourceHead ??
    (context.squashedMaster
      ? verifyPreservedMasterImport(FAIR_LAUNCH_IMPORT, { head, git }).sourceHead
      : (context.pull?.head?.sha ?? head));
  if (!context.squashedMaster && !followup)
    requireContext(
      git('rev-parse', '--verify', `refs/remotes/origin/${context.branch}^{commit}`) === sourceHead,
    );
  if (context.eventName === 'pull_request' && !followup) {
    requireContext(
      git('rev-parse', '--verify', `refs/remotes/pull/${context.number}/merge^{commit}`) === head,
    );
    requireContext(git('rev-list', '--parents', '--max-count=1', 'HEAD') === `${head} ${base} ${sourceHead}`);
    requireContext(git('rev-parse', 'HEAD^{tree}') === git('rev-parse', `${sourceHead}^{tree}`));
  }
  const commits = git('log', '--format=%H%x00%s%x00%b%x1e', `${FAIR_LAUNCH_IMPORT.base}..${sourceHead}`)
    .split('\x1e')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [sha, subject, body = ''] = row.split('\x00');
      return { sha, subject, body };
    });
  verifyPreservedSourceImport(FAIR_LAUNCH_IMPORT, {
    branch: FAIR_LAUNCH_IMPORT.branch,
    head: sourceHead,
    prTitle: followup ? null : (context.pull?.title ?? null),
    pull: context.pull,
    commits,
    git,
  });
  git('merge-base', '--is-ancestor', PRESERVED_MANAGEMENT_SNAPSHOT.closure, FAIR_LAUNCH_IMPORT.source);
  for (const path of historicalPaths) {
    requireContext(
      git('ls-tree', '-z', 'HEAD', '--', path) ===
        git('ls-tree', '-z', PRESERVED_MANAGEMENT_SNAPSHOT.closure, '--', path),
    );
    requireContext(
      runGit('show', `${PRESERVED_MANAGEMENT_SNAPSHOT.closure}:${path}`).equals(
        boundedFileBytes(resolve(root, path)),
      ),
    );
  }
  return PRESERVED_MANAGEMENT_SNAPSHOT.closure;
}
