import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MANAGER_INTEGRATIONS,
  agentForBranch,
  taskMatchesAgent,
  validateCommitIdentity,
  validateCommitProvenance,
} from './agent-identity.mjs';

export const MANAGER_INTEGRATION_BRANCH = 'macbeth01/AF-M3-CLOSEOUT';
const repository = 'pdbsy/quantpass-arbitrum-hackathon';
const shaPattern = /^[a-f0-9]{40}$/;
function requireValue(condition, label) {
  if (!condition) throw new Error(`Integration identity rejected: ${label}`);
}

// Source refs and exact Git objects bind attribution. This is process provenance,
// not an independent approval or an access-control boundary against code changes.
export function verifyManagerIntegration(root, { branch, head, prTitle = null, pullBase = null }) {
  return verifyIntegration(root, { branch, head, prTitle, pullBase }, false);
}

// Explicit offline provenance only. Never selected from hosted options or a manifest fallback.
export function verifyLocalManagerIntegration(root, { branch, head, base }) {
  requireValue(
    !Object.keys(process.env).some((key) => /^(GITHUB_|ACTIONS_|RUNNER_)/.test(key)),
    'LOCAL entry cannot run in hosted context',
  );
  requireValue(branch === 'macbeth01/m3-phase1-closeout', 'unregistered LOCAL integration branch');
  requireValue(shaPattern.test(base), 'LOCAL requires exact explicit base');
  return {
    ...verifyIntegration(root, { branch, head, base, prTitle: null, pullBase: null }, true),
    scope: 'LOCAL',
    githubStatus: false,
    independentAttestation: false,
  };
}

