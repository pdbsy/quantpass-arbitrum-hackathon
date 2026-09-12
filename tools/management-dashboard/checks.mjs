import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import { sanitizeLog } from './redact.mjs';
import { validateCheckReport } from './schema.mjs';
import { collectGitState as collectRepositoryGitState } from './sources.mjs';

const unitTests = [
  'test/security-model.test.ts',
  'test/engineering.test.ts',
  'test/robinhood-chain.test.ts',
  'test/governance.test.mjs',
  'test/supply-chain.test.mjs',
  'test/threat-model.test.mjs',
  'test/planning.test.mjs',
  'test/domain.test.ts',
  'test/web-messages.test.ts',
  'test/management-dashboard-schema.test.mjs',
  'test/management-dashboard-sources.test.mjs',
  'test/management-dashboard-checks.test.mjs',
  'test/management-dashboard-build.test.mjs',
  'test/management-dashboard-ui.test.mjs',
  'test/management-dashboard-server.test.mjs',
  'test/public-metadata.test.mjs',
];

function executable(id, file, args, timeoutMs, profiles = ['quick', 'full']) {
  return Object.freeze({ id, available: true, file, args: Object.freeze(args), timeoutMs, profiles });
}

function unavailable(id) {
  return Object.freeze({
    id,
    available: false,
    status: 'NOT_RUN',
    reason: 'APPROVED_TOOLCHAIN_NOT_AVAILABLE',
    profiles: Object.freeze(['quick', 'full']),
  });
}

export const CHECK_REGISTRY = Object.freeze([
  executable('typecheck', 'npm', ['run', 'typecheck'], 120_000),
  executable('lint', 'npm', ['run', 'lint'], 120_000),
  executable('format', 'npm', ['run', 'format:check'], 120_000),
  executable('unit', 'node', ['--test', ...unitTests], 180_000),
  executable('integration', 'node', ['--test', 'test/server.test.ts'], 120_000),
  executable('e2e', 'node', ['--test', 'test/http-e2e.test.ts'], 120_000, ['full']),
  executable('secret-scan', 'npm', ['run', 'secrets:check'], 120_000),
  executable('public-metadata', 'npm', ['run', 'privacy:check'], 120_000),
  executable('dependency-audit', 'npm', ['run', 'audit:dependencies'], 180_000, ['full']),
  executable('build', 'npm', ['run', 'build'], 180_000),
  executable('planning-consistency', 'npm', ['run', 'planning:check'], 120_000),
  unavailable('foundry'),
  unavailable('fuzz'),
  unavailable('invariant'),
  unavailable('slither'),
]);

