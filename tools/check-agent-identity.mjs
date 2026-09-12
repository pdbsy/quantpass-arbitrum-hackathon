import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateCommitSetIdentity } from './agent-identity-set.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
function eventPayload() {
  try {
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    return {};
  }
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
  const branch =
    argument('branch') ||
    process.env.GITHUB_HEAD_REF ||
    event.ref?.replace('refs/heads/', '') ||
    git('branch', '--show-current');
  const head = argument('head') || event.pull_request?.head?.sha || event.after || 'HEAD';
  let base = argument('base') || event.pull_request?.base?.sha || event.before;
  if (base && /^0+$/.test(base)) base = git('merge-base', 'origin/master', head);
  const prTitle = argument('pr-title') || event.pull_request?.title || null;
  const indicatesWorker = /^macbeth0[1-5]\//.test(branch) || /\[Macbeth0[1-5]\]/.test(prTitle || '');
  if (!base) {
    if (indicatesWorker) throw new Error('A base SHA is required for worker identity validation');
    console.log(`Agent identity check skipped for non-worker branch: ${branch || 'detached'}`);
    return;
  }
  const commits = commitsInRange(base, head);
  const result = validateCommitSetIdentity({ branch, prTitle, commits });
  if (result.skipped) {
    console.log(`Agent identity check skipped for non-worker branch: ${branch || 'detached'}`);
    return;
  }
  for (const commit of commits) console.log(`Verified ${commit.sha.slice(0, 12)} for ${branch}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
