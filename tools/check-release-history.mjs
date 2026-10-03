import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '3cb9caa810e34d8ff9f9a6c68b5ef674f489689e';
const branch = 'codex/alphaforge-release-integration-20261003';
const workers = ['W1', 'W2', 'W3', 'W4'];
const commit = /^[a-f0-9]{40}$/;

function git(directory, ...args) {
  return execFileSync(
    'git',
    ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
    {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      maxBuffer: 65_536,
    },
  ).trim();
}

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function ancestor(directory, older, newer, code) {
  try {
    git(directory, 'merge-base', '--is-ancestor', older, newer);
  } catch {
    throw new Error(code);
  }
}

export function verifyReleaseHistory({ root: directory, base: baseline, head, sources }) {
  requireCondition(commit.test(baseline) && commit.test(head), 'EXACT_COMMIT_REQUIRED');
  requireCondition(
    git(directory, 'rev-parse', '--is-shallow-repository') === 'false',
    'FULL_HISTORY_REQUIRED',
  );
  requireCondition(
    Array.isArray(sources) &&
      sources.length === 4 &&
      new Set(sources.map((source) => source?.head)).size === 4 &&
      sources.every(
        (source, index) =>
          source?.worker === workers[index] && commit.test(source.head) && source.head !== baseline,
      ),
    'FOUR_EXACT_WORKER_HEADS_REQUIRED',
  );
  ancestor(directory, baseline, head, 'CANDIDATE_BASE_MISMATCH');
  for (const source of sources) {
    ancestor(directory, baseline, source.head, 'SOURCE_BASE_MISMATCH');
    ancestor(directory, source.head, head, 'SOURCE_NOT_IN_CANDIDATE');
  }
  return Object.freeze({ state: 'EXACT_SOURCE_HISTORY_VERIFIED', sources: 4, independentApproval: false });
}

export function releaseHistoryCli(args = process.argv.slice(2)) {
  try {
    requireCondition(args.length === 0, 'RELEASE_HISTORY_USAGE');
    requireCondition(git(root, 'branch', '--show-current') === branch, 'RELEASE_BRANCH_REQUIRED');
    requireCondition(git(root, 'rev-parse', 'refs/evidence/release-base') === base, 'RETAINED_BASE_REQUIRED');
    const sources = workers.map((worker) => ({
      worker,
      head: git(root, 'rev-parse', '--verify', `refs/evidence/release-${worker.toLowerCase()}^{commit}`),
    }));
    const head = git(root, 'rev-parse', '--verify', 'HEAD^{commit}');
    console.log(
      JSON.stringify({
        ...verifyReleaseHistory({ root, base, head, sources }),
        base,
        head,
        workers: sources,
      }),
    );
    return 0;
  } catch {
    console.error(
      'RELEASE_HISTORY_BLOCKED: require full history, retained exact worker heads and an integrated candidate; no approval inferred.',
    );
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = releaseHistoryCli();
