import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { agentForBranch } from './agent-identity.mjs';
import { validateCommitSetIdentity } from './agent-identity-set.mjs';

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
  const output = git('log', '--format=%H%x00%s%x00%b%x1e', `${base}..${head}`);
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
    check();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
