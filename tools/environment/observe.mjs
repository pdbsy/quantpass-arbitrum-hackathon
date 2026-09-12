import { spawnSync } from 'node:child_process';
import {
  openSync,
  closeSync,
  readSync,
  fstatSync,
  constants,
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch, devNull } from 'node:os';
import {
  CONFIG,
  overrideKinds,
  validateInputs,
  evaluate,
  nativePackagesValid,
  unsafeGitConfig,
} from './policy.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = /^[a-f0-9]{40}$/;
export function boundedRead(path, max = 1024 * 1024) {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(max))
    throw new Error('Environment input unavailable');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = fstatSync(fd, { bigint: true });
    if (!current.isFile() || current.ino !== stat.ino || current.dev !== stat.dev)
      throw new Error('Environment input unavailable');
    const bytes = Buffer.alloc(max + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, null);
      if (!count) break;
      total += count;
    }
    if (total > max) throw new Error('Environment input unavailable');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total));
  } finally {
    closeSync(fd);
  }
}

export function readInputs(root) {
  root = realpathSync(root);
  for (const path of [
    '.node-version',
    'package.json',
    'package-lock.json',
    'planning/development-environment.json',
    'planning/supply-chain-policy.json',
  ])
    if (realpathSync(join(root, path)) !== join(root, path)) throw new Error('Environment input unavailable');
  const json = (path) => JSON.parse(boundedRead(join(root, path)));
  const lockText = boundedRead(join(root, 'package-lock.json'));
  return validateInputs({
    node: boundedRead(join(root, '.node-version')).trim(),
    package: json('package.json'),
    lock: JSON.parse(lockText),
    lockText,
    policy: json('planning/development-environment.json'),
    supply: json('planning/supply-chain-policy.json'),
  });
}
export function npmCli() {
  const base = dirname(realpathSync(process.execPath));
  const candidates = [
    join(base, '../lib/node_modules/npm/bin/npm-cli.js'),
    join(base, 'node_modules/npm/bin/npm-cli.js'),
  ];
  const candidate = candidates.find(existsSync);
  if (!candidate) throw new Error('Exact npm runtime unavailable');
  return realpathSync(candidate);
}
export function gitIdentity(git, event) {
  const identity = {
    head: null,
    tree: null,
    base: null,
    sourceHead: null,
    sourceTree: null,
    context: event.event || 'local',
    historyValid: false,
  };
  try {
    identity.head = git(['rev-parse', '--verify', 'HEAD']);
    identity.tree = git(['rev-parse', '--verify', 'HEAD^{tree}']);
    identity.base = git(['rev-parse', '--verify', 'refs/remotes/origin/master^{commit}']);
    identity.sourceHead = identity.head;
    identity.sourceTree = identity.tree;
    if (git(['rev-parse', '--is-shallow-repository']) !== 'false') return identity;
    if (![identity.head, identity.tree, identity.base].every((s) => sha.test(s))) return identity;
    if (event.event) {
      if (event.repository !== 'pdbsy/quantpass-arbitrum-hackathon' || event.sha !== identity.head)
        return identity;
      if (event.event === 'pull_request' || event.event === 'merge_group') {
        if (!sha.test(event.head) || !sha.test(event.base)) return identity;
        const parents = git(['show', '--no-patch', '--format=%P', 'HEAD']).split(' ');
        if (
          event.event === 'pull_request' &&
          (!/^refs\/pull\/[1-9][0-9]*\/merge$/.test(event.ref) ||
            parents.length !== 2 ||
            parents[0] !== event.base ||
            parents[1] !== event.head)
        )
          return identity;
        if (
          event.event === 'merge_group' &&
          (!/^refs\/heads\/gh-readonly-queue\/master\//.test(event.ref) || event.head !== identity.head)
        )
          return identity;
        git(['cat-file', '-e', event.base + '^{commit}']);
        git(['merge-base', '--is-ancestor', event.base, identity.head]);
        identity.base = event.base;
        identity.sourceHead = event.head;
        identity.sourceTree = git(['rev-parse', '--verify', event.head + '^{tree}']);
      } else if (['push', 'workflow_dispatch'].includes(event.event)) {
        if (!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(event.ref)) return identity;
        const ref = git(['rev-parse', '--verify', event.ref + '^{commit}']);
        if (ref !== identity.head) return identity;
      } else return identity;
    } else {
      if (!git(['branch', '--show-current'])) return identity;
    }
    git(['merge-base', '--is-ancestor', identity.base, identity.head]);
    identity.historyValid = true;
  } catch {
    identity.historyValid = false;
  }
  return identity;
}
function githubEvent(env) {
  if (env.GITHUB_ACTIONS !== 'true') return { event: null };
  const event = {
    event: env.GITHUB_EVENT_NAME,
    sha: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
  };
  try {
    const data = JSON.parse(boundedRead(env.GITHUB_EVENT_PATH));
    if (event.event === 'pull_request') {
      if (
        data.pull_request?.base?.repo?.full_name !== event.repository ||
        data.pull_request?.base?.ref !== 'master' ||
        data.pull_request?.head?.repo?.full_name !== event.repository
      )
        return { ...event, repository: null };
      event.head = data.pull_request.head.sha;
      event.base = data.pull_request.base.sha;
    }
    if (event.event === 'merge_group') {
      event.head = data.merge_group?.head_sha;
      event.base = data.merge_group?.base_sha;
    }
  } catch {
    event.repository = null;
  }
  return event;
}
function filesValid(root, git) {
  try {
    const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
    if (files.length > 4096) return false;
    const seen = new Set();
    let total = 0;
    for (const path of files) {
      const normalized = path.normalize('NFC').toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      const target = resolve(root, path);
      if (!target.startsWith(root + sep) || realpathSync(target) !== target) return false;
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return false;
      total += stat.size;
      if (total > 32 * 1024 * 1024) return false;
      const bytes = readFileSync(target);
      if (bytes.includes(0)) continue;
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (bytes.includes(13)) return false;
    }
    return (
      boundedRead(join(root, '.gitattributes')).trim() === '* text=auto eol=lf' &&
      boundedRead(join(root, '.editorconfig')).includes('end_of_line = lf')
    );
  } catch {
    return false;
  }
}
export function dataRootIsolated(root) {
  try {
    root = realpathSync(root);
    const data = join(root, '.data');
    if (!existsSync(data)) return true;
    let entries = 0;
    const inspect = (path, depth) => {
      if (++entries > 1024 || depth > 8) return false;
      const st = lstatSync(path);
      if (st.isSymbolicLink() || realpathSync(path) !== path) return false;
      if (st.isFile()) return st.nlink === 1;
      return st.isDirectory() && readdirSync(path).every((name) => inspect(join(path, name), depth + 1));
    };
    return lstatSync(data).isDirectory() && inspect(data, 0);
  } catch {
    return false;
  }
}

function isolated(root) {
  try {
    return ['node_modules', '.data'].every(
      (name) =>
        !existsSync(join(root, name)) ||
        (!lstatSync(join(root, name)).isSymbolicLink() &&
          realpathSync(join(root, name)) === join(root, name)),
    );
  } catch {
    return false;
  }
}
function localMock(root, env) {
  try {
    const pairs = boundedRead(join(root, '.env.example'))
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(/=(.*)/s).slice(0, 2));
    const defaults = Object.fromEntries(pairs);
    if (pairs.length !== 6 || defaults.QP_MODE !== 'local' || defaults.QP_ADAPTER !== 'mock') return false;
    if (env.NODE_ENV === 'production') return false;
    return Object.entries(env).every(([k, v]) => !k.startsWith('QP_') || defaults[k] === v);
  } catch {
    return false;
  }
}
export function inspectEnvironment({ root = ROOT, mode = 'dev', environment = process.env } = {}) {
  root = realpathSync(root);
  const inputs = readInputs(root);
  const commands = [];
  const run = (command, args, id, allow = []) => {
    const result = spawnSync(command, args, {
      cwd: root,
      env:
        command === 'git'
          ? { ...environment, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' }
          : environment,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    commands.push({ id, exitCode: result.status });
    if (result.status !== 0 && !allow.includes(result.status))
      throw new Error('Environment probe unavailable');
    return (result.stdout ?? '').trim();
  };
  const overrides = overrideKinds(environment);
  const o = {
    node: process.versions.node,
    npm: null,
    git: null,
    platform: platform(),
    arch: arch(),
    nativeArch: null,
    runtimeAligned: null,
    nativeDependenciesValid: false,
    rootValid: false,
    originValid: false,
    historyValid: false,
    clean: false,
    hiddenIndex: true,
    authorConfigured: false,
    filesValid: false,
    isolated: isolated(root) && dataRootIsolated(root),
    ports: 'BLOCKED',
    localMock: localMock(root, environment),
    fnm: null,
    config: {},
    overrides,
    commands,
    job: environment.GITHUB_ACTIONS === 'true' ? environment.GITHUB_JOB : null,
    image: environment.GITHUB_ACTIONS === 'true' ? environment.ImageVersion : null,
  };
  try {
    const installed = join(root, 'node_modules/.package-lock.json');
    o.nativeDependenciesValid =
      !existsSync(join(root, 'node_modules')) ||
      nativePackagesValid(JSON.parse(boundedRead(installed)), o.platform, o.arch);
  } catch {
    o.nativeDependenciesValid = false;
  }
  // Do not start npm/Git under unapproved interpreter/configuration injection.
  if (overrides.length) return evaluate(inputs, o, mode);
  const git = (args) =>
    run(
      'git',
      ['--no-replace-objects', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
      'git-' + args[0].replace(/^--/, ''),
    );
  try {
    o.git = git(['--version'])
      .replace(/^git version /, '')
      .split(' ')[0];
    const names = git(['config', '--local', '--name-only', '--list']).split('\n');
    if (unsafeGitConfig(names)) {
      o.overrides.push('git-config');
      return evaluate(inputs, o, mode);
    }
    const grafts = git(['rev-parse', '--git-path', 'info/grafts']);
    if (existsSync(resolve(root, grafts))) {
      o.overrides.push('git-history');
      return evaluate(inputs, o, mode);
    }
    o.rootValid = realpathSync(git(['rev-parse', '--show-toplevel'])) === root;
    const origin = git(['remote', 'get-url', 'origin']);
    const expected = inputs.supply.repository;
    o.originValid = [
      `https://github.com/${expected}`,
      `https://github.com/${expected}.git`,
      `git@github.com:${expected}.git`,
    ].includes(origin);
    Object.assign(o, gitIdentity(git, githubEvent(environment)));
    o.clean = git(['status', '--porcelain=v1', '--untracked-files=all']) === '';
    o.hiddenIndex = git(['ls-files', '-v', '-z'])
      .split('\0')
      .filter(Boolean)
      .some((l) => /^[a-zS]/.test(l));
    o.filesValid = filesValid(root, git);
    if (mode === 'dev')
      o.authorConfigured = Boolean(git(['config', 'user.name']) && git(['config', 'user.email']));
  } catch {
    /* Missing prerequisites remain explicit in the report. */
  }
  try {
    const cli = npmCli();
    o.npm = run(process.execPath, [cli, '--version'], 'npm-version');
    const pathKey = Object.keys(environment).find((k) => k.toUpperCase() === 'PATH');
    const command = (environment[pathKey] ?? '')
      .split(delimiter)
      .flatMap((p) => [join(p, process.platform === 'win32' ? 'npm.cmd' : 'npm')])
      .find(existsSync);
    const alignedPath =
      command &&
      (process.platform === 'win32'
        ? realpathSync(dirname(command)) === dirname(realpathSync(process.execPath))
        : realpathSync(command) === cli);
    o.runtimeAligned =
      Boolean(alignedPath) && (!environment.npm_execpath || realpathSync(environment.npm_execpath) === cli);
    for (const key of [...Object.keys(CONFIG), 'registry', 'proxy', 'https-proxy']) {
      const value = run(process.execPath, [cli, 'config', 'get', key], 'npm-config-' + key);
      o.config[key] = value === 'null' ? '' : value;
    }
  } catch {
    /* No install or fallback to another npm. */
  }
  try {
    if (o.platform === 'darwin') {
      const machine = run('/usr/bin/uname', ['-m'], 'host-uname');
      const apple =
        machine === 'arm64' ? '1' : run('/usr/sbin/sysctl', ['-n', 'hw.optional.arm64'], 'host-native', [1]);
      o.nativeArch = apple === '1' ? 'arm64' : apple === '0' && machine === 'x86_64' ? 'x64' : null;
      if (mode === 'dev') {
        run('fnm', ['--version'], 'host-fnm');
        const current = run('fnm', ['current'], 'host-fnm-current');
        o.fnm =
          current.replace(/^v/, '') === inputs.node &&
          Boolean(environment.FNM_MULTISHELL_PATH) &&
          realpathSync(process.execPath).includes(`${sep}fnm${sep}`);
      }
    } else if (o.platform === 'win32')
      o.nativeArch =
        (environment.PROCESSOR_ARCHITEW6432 || environment.PROCESSOR_ARCHITECTURE) === 'AMD64' ? 'x64' : null;
    else o.nativeArch = run('uname', ['-m'], 'host-uname') === 'x86_64' ? 'x64' : null;
  } catch {
    /* Required host manager or architecture remains unavailable. */
  }
  try {
    if (o.platform === 'linux') {
      const tables = ['/proc/net/tcp', '/proc/net/tcp6'].filter(existsSync).map((p) => boundedRead(p));
      if (tables.length === 0) throw new Error('ports unavailable');
      o.ports = tables.some((t) =>
        t.split('\n').some((l) => /^\s*\d+:\s+\S+:(1054|1055)\s+\S+\s+0A\s/.test(l)),
      )
        ? 'FAIL'
        : 'PASS';
      commands.push({ id: 'ports-proc', exitCode: 0 });
    } else if (o.platform === 'darwin')
      o.ports = run('/usr/sbin/lsof', ['-nP', '-iTCP:4180', '-iTCP:4181', '-sTCP:LISTEN'], 'ports-lsof', [1])
        ? 'FAIL'
        : 'PASS';
    else if (o.platform === 'win32')
      o.ports = run('netstat', ['-ano', '-p', 'tcp'], 'ports-netstat')
        .split('\n')
        .some((l) => /^\s*TCP\s+\S+:(4180|4181)\s/.test(l))
        ? 'FAIL'
        : 'PASS';
  } catch {
    /* Cannot prove ports are available. */
  }
  if (mode === 'ci' && environment.GITHUB_ACTIONS !== 'true') o.historyValid = false;
  return evaluate(inputs, o, mode);
}
