import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
  lstatSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const self = fileURLToPath(import.meta.url);
const oid = /^[a-f0-9]{40}$/;
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
const maximumLog = 4 * 1024 * 1024;

function environment(home) {
  return {
    PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HOME: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CEILING_DIRECTORIES: home,
    GIT_TERMINAL_PROMPT: '0',
    npm_config_userconfig: join(home, 'empty.npmrc'),
    npm_config_cache: join(home, 'npm-cache'),
    PYTHONNOUSERSITE: '1',
    LANG: 'C.UTF-8',
  };
}
function source(cwd, home) {
  const git = (...args) =>
    execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], {
      cwd,
      env: environment(home),
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  if (git('rev-parse', '--is-shallow-repository') !== 'false' || git('for-each-ref', 'refs/replace'))
    throw new Error('Incomplete or replaced source history');
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Tracked source is dirty');
  const flags = git('ls-files', '-v', '-z').split('\0').filter(Boolean);
  if (flags.some((entry) => !entry.startsWith('H '))) throw new Error('Hidden or nonstandard index flags');
  const tracked = git('ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean);
  const snapshot = [];
  for (const entry of tracked) {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/);
    if (!match) throw new Error('Unsupported tracked source entry');
    const [, mode, object, path] = match;
    const absolute = join(cwd, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute)
      throw new Error('Tracked source must be a regular file without symlink parents');
    if (Boolean(stat.mode & 0o111) !== (mode === '100755')) throw new Error('Tracked mode mismatch');
    const bytes = readFileSync(absolute);
    // Read the exact Git blob without checkout filters or a weak Node digest.
    const pinnedBytes = execFileSync('/usr/bin/git', ['--no-replace-objects', 'cat-file', 'blob', object], {
      cwd,
      env: environment(home),
      timeout: 10000,
      maxBuffer: Math.max(1, bytes.length),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!bytes.equals(pinnedBytes)) throw new Error('Tracked bytes differ from pinned tree');
    snapshot.push({ path, mode, object });
  }
  return {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    git: git('--version'),
    trackedSnapshotSha256: sha(json(snapshot)),
    baseExists: (base) => {
      if (git('rev-parse', '--verify', `${base}^{commit}`) !== base) throw new Error('Missing base');
      git('merge-base', '--is-ancestor', base, 'HEAD');
    },
  };
}
function aggregate(jobs) {
  for (const state of ['BLOCKED', 'FAIL', 'NOT_RUN']) if (jobs.some((j) => j.state === state)) return state;
  return jobs.length ? 'PASS' : 'BLOCKED';
}
function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    if (e.code === 'EPERM') return true; // Still unconfirmed, including Darwin's terminating-group window.
    throw e;
  }
}
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (e) {
    if (!['ESRCH', 'EPERM'].includes(e.code)) throw e;
    // Permission denial never proves cleanup; the bounded group liveness check must confirm ESRCH.
  }
}
function logRecord(directory, file) {
  const path = join(directory, file);
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Invalid log');
  const bytes = readFileSync(path);
  return { file, bytes: bytes.length, sha256: sha(bytes) };
}
async function execute(job, cwd, directory, home) {
  const result = { id: job.id, state: 'BLOCKED', executableSha256: null };
  if (job.platform !== process.platform || job.arch !== process.arch || process.platform === 'win32')
    return {
      ...result,
      state: 'NOT_RUN',
      reason: 'Native platform or qualified process supervisor unavailable',
    };
  const executable = realpathSync(job.executable);
  result.executableSha256 = sha(readFileSync(executable));
  result.startedAt = new Date().toISOString();
  const names = [`${job.id}.stdout.log`, `${job.id}.stderr.log`];
  const fds = names.map((name) => openSync(join(directory, name), 'wx', 0o600));
  let child,
    timer,
    escalation,
    watchdog,
    exitCode = null,
    signal = null,
    bytes = 0;
  let timedOut = false,
    logFailure = false,
    processFailure = false,
    leftChildren = false;
  let closed = false;
  const terminate = () => {
    if (!child?.pid) return;
    killGroup(child.pid, 'SIGTERM');
    escalation ??= setTimeout(() => killGroup(child.pid, 'SIGKILL'), 150);
  };
  try {
    child = spawn(executable, job.args, {
      cwd,
      env: environment(home),
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    result.pid = child.pid;
    const consume = (fd) => (data) => {
      bytes += data.length;
      if (bytes > maximumLog) {
        logFailure = true;
        terminate();
        return;
      }
      try {
        let offset = 0;
        while (offset < data.length) {
          const written = writeSync(fd, data, offset, data.length - offset);
          if (!Number.isInteger(written) || written <= 0 || written > data.length - offset)
            throw new Error('Incomplete log write');
          offset += written;
        }
      } catch {
        logFailure = true;
        terminate();
      }
    };
    child.stdout.on('data', consume(fds[0]));
    child.stderr.on('data', consume(fds[1]));
    child.on('error', () => {
      processFailure = true;
    });
    child.on('exit', (code, sig) => {
      exitCode = code;
      signal = sig;
      if (child.pid && groupExists(child.pid)) {
        leftChildren = true;
        terminate();
      }
    });
    const completion = new Promise((done) =>
      child.on('close', () => {
        closed = true;
        done();
      }),
    );
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, job.timeoutMs);
    await Promise.race([
      completion,
      new Promise((done) => {
        watchdog = setTimeout(done, job.timeoutMs + 1500);
      }),
    ]);
    if (!closed) {
      processFailure = true;
      terminate();
    }
    if (child.pid) {
      if (groupExists(child.pid)) killGroup(child.pid, 'SIGKILL');
      for (let i = 0; i < 40 && groupExists(child.pid); i++) await delay(25);
      result.cleanup = groupExists(child.pid) ? 'BLOCKED' : 'PASS';
    } else result.cleanup = 'PASS';
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    clearTimeout(watchdog);
    if (child?.pid && groupExists(child.pid)) killGroup(child.pid, 'SIGKILL');
    for (const fd of fds) closeSync(fd);
  }
  Object.assign(result, {
    exitCode,
    signal,
    timedOut,
    leftChildren,
    processFailure,
    logFailure,
    finishedAt: new Date().toISOString(),
    stdout: logRecord(directory, names[0]),
    stderr: logRecord(directory, names[1]),
  });
  result.state =
    processFailure || logFailure || leftChildren || result.cleanup !== 'PASS'
      ? 'BLOCKED'
      : timedOut || signal || exitCode !== 0
        ? 'FAIL'
        : 'PASS';
  return result;
}

// Trusted local commands only: no OS sandbox or independent status signing is provided.
export async function runLocal({ cwd, outputRoot, expected, jobs }) {
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(realpathSync(outputRoot), 'run-'));
  // Keep test-created non-repositories outside the checkout, even when nested
  // commands sanitize away GIT_CEILING_DIRECTORIES themselves.
  const home = mkdtempSync(join(tmpdir(), 'alphaforge-local-ci-'));
  writeFileSync(join(home, 'empty.npmrc'), '', { mode: 0o600 });
  const report = {
    schemaVersion: 1,
    scope: 'trusted-local-only',
    independentAttestation: false,
    directory,
    observedAt: new Date().toISOString(),
    state: 'BLOCKED',
    jobs: [],
    expected,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    executorSha256: sha(readFileSync(self)),
    nodeSha256: sha(readFileSync(process.execPath)),
  };
  try {
    if (
      !expected ||
      ![expected.base, expected.head, expected.tree].every((x) => oid.test(x)) ||
      expected.node !== process.versions.node
    )
      throw new Error('Source or exact Node requirement mismatch');
    if (
      !Array.isArray(jobs) ||
      !jobs.length ||
      jobs.length > 30 ||
      new Set(jobs.map((j) => j.id)).size !== jobs.length
    )
      throw new Error('Nonempty unique jobs required');
    for (const job of jobs) {
      if (
        !identifier.test(job.id) ||
        !isAbsolute(job.executable) ||
        !Array.isArray(job.args) ||
        job.args.some((a) => typeof a !== 'string' || a.includes('\0')) ||
        !Number.isInteger(job.timeoutMs) ||
        job.timeoutMs < 1 ||
        job.timeoutMs > 1200000 ||
        typeof job.platform !== 'string' ||
        typeof job.arch !== 'string'
      )
        throw new Error('Invalid bounded job');
    }
    cwd = realpathSync(cwd);
    const before = source(cwd, home);
    before.baseExists(expected.base);
    if (before.head !== expected.head || before.tree !== expected.tree)
      throw new Error('Stale source identity');
    report.source = {
      base: expected.base,
      head: before.head,
      tree: before.tree,
      git: before.git,
      trackedSnapshotSha256: before.trackedSnapshotSha256,
    };
    report.manifest = jobs;
    report.manifestSha256 = sha(json(jobs));
    for (const job of jobs) report.jobs.push(await execute(job, cwd, directory, home));
    const after = source(cwd, home);
    if (
      before.head !== after.head ||
      before.tree !== after.tree ||
      before.trackedSnapshotSha256 !== after.trackedSnapshotSha256
    )
      throw new Error('Source changed during execution');
    report.state = aggregate(report.jobs);
  } catch (error) {
    report.state = 'BLOCKED';
    report.errorCode = typeof error.code === 'string' ? error.code : 'INTERNAL';
    report.reason = 'Prerequisite, source, process or evidence integrity incomplete';
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  report.finishedAt = new Date().toISOString();
  const bytes = json(report);
  writeFileSync(join(directory, 'report.json'), bytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'report.sha256'), sha(bytes) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

export function verifyRun(directory, expected) {
  try {
    const bytes = readFileSync(join(directory, 'report.json'));
    if (sha(bytes) !== readFileSync(join(directory, 'report.sha256'), 'utf8').trim()) throw new Error();
    const r = JSON.parse(bytes);
    if (
      r.schemaVersion !== 1 ||
      r.scope !== 'trusted-local-only' ||
      r.independentAttestation !== false ||
      JSON.stringify(r.expected) !== JSON.stringify(expected) ||
      r.node !== expected.node ||
      r.source?.head !== expected.head ||
      r.source?.tree !== expected.tree ||
      r.source?.base !== expected.base ||
      !/^[a-f0-9]{64}$/.test(r.source?.trackedSnapshotSha256) ||
      r.executorSha256 !== sha(readFileSync(self)) ||
      r.nodeSha256 !== sha(readFileSync(process.execPath)) ||
      r.manifestSha256 !== sha(json(r.manifest)) ||
      r.jobs.length !== r.manifest.length
    )
      throw new Error();
    if (!['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(r.state)) throw new Error();
    for (const [index, j] of r.jobs.entries()) {
      if (
        !['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(j.state) ||
        !identifier.test(j.id) ||
        j.id !== r.manifest[index].id
      )
        throw new Error();
      if (j.state === 'NOT_RUN') continue;
      const isDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
      if (
        !Number.isInteger(j.pid) ||
        j.pid <= 0 ||
        !isDate(j.startedAt) ||
        !isDate(j.finishedAt) ||
        Date.parse(j.startedAt) > Date.parse(j.finishedAt) ||
        !['PASS', 'BLOCKED'].includes(j.cleanup) ||
        !['timedOut', 'leftChildren', 'processFailure', 'logFailure'].every(
          (key) => typeof j[key] === 'boolean',
        ) ||
        !(j.exitCode === null || (Number.isInteger(j.exitCode) && j.exitCode >= 0 && j.exitCode <= 255)) ||
        !(j.signal === null || (typeof j.signal === 'string' && /^SIG[A-Z0-9]+$/.test(j.signal))) ||
        (j.signal !== null && j.exitCode !== null)
      )
        throw new Error();
      if (
        j.executableSha256 !== sha(readFileSync(realpathSync(r.manifest[index].executable))) ||
        r.manifest[index].platform !== r.platform ||
        r.manifest[index].arch !== r.arch
      )
        throw new Error();
      for (const channel of ['stdout', 'stderr']) {
        const log = j[channel];
        if (
          log.file !== `${j.id}.${channel}.log` ||
          JSON.stringify(logRecord(directory, log.file)) !== JSON.stringify(log)
        )
          throw new Error();
      }
      const actualState =
        j.processFailure || j.logFailure || j.leftChildren || j.cleanup !== 'PASS'
          ? 'BLOCKED'
          : j.timedOut || j.signal || j.exitCode !== 0
            ? 'FAIL'
            : 'PASS';
      if (j.state !== actualState) throw new Error();
    }
    const prerequisiteBlock =
      r.state === 'BLOCKED' &&
      typeof r.reason === 'string' &&
      r.reason.length > 0 &&
      typeof r.errorCode === 'string' &&
      r.errorCode.length > 0;
    if (r.reason !== undefined && !prerequisiteBlock) throw new Error();
    if (aggregate(r.jobs) !== r.state && !prerequisiteBlock) throw new Error();
    return { state: r.state, independentAttestation: false };
  } catch {
    return { state: 'BLOCKED', reason: 'Evidence missing, modified, stale or incomplete' };
  }
}
