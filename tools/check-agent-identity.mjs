import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { agentForBranch, MANAGER_INTEGRATIONS } from './agent-identity.mjs';
import { validateCommitSetIdentity } from './agent-identity-set.mjs';
import {
  FAIR_LAUNCH_IMPORT,
  verifyPreservedSourceImport,
  verifyPreservedMasterImport,
  verifyPreservedHostedFollowup,
} from './preserved-source-identity.mjs';
import { CANONICAL_REPOSITORY, hostedRepositoryMatches } from './environment/policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function eventPayload() {
  if (!process.env.GITHUB_EVENT_PATH) return {};
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid GitHub event');
  return event;
}
function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
export function commitsInRange(base, head) {
  const output = git('--no-replace-objects', 'log', '--format=%H%x00%s%x00%b%x1e', `${base}..${head}`);
  if (!output) return [];
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ''] = record.split('\x00');
      return { sha, subject, body };
    });
}
export function check() {
  const event = eventPayload();
  const eventName = process.env.GITHUB_EVENT_NAME || 'local';
  const pull = eventName === 'pull_request' ? event.pull_request : null;
  const group = eventName === 'merge_group' ? event.merge_group : null;
  if (eventName === 'pull_request' && (!pull?.head?.ref || !pull.head.sha || !pull.base?.sha))
    throw new Error('Incomplete pull_request identity context');
  if (
    eventName === 'merge_group' &&
    (!group?.head_sha ||
      !group.base_sha ||
      group.base_ref !== 'refs/heads/master' ||
      !group.head_ref?.startsWith('refs/heads/gh-readonly-queue/master/'))
  )
    throw new Error('Invalid protected merge_group context');
  const ref = pull?.head?.ref || group?.base_ref || event.ref || process.env.GITHUB_REF;
  const branch = argument('branch') || ref?.replace(/^refs\/heads\//, '') || git('branch', '--show-current');
  const head =
    argument('head') || pull?.head?.sha || group?.head_sha || event.after || process.env.GITHUB_SHA || 'HEAD';
  let base = argument('base') || pull?.base?.sha || group?.base_sha || event.before;
  if (!base || /^0+$/.test(base)) {
    base = agentForBranch(branch) ? git('merge-base', 'origin/master', head) : git('rev-parse', `${head}^`);
  }
  const prTitle = argument('pr-title') || pull?.title || null;
  if (!pull && branch === 'master' && commitsInRange(base, head).length === 0)
    throw new Error('Invalid protected target range');
  const hostedCheckout =
    !group &&
    process.env.GITHUB_ACTIONS === 'true' &&
    ['push', 'workflow_dispatch', 'pull_request'].includes(eventName)
      ? git('--no-replace-objects', 'rev-parse', '--verify', 'HEAD^{commit}')
      : null;
  let integratedFollowup = false;
  if (hostedCheckout && hostedCheckout !== FAIR_LAUNCH_IMPORT.integration.commit) {
    try {
      git(
        '--no-replace-objects',
        'merge-base',
        '--is-ancestor',
        FAIR_LAUNCH_IMPORT.integration.commit,
        hostedCheckout,
      );
      integratedFollowup = true;
    } catch {
      // Unrelated historical fixtures and original source imports use their
      // existing admission paths; they cannot qualify as anchored follow-ups.
    }
  }
  if (integratedFollowup) {
    const result = verifyPreservedHostedFollowup(FAIR_LAUNCH_IMPORT, {
      environment: process.env,
      event,
      head: hostedCheckout,
      git,
    });
    if (
      branch !== result.branch ||
      git('--no-replace-objects', 'rev-parse', '--verify', `${head}^{commit}`) !== result.candidate ||
      ((argument('base') || pull || branch === 'master') &&
        git('--no-replace-objects', 'rev-parse', '--verify', `${base}^{commit}`) !== result.base) ||
      prTitle !== (pull?.title ?? null)
    )
      throw new Error('Preserved follow-up rejects overridden branch, revisions, or title');
    console.log(
      `Integration anchor ${result.integrationHead} verified; ordinary ${eventName} identity: ${result.ordinary.verified} worker provenance record(s)`,
    );
    return;
  }
  const masterHead =
    !group && branch === 'master'
      ? git('--no-replace-objects', 'rev-parse', '--verify', `${head}^{commit}`)
      : null;
  const checkoutHead =
    !group && (branch === 'master' || process.env.GITHUB_REF === 'refs/heads/master')
      ? git('--no-replace-objects', 'rev-parse', '--verify', 'HEAD^{commit}')
      : null;
  const firstSquashParent = (candidate) =>
    candidate &&
    git('--no-replace-objects', 'rev-list', '--parents', '--max-count=1', candidate) ===
      `${candidate} ${FAIR_LAUNCH_IMPORT.base}`;
  if (
    !group &&
    ((branch === 'master' && base === FAIR_LAUNCH_IMPORT.base) ||
      firstSquashParent(masterHead) ||
      firstSquashParent(checkoutHead))
  ) {
    const exactHead = masterHead;
    if (
      branch !== 'master' ||
      exactHead !== checkoutHead ||
      base !== FAIR_LAUNCH_IMPORT.base ||
      !['push', 'workflow_dispatch'].includes(eventName) ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REF !== 'refs/heads/master' ||
      process.env.GITHUB_SHA !== exactHead ||
      (event.ref !== 'refs/heads/master' && !(eventName === 'workflow_dispatch' && event.ref === 'master')) ||
      process.env.GITHUB_REPOSITORY !== CANONICAL_REPOSITORY ||
      !hostedRepositoryMatches(CANONICAL_REPOSITORY, process.env.GITHUB_REPOSITORY_ID) ||
      event.repository?.full_name !== CANONICAL_REPOSITORY ||
      !hostedRepositoryMatches(CANONICAL_REPOSITORY, event.repository?.id) ||
      (eventName === 'push' && (event.before !== FAIR_LAUNCH_IMPORT.base || event.after !== exactHead))
    )
      throw new Error('Preserved master import requires canonical hosted master context');
    const result = verifyPreservedMasterImport(FAIR_LAUNCH_IMPORT, { head: exactHead, git });
    console.log(
      `Preserved master identity: ${result.preserved} original commits retained at ${result.sourceHead}; exact first squash verified`,
    );
    return;
  }
  if (!group && branch === FAIR_LAUNCH_IMPORT.branch) {
    const exactHead = git('--no-replace-objects', 'rev-parse', '--verify', `${head}^{commit}`);
    const result = verifyPreservedSourceImport(FAIR_LAUNCH_IMPORT, {
      branch,
      head: exactHead,
      prTitle,
      pull,
      commits: commitsInRange(FAIR_LAUNCH_IMPORT.base, exactHead),
      git,
    });
    console.log(
      `Preserved source identity: ${result.preserved} original commits; ${result.added} ordinary task commits`,
    );
    return;
  }
  if (group) {
    // The approved integration mode has no authenticated queue PR/source binding.
    // Reject introducing its history, including a subsequently deleted manifest.
    // Ordinary queued changes after an already integrated base stay unaffected.
    const range = commitsInRange(group.base_sha, group.head_sha);
    const manifestHistory = git(
      'log',
      '--format=%H',
      `${group.base_sha}..${group.head_sha}`,
      '--',
      ...MANAGER_INTEGRATIONS.map(({ task }) => `docs/management/agents/integrations/${task}.json`),
    );
    if (
      manifestHistory ||
      range.some((commit) => commit.sha === FAIR_LAUNCH_IMPORT.source) ||
      range.some((commit) =>
        MANAGER_INTEGRATIONS.some(
          ({ task }) =>
            commit.body.split(/\r?\n/).some((line) => line.match(/^Task-ID:\s*(\S+)\s*$/i)?.[1] === task) ||
            commit.subject.includes(`[${task}]`),
        ),
      )
    )
      throw new Error('Integration merge queue is not authorized without trusted PR/source binding');
  }
  if (MANAGER_INTEGRATIONS.some((profile) => profile.branch === branch)) {
    if (
      pull &&
      (pull.head.ref !== branch ||
        pull.base.ref !== 'master' ||
        pull.head.repo?.full_name !== 'pdbsy/quantpass-arbitrum-hackathon' ||
        pull.base.repo?.full_name !== 'pdbsy/quantpass-arbitrum-hackathon')
    )
      throw new Error('Integration requires canonical head/base repository and refs');
    const exactHead = git('rev-parse', '--verify', `${head}^{commit}`);
    return import('./agent-integration-identity.mjs').then(({ verifyManagerIntegration }) => {
      const result = verifyManagerIntegration(root, {
        branch,
        head: exactHead,
        prTitle,
        pullBase: pull?.base ?? null,
      });
      console.log(
        `Integration identity: ${result.verified} records verified; ${result.imported} original source records and ${result.manager} manager records`,
      );
    });
  }
  const commits = commitsInRange(base, head);
  const result = validateCommitSetIdentity({
    branch,
    prTitle,
    commits,
    protectedTarget: !pull && branch === 'master',
  });
  if (result.skipped) {
    console.log(`Agent identity check skipped for non-worker branch: ${branch || 'detached'}`);
    return;
  }
  for (const commit of commits) console.log(`Verified ${commit.sha.slice(0, 12)} for ${branch}`);
  console.log(`Identity lifecycle ${eventName}: ${result.verified} worker provenance record(s) verified`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await check();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