function verifyIntegration(root, { branch, head, base, prTitle, pullBase }, local) {
  const profile = local
    ? { branch: 'macbeth01/m3-phase1-closeout', task: 'M3-01-PHASE1-CLOSEOUT' }
    : MANAGER_INTEGRATIONS.find((entry) => entry.branch === branch);
  requireValue(profile, 'unregistered integration branch');
  const { task } = profile;
  const manifestPath = `docs/management/agents/integrations/${task}${local ? '.local' : ''}.json`;
  const localEnvironment = { ...process.env };
  for (const key of Object.keys(localEnvironment)) if (key.startsWith('GIT_')) delete localEnvironment[key];
  Object.assign(localEnvironment, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  });
  const git = (...args) =>
    execFileSync('git', local ? ['--no-replace-objects', ...args] : args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      ...(local ? { env: localEnvironment, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] } : {}),
    }).trim();
  const exact = (ref) => {
    const value = git('rev-parse', '--verify', `${ref}^{commit}`);
    requireValue(shaPattern.test(value), 'invalid commit');
    return value;
  };
  const ancestor = (parent, child) => {
    try {
      git('merge-base', '--is-ancestor', parent, child);
    } catch {
      throw new Error('Integration identity rejected: missing required ancestry');
    }
  };
  const commits = (base, end) => {
    const output = git('log', '--format=%H%x00%s%x00%b%x1e', `${base}..${end}`);
    return output
      .split('\x1e')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, subject, body = ''] = record.split('\0');
        return { sha, subject, body };
      });
  };
  requireValue(shaPattern.test(head), 'head must be an exact SHA');
  if (local) {
    requireValue(git('rev-parse', '--is-shallow-repository') === 'false', 'LOCAL requires complete history');
    requireValue(!git('for-each-ref', 'refs/replace'), 'LOCAL rejects replace refs');
    requireValue(
      !existsSync(resolve(root, git('rev-parse', '--git-path', 'info/grafts'))),
      'LOCAL rejects grafts',
    );
  }
  const origin = git('remote', 'get-url', 'origin');
  requireValue(
    [
      `git@github.com:${repository}.git`,
      `https://github.com/${repository}.git`,
      `https://github.com/${repository}`,
    ].includes(origin),
    'canonical origin required',
  );
  const serialized = git('show', `${head}:${manifestPath}`);
  requireValue(Buffer.byteLength(serialized) <= 64 * 1024, 'oversized source manifest');
  const manifest = JSON.parse(serialized);
  requireValue(
    manifest?.schema_version === 1 &&
      manifest.repository === repository &&
      manifest.branch === branch &&
      manifest.task === task,
    'invalid manifest identity',
  );
  requireValue(
    local ? manifest.provider === 'LOCAL' : manifest.provider === undefined,
    'invalid manifest provider',
  );
  requireValue(shaPattern.test(manifest.base), 'invalid fixed base');
  if (local) requireValue(manifest.base === base && exact(base) === base, 'LOCAL fixed base mismatch');
  else requireValue(manifest.base === exact('refs/remotes/origin/master'), 'master moved from fixed base');
  if (pullBase)
    requireValue(pullBase.ref === 'master' && pullBase.sha === manifest.base, 'PR must target fixed master');
  ancestor(manifest.base, head);
  requireValue(
    Array.isArray(manifest.sources) && manifest.sources.length >= 4 && manifest.sources.length <= 12,
    'bounded registered sources required',
  );
  const sourceKeys = new Set();
  const sourceHeads = new Set();
  const ranges = [];
  const imported = new Map();
  for (const source of manifest.sources) {
    requireValue(
      source &&
        typeof source === 'object' &&
        typeof source.branch === 'string' &&
        source.branch.length <= 180 &&
        (task === 'M3-01-PHASE1-CLOSEOUT'
          ? /^macbeth0[1-6]\/[A-Za-z0-9][A-Za-z0-9/_-]*$/
          : /^macbeth0[1-5]\/[A-Za-z0-9][A-Za-z0-9/_-]*$/
        ).test(source.branch),
      'invalid source branch',
    );
    if (source.agent === 'Macbeth06')
      requireValue(
        task === 'M3-01-PHASE1-CLOSEOUT' && source.task === 'M3-06-CI-GATES',
        '06 source outside assigned scope',
      );
    requireValue(
      source.branch !== branch &&
        agentForBranch(source.branch) === source.agent &&
        taskMatchesAgent(source.task, source.agent),
      'invalid source owner/task',
    );
    requireValue(
      shaPattern.test(source.head) && !sourceKeys.has(source.branch) && !sourceHeads.has(source.head),
      'duplicate or invalid source',
    );
    sourceKeys.add(source.branch);
    sourceHeads.add(source.head);
    ancestor(manifest.base, source.head);
    ancestor(source.head, head);
    if (local) {
      const suffix = source.branch.slice(source.branch.indexOf('/') + 1);
      const ref = `refs/remotes/local-${source.agent.toLowerCase()}/${suffix}`;
      requireValue(source.local_ref === ref, 'invalid explicit local ref');
      git('check-ref-format', ref);
      let symbolic = false;
      try {
        git('symbolic-ref', '-q', ref);
        symbolic = true;
      } catch (error) {
        if (error.status !== 1) throw error;
      }
      requireValue(!symbolic, 'symbolic local ref rejected');
      requireValue(exact(ref) === source.head, 'local ref must equal pinned source head');
    } else {
      requireValue(source.local_ref === undefined, 'LOCAL source forbidden in hosted manifest');
      ancestor(source.head, exact(`refs/remotes/origin/${source.branch}`));
    }
    const range = commits(manifest.base, source.head);
    requireValue(range.length > 0, 'empty source range');
    const tip = range.find((commit) => commit.sha === source.head);
    const tipIdentity = validateCommitProvenance(tip ?? {});
    requireValue(
      tipIdentity.agentId === source.agent && tipIdentity.taskId === source.task,
      'source tip attribution mismatch',
    );
    ranges.push(range);
    for (const commit of range) {
      const identity = validateCommitProvenance(commit);
      if (identity.agentId === source.agent && identity.taskId === source.task) {
        validateCommitIdentity({ branch: source.branch, subject: commit.subject, body: commit.body });
        imported.set(commit.sha, identity);
      }
    }
  }
  for (const agent of ['Macbeth02', 'Macbeth03', 'Macbeth04', 'Macbeth05'])
    requireValue(
      manifest.sources.some((source) => source.agent === agent),
      `missing ${agent} source`,
    );
  // A stacked source may contain another worker only through that worker's
  // independently pinned source range; a foreign commit cannot launder itself.
  for (const range of ranges)
    for (const commit of range)
      requireValue(imported.has(commit.sha), 'source contains unregistered provenance');
  const candidate = commits(manifest.base, head);
  requireValue(candidate.length > 0, 'empty candidate');
  let managerCount = 0;
  for (const commit of candidate) {
    if (imported.has(commit.sha)) continue;
    const identity = validateCommitIdentity({ branch, prTitle, subject: commit.subject, body: commit.body });
    requireValue(identity.taskId === task, 'manager addition has wrong task');
    managerCount += 1;
  }
  requireValue(managerCount > 0, 'manager closeout commit required');
  return { skipped: false, verified: candidate.length, imported: imported.size, manager: managerCount };
}