const checksById = new Map(CHECK_REGISTRY.map((check) => [check.id, check]));

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function safeEnvironment() {
  const env = {
    CI: '1',
    LC_ALL: 'C',
    PATH: process.env.PATH,
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

function appendBounded(current, chunk, maximum) {
  if (Buffer.byteLength(current, 'utf8') >= maximum) return current;
  const combined = `${current}${chunk}`;
  if (Buffer.byteLength(combined, 'utf8') <= maximum) return combined;
  return sanitizeLog(combined, { maxBytes: maximum });
}

async function spawnProcess({ file, args, cwd, timeoutMs, maxOutputBytes }) {
  return new Promise((resolveProcess) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(file, args, {
      cwd,
      env: safeEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProcess(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk.toString('utf8'), maxOutputBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk.toString('utf8'), maxOutputBytes);
    });
    child.once('error', () =>
      finish({ exitCode: 127, stdout, stderr: `${stderr}PROCESS_ERROR`, timedOut: false }),
    );
    child.once('close', (code) =>
      finish({ exitCode: timedOut ? 124 : (code ?? 127), stdout, stderr, timedOut }),
    );
  });
}

function iso(clock) {
  return clock().toISOString();
}

function duration(startedAt, finishedAt) {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

function normalizedLog(result, maximum) {
  const parts = [];
  if (result.timedOut) parts.push('TIMEOUT');
  if (result.stdout) parts.push(result.stdout.trimEnd());
  if (result.stderr) parts.push(result.stderr.trimEnd());
  const text = parts.filter(Boolean).join('\n') || '(no output)';
  const sanitized = sanitizeLog(text, { maxBytes: Math.max(1, maximum - 1) });
  return `${sanitized.trimEnd()}\n`;
}

export function parseProfileArgs(args) {
  const profiles = [];
  for (const argument of args) {
    if (!argument.startsWith('--profile=')) throw new Error(`Unknown argument: ${argument}`);
    profiles.push(argument.slice('--profile='.length));
  }
  if (profiles.length > 1) throw new Error('Only one profile may be selected');
  const profile = profiles[0] ?? 'full';
  if (!['quick', 'full'].includes(profile)) throw new Error(`Invalid profile: ${profile}`);
  return profile;
}

export async function runCheck(id, context) {
  const check = checksById.get(id);
  requireCondition(check, `Unknown check: ${id}`);
  requireCondition(/^[0-9a-f]{40}$/.test(context.commit ?? ''), 'Check context requires a full commit hash');
  requireCondition(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(context.runId ?? ''), 'Invalid check run ID');
  const clock = context.clock ?? (() => new Date());
  const startedAt = iso(clock);
  const evidence = `.checks/management/${context.runId}/${check.id}.log`;
  if (!check.available) {
    const finishedAt = iso(clock);
    return {
      record: {
        id: check.id,
        status: 'NOT_RUN',
        startedAt,
        finishedAt,
        durationMs: duration(startedAt, finishedAt),
        exitCode: null,
        reason: check.reason,
      },
      log: `NOT_RUN: ${check.reason}\n`,
    };
  }

  const runProcess = context.runProcess ?? spawnProcess;
  let result;
  try {
    result = await runProcess({
      file: check.file,
      args: [...check.args],
      cwd: context.root,
      timeoutMs: check.timeoutMs,
      maxOutputBytes: context.maxLogBytes ?? 65_536,
    });
  } catch {
    result = { exitCode: 127, stdout: '', stderr: 'PROCESS_ERROR', timedOut: false };
  }
  const finishedAt = iso(clock);
  return {
    record: {
      id: check.id,
      status: result.exitCode === 0 && !result.timedOut ? 'PASS' : 'FAIL',
      startedAt,
      finishedAt,
      durationMs: duration(startedAt, finishedAt),
      exitCode: result.timedOut ? 124 : result.exitCode,
      evidence,
    },
    log: normalizedLog(result, context.maxLogBytes ?? 65_536),
  };
}

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function containedEvidenceDirectory(root, relativeDirectory, options = {}) {
  const realRoot = await realpath(root);
  let current = realRoot;
  for (const component of relativeDirectory.split('/')) {
    requireCondition(
      component === '.checks' || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(component),
      'CHECK_EVIDENCE_PATH_UNSAFE',
    );
    const candidate = resolve(current, component);
    requireCondition(contained(realRoot, candidate), 'CHECK_EVIDENCE_PATH_UNSAFE');
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      requireCondition(error?.code === 'ENOENT' && options.create === true, 'CHECK_EVIDENCE_PATH_UNSAFE');
      try {
        await mkdir(candidate, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      metadata = await lstat(candidate);
    }
    requireCondition(!metadata.isSymbolicLink() && metadata.isDirectory(), 'CHECK_EVIDENCE_PATH_UNSAFE');
    const canonical = await realpath(candidate);
    requireCondition(canonical === candidate && contained(realRoot, canonical), 'CHECK_EVIDENCE_PATH_UNSAFE');
    current = canonical;
  }
  return { directory: current, root: realRoot };
}

async function verifyEvidenceDirectory(realRoot, directory) {
  const metadata = await lstat(directory);
  requireCondition(!metadata.isSymbolicLink() && metadata.isDirectory(), 'CHECK_EVIDENCE_PATH_UNSAFE');
  const canonical = await realpath(directory);
  requireCondition(canonical === directory && contained(realRoot, canonical), 'CHECK_EVIDENCE_PATH_UNSAFE');
}

async function atomicWrite(realRoot, directory, filename, content, beforeRename) {
  requireCondition(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(filename), 'CHECK_EVIDENCE_PATH_UNSAFE');
  await verifyEvidenceDirectory(realRoot, directory);
  const path = resolve(directory, filename);
  requireCondition(dirname(path) === directory && contained(realRoot, path), 'CHECK_EVIDENCE_PATH_UNSAFE');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (beforeRename) await beforeRename();
    await verifyEvidenceDirectory(realRoot, directory);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function requireCleanGitState(state, errorCode) {
  requireCondition(state?.status === 'READY', errorCode);
  requireCondition(/^[0-9a-f]{40}$/.test(state.commit ?? ''), errorCode);
  requireCondition(/^[0-9a-f]{40}$/.test(state.tree ?? ''), errorCode);
  requireCondition(
    typeof state.branch === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(state.branch) &&
      !state.branch.includes('..') &&
      !state.branch.includes('@{'),
    errorCode,
  );
  requireCondition(state.dirtyFiles === 0, errorCode);
  return state;
}

function requireUnchangedGitState(initial, current) {
  requireCleanGitState(current, 'CHECK_GIT_CHANGED_DURING_RUN');
  requireCondition(current.commit === initial.commit, 'CHECK_GIT_CHANGED_DURING_RUN');
  requireCondition(current.tree === initial.tree, 'CHECK_GIT_CHANGED_DURING_RUN');
  requireCondition(current.branch === initial.branch, 'CHECK_GIT_CHANGED_DURING_RUN');
}

export async function runChecks(context) {
  const profile = context.profile ?? 'full';
  requireCondition(['quick', 'full'].includes(profile), `Invalid profile: ${profile}`);
  requireCondition(typeof context.root === 'string' && context.root.length > 0, 'Check root is required');
  const collectGit = context.collectGitState ?? collectRepositoryGitState;
  const initialGit = requireCleanGitState(await collectGit(context.root, 'master'), 'CHECK_GIT_NOT_CLEAN');
  if (context.commit !== undefined)
    requireCondition(context.commit === initialGit.commit, 'CHECK_GIT_COMMIT_MISMATCH');
  const clock = context.clock ?? (() => new Date());
  const runId =
    context.runId ?? `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${initialGit.commit.slice(0, 12)}`;
  requireCondition(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(runId), 'Invalid check run ID');
  const evidenceDirectory = await containedEvidenceDirectory(context.root, `.checks/management/${runId}`, {
    create: true,
  });
  const managementDirectory = dirname(evidenceDirectory.directory);
  await verifyEvidenceDirectory(evidenceDirectory.root, managementDirectory);
  const startedAt = iso(clock);
  const selected = CHECK_REGISTRY.filter((check) => check.profiles.includes(profile));
  const records = [];
  const logs = [];
  for (const check of selected) {
    const result = await runCheck(check.id, { ...context, commit: initialGit.commit, clock, runId });
    records.push(result.record);
    logs.push({ id: check.id, text: result.log });
    requireUnchangedGitState(initialGit, await collectGit(context.root, 'master'));
  }
  const finishedAt = iso(clock);
  const report = {
    schemaVersion: 1,
    complete: true,
    profile,
    branch: initialGit.branch,
    commit: initialGit.commit,
    tree: initialGit.tree,
    startedAt,
    finishedAt,
    checks: records,
  };
  validateCheckReport(report);

  for (const log of logs)
    await atomicWrite(evidenceDirectory.root, evidenceDirectory.directory, `${log.id}.log`, log.text);
  await atomicWrite(
    evidenceDirectory.root,
    managementDirectory,
    'latest.json',
    `${JSON.stringify(report, null, 2)}\n`,
    async () => {
      const finalGit = await collectGit(context.root, 'master');
      requireUnchangedGitState(initialGit, finalGit);
    },
  );
  return report;
}
