import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildForumSnapshot, recordsFromPullRequests } from './agent-forum.mjs';
import { build } from './build-agent-forum.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshotPath = resolve(root, 'docs/management/agents/forum-snapshot.json');
const MAX_RECORDS = 500;

export function parseGithubRemote(remote) {
  if (remote === 'git@github.com:pdbsy/quantpass-arbitrum-hackathon.git')
    return 'pdbsy/quantpass-arbitrum-hackathon';
  if (remote === 'https://github.com/pdbsy/quantpass-arbitrum-hackathon.git')
    return 'pdbsy/quantpass-arbitrum-hackathon';
  throw new Error('origin is not the configured AlphaForge GitHub repository');
}

export function createFailureSnapshot(previous, message) {
  if (typeof message !== 'string' || !message || message.length > 200)
    throw new Error('failure message must be bounded');
  return {
    schema_version: 1,
    source: { state: 'ERROR', error: message, last_sync_at: previous?.source?.last_sync_at ?? null },
    messages: Array.isArray(previous?.messages) ? previous.messages : [],
    threads: Array.isArray(previous?.threads) ? previous.threads : [],
  };
}

function apiJson(endpoint, jq) {
  const text = execFileSync('gh', ['api', endpoint, '--jq', jq], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const value = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('unexpected GitHub response');
  return value;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(snapshotPath, 'utf8'));
  } catch {
    return null;
  }
}

export async function sync() {
  const previous = await readPrevious();
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const repository = parseGithubRemote(remote);
    const pulls = apiJson(
      `repos/${repository}/pulls?state=all&per_page=100&page=1`,
      '[.[:100][] | {number,html_url,title,body,created_at,updated_at,user:{login:.user.login},head:{ref:.head.ref,repo:{full_name:.head.repo.full_name}}}]',
    );
    let remaining = Math.max(0, MAX_RECORDS - pulls.length);
    for (const pull of pulls) {
      pull.comments = [];
      pull.reviews = [];
      if (!remaining) continue;
      pull.comments = apiJson(
        `repos/${repository}/issues/${pull.number}/comments?per_page=100&page=1`,
        '[.[:100][] | {html_url,body,created_at,updated_at,user:{login:.user.login}}]',
      ).slice(0, remaining);
      remaining -= pull.comments.length;
      if (!remaining) continue;
      pull.reviews = apiJson(
        `repos/${repository}/pulls/${pull.number}/reviews?per_page=100&page=1`,
        '[.[:100][] | {html_url,body,submitted_at,user:{login:.user.login}}]',
      ).slice(0, remaining);
      remaining -= pull.reviews.length;
    }
    const snapshot = buildForumSnapshot(recordsFromPullRequests(pulls), {
      syncedAt: new Date().toISOString(),
    });
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    await build();
    console.log(
      `Agent Forum synced: ${snapshot.messages.length} messages across ${snapshot.threads.length} threads.`,
    );
    return snapshot;
  } catch {
    const failed = createFailureSnapshot(previous, 'GitHub source unavailable');
    await writeFile(snapshotPath, JSON.stringify(failed, null, 2) + '\n', 'utf8');
    await build();
    throw new Error('Agent Forum sync failed; previous trusted snapshot retained');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await sync();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
