import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { boundedRead, inspectEnvironment, readInputs } from '../tools/environment/observe.mjs';

const repository = resolve(import.meta.dirname, '..');
// These are real isolated fixture probes, never host/hosted admission evidence.
// The supplied environment omits coverage hooks from child npm/Git probes only;
// an explicit NODE_OPTIONS negative still proves the actual admission rule.
function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-observe-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'source');
  mkdirSync(root);
  mkdirSync(join(root, 'planning'));
  for (const file of [
    '.node-version',
    'package.json',
    'package-lock.json',
    '.npmrc',
    '.env.example',
    '.gitattributes',
    '.editorconfig',
    'planning/development-environment.json',
    'planning/supply-chain-policy.json',
  ])
    copyFileSync(join(repository, file), join(root, file));
  writeFileSync(join(root, '.gitignore'), '.data/\nnode_modules/\n');
  writeFileSync(join(root, 'source.txt'), 'isolated fixture\n');
  const environment = {
    PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter),
    HOME: parent,
    TMPDIR: parent,
    ...(process.platform === 'win32'
      ? { SystemRoot: process.env.SystemRoot, PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE }
      : {}),
  };
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      env: { ...environment, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'fixture');
  git('config', 'user.name', 'Environment Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('remote', 'add', 'origin', 'https://github.com/pdbsy/quantpass-arbitrum-hackathon.git');
  git('add', '.');
  git('commit', '-m', 'isolated environment source');
  git('update-ref', 'refs/remotes/origin/master', git('rev-parse', 'HEAD'));
  return {
    root,
    parent,
    environment,
    git,
    inspect: (extra = {}) => inspectEnvironment({ root, environment, ...extra }),
  };
}
const status = (report, id) => report.checks.find((check) => check.id === id)?.status;

test(
  'native Darwin port probe rejects a real listening demo port without changing its owner',
  {
    skip: process.platform !== 'darwin',
  },
  async (t) => {
    const f = fixture(t);
    const listener = createServer();
    const owned = await new Promise((accept, reject) => {
      listener.once('error', (error) => (error.code === 'EADDRINUSE' ? accept(false) : reject(error)));
      listener.listen(4180, '127.0.0.1', () => accept(true));
    });
    t.after(async () => {
      if (owned)
        await new Promise((accept, reject) => listener.close((error) => (error ? reject(error) : accept())));
    });
    // An existing product listener is also real occupied-port evidence. Never
    // stop it, bind a different port, or replace the native lsof result.
    const native = spawnSync('/usr/sbin/lsof', ['-nP', '-iTCP:4180', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    assert.equal(native.status, 0);
    assert.match(native.stdout, /:4180\s+\(LISTEN\)/);
    if (owned) assert.match(native.stdout, new RegExp(`\\s${process.pid}\\s`));
    const report = f.inspect();
    assert.equal(status(report, 'ports'), 'FAIL');
    assert.equal(report.eligibleForEvidence, false);
    assert.ok(
      report.commands.some((command) => command.id === 'ports-lsof' && [0, 1].includes(command.exitCode)),
      JSON.stringify(report.commands.filter((command) => command.id === 'ports-lsof')),
    );
    assert.equal(f.git('status', '--porcelain'), '');
    if (owned) assert.equal(listener.listening, true);
  },
);

test('bounded environment reads reject real replacement and growth before consuming unbound bytes', (t) => {
  const f = fixture(t);
  const path = join(f.root, 'race.txt');
  for (const mutation of ['replace', 'grow']) {
    writeFileSync(path, 'safe\n');
    const originalOpen = fs.openSync;
    const hook = t.mock.method(fs, 'openSync', (...args) => {
      if (args[0] === path) {
        if (mutation === 'replace') {
          fs.renameSync(path, `${path}.old`);
          writeFileSync(path, 'replacement\n');
        } else fs.appendFileSync(path, 'a'.repeat(65));
      }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => boundedRead(path, 64), /Environment input unavailable/);
    } finally {
      hook.mock.restore();
      syncBuiltinESMExports();
    }
  }
});

test('absent PATH and conflicting npm executable cannot be admitted as an aligned runtime', (t) => {
  const f = fixture(t);
  for (const extra of [{ PATH: '' }, { npm_execpath: join(f.parent, 'unapproved-npm.js') }]) {
    const report = f.inspect({ environment: { ...f.environment, ...extra } });
    assert.notEqual(status(report, 'platform'), 'PASS');
    assert.equal(report.eligibleForEvidence, false);
  }
});

test('missing PATH rejects an otherwise available exact npm runtime', (t) => {
  const f = fixture(t);
  const environment = { ...f.environment };
  delete environment.PATH;
  const report = f.inspect({ environment });
  assert.ok(report.commands.some((command) => command.id === 'npm-version' && command.exitCode === 0));
  assert.notEqual(status(report, 'platform'), 'PASS');
  assert.equal(report.eligibleForEvidence, false);
});

test('an exact Node copy without adjacent npm rejects the native npm prerequisite', (t) => {
  assert.equal(process.versions.node, readFileSync(join(repository, '.node-version'), 'utf8').trim());
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-node-no-npm-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const approvedNode = realpathSync(process.execPath);
  const copiedNode = join(bin, basename(approvedNode));
  copyFileSync(approvedNode, copiedNode);
  chmodSync(copiedNode, statSync(approvedNode).mode & 0o777);
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(digest(copiedNode), digest(approvedNode));
  assert.equal(existsSync(join(directory, 'lib/node_modules/npm/bin/npm-cli.js')), false);
  assert.equal(existsSync(join(bin, 'node_modules/npm/bin/npm-cli.js')), false);

  const script = `
    import assert from 'node:assert/strict';
    import {realpathSync} from 'node:fs';
    import {npmCli} from ${JSON.stringify(new URL('../tools/environment/observe.mjs', import.meta.url).href)};
    assert.equal(realpathSync(process.execPath), ${JSON.stringify(realpathSync(copiedNode))});
    assert.throws(() => npmCli(), /Exact npm runtime unavailable/);
    process.stdout.write('NPM_PREREQUISITE_REJECTED\\n');
  `;
  const child = spawnSync(copiedNode, ['--input-type=module', '-e', script], {
    cwd: directory,
    env: process.env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'NPM_PREREQUISITE_REJECTED\n');
  assert.equal(child.stderr, '');
});

test('case-colliding tracked names and shallow history remain ineligible for environment evidence', (t) => {
  const f = fixture(t);
  const object = f.git('rev-parse', 'HEAD:source.txt');
  f.git('update-index', '--add', '--cacheinfo', `100644,${object},SOURCE.txt`);
  const collision = f.inspect();
  assert.equal(status(collision, 'files'), 'FAIL');
  assert.equal(collision.eligibleForEvidence, false);
  f.git('update-index', '--force-remove', 'SOURCE.txt');
  writeFileSync(join(f.root, '.git/shallow'), f.git('rev-parse', 'HEAD') + '\n');
  const shallow = f.inspect();
  assert.equal(status(shallow, 'history'), 'BLOCKED');
  assert.equal(shallow.eligibleForEvidence, false);
});

test('real environment probes bind a clean fixture to exact source and local npm configuration', (t) => {
  const f = fixture(t);
  const report = f.inspect();
  const gitTop = f.git('rev-parse', '--show-toplevel');
  const nodeRoot = realpathSync(f.root);
  let gitRoot = '';
  let nativeCanonicalEqual = false;
  let sameDirectoryIdentity = false;
  try {
    gitRoot = realpathSync(gitTop);
    nativeCanonicalEqual = realpathSync.native(f.root) === realpathSync.native(gitTop);
    const nodeStat = statSync(f.root, { bigint: true });
    const gitStat = statSync(gitTop, { bigint: true });
    sameDirectoryIdentity =
      nodeStat.ino !== 0n && nodeStat.ino === gitStat.ino && nodeStat.dev === gitStat.dev;
  } catch {
    // Report only booleans if a probe path cannot be resolved.
  }
  // Keep the actual temporary-directory fixture, including native Windows short
  // names. Diagnose binding failures without publishing either personal path.
  const repositoryDiagnostic = {
    platform: process.platform,
    gitTopExists: existsSync(gitTop),
    canonicalEqual: nodeRoot === gitRoot,
    canonicalCaseFoldEqual: nodeRoot.toLowerCase() === gitRoot.toLowerCase(),
    canonicalLengthEqual: nodeRoot.length === gitRoot.length,
    nativeCanonicalEqual,
    sameDirectoryIdentity,
    nodeRootHasShortName: /~\d/.test(nodeRoot),
    gitRootHasShortName: /~\d/.test(gitRoot),
    nodeRootPrintableAscii: /^[\x20-\x7e]*$/.test(nodeRoot),
    gitRootPrintableAscii: /^[\x20-\x7e]*$/.test(gitRoot),
    originMatches:
      f.git('remote', 'get-url', 'origin') === 'https://github.com/pdbsy/quantpass-arbitrum-hackathon.git',
    failedCommands: report.commands.filter((command) => command.exitCode !== 0),
  };
  for (const id of [
    'inputs',
    'tools',
    'repository',
    'history',
    'workspace',
    'index',
    'identity',
    'files',
    'isolation',
    'overrides',
    'npm-config',
    'local-mock',
  ])
    assert.equal(
      status(report, id),
      'PASS',
      id === 'repository' ? `${id} ${JSON.stringify(repositoryDiagnostic)}` : id,
    );
  assert.equal(report.head, f.git('rev-parse', 'HEAD'));
  assert.equal(report.tree, f.git('rev-parse', 'HEAD^{tree}'));
  assert.equal(report.context, 'local');
  assert.equal(report.remoteFreshness, 'NOT_RUN');
  assert.equal(status(report, 'contracts'), 'NOT_RUN');
  assert.ok(report.commands.some((c) => c.id === 'npm-version' && c.exitCode === 0));
});

test('repository root aliases preserve exact identity while shared data links still fail', (t) => {
  const f = fixture(t);
  const alias = join(f.parent, 'source-alias');
  symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(realpathSync.native(alias), realpathSync.native(f.root));
  const aliased = f.inspect({ root: alias });
  assert.equal(status(aliased, 'repository'), 'PASS');
  assert.equal(aliased.head, f.git('rev-parse', 'HEAD'));
  assert.equal(aliased.tree, f.git('rev-parse', 'HEAD^{tree}'));
  const shared = join(f.parent, 'shared-data');
  mkdirSync(shared);
  symlinkSync(shared, join(f.root, '.data'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = f.inspect({ root: alias });
  assert.equal(status(linked, 'repository'), 'PASS');
  assert.equal(status(linked, 'isolation'), 'FAIL');
  assert.equal(linked.eligibleForEvidence, false);
});

test('a directory contained by the repository is not accepted as its root', (t) => {
  const f = fixture(t);
  const nested = join(f.root, 'nested');
  mkdirSync(join(nested, 'planning'), { recursive: true });
  for (const file of [
    '.node-version',
    'package.json',
    'package-lock.json',
    'planning/development-environment.json',
    'planning/supply-chain-policy.json',
  ])
    copyFileSync(join(f.root, file), join(nested, file));
  assert.notEqual(realpathSync.native(nested), realpathSync.native(f.root));
  const report = f.inspect({ root: nested });
  assert.equal(status(report, 'repository'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
  assert.equal(status(f.inspect(), 'repository'), 'PASS');
});

test('linked worktree roots bind to their own canonical directory and retain remote checks', (t) => {
  const f = fixture(t);
  const worktree = join(f.parent, 'source-worktree');
  f.git('worktree', 'add', '-b', 'linked-fixture', worktree);
  assert.notEqual(realpathSync.native(worktree), realpathSync.native(f.root));
  assert.ok(statSync(join(worktree, '.git')).isFile());
  const report = f.inspect({ root: worktree });
  for (const id of ['repository', 'history', 'workspace', 'files', 'isolation'])
    assert.equal(status(report, id), 'PASS', id);
  assert.equal(report.head, f.git('rev-parse', 'HEAD'));
  f.git('remote', 'set-url', 'origin', 'https://example.invalid/different/repository.git');
  assert.equal(status(f.inspect({ root: worktree }), 'repository'), 'FAIL');
});

test(
  'native Windows short and long root spellings identify the same repository',
  {
    skip: process.platform !== 'win32' ? 'NOT_RUN: requires native Windows filesystem short names' : false,
  },
  (t) => {
    const f = fixture(t);
    const shortRoot = realpathSync(f.root);
    const gitRoot = realpathSync(f.git('rev-parse', '--show-toplevel'));
    if (!/~\d/.test(shortRoot) || shortRoot === gitRoot) {
      t.skip('NOT_RUN: this Windows fixture has no distinct short-name root alias');
      return;
    }
    assert.equal(realpathSync.native(shortRoot), realpathSync.native(gitRoot));
    const first = statSync(shortRoot, { bigint: true });
    const second = statSync(gitRoot, { bigint: true });
    assert.notEqual(first.ino, 0n);
    assert.equal(first.ino, second.ino);
    assert.equal(first.dev, second.dev);
    for (const root of [shortRoot, gitRoot]) {
      const report = f.inspect({ root });
      for (const id of ['repository', 'history', 'files', 'isolation'])
        assert.equal(status(report, id), 'PASS', id);
      assert.equal(report.head, f.git('rev-parse', 'HEAD'));
    }
  },
);

test('injected interpreter settings stop real environment probes before launching npm or Git', (t) => {
  const f = fixture(t);
  const report = f.inspect({
    environment: { ...f.environment, NODE_OPTIONS: '--require=synthetic-never-executed' },
  });
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
  assert.deepEqual(report.commands, []);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-never-executed/);
});

test('default environment inspection rejects inherited interpreter injection before probes', () => {
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require=synthetic-never-executed';
  try {
    const report = inspectEnvironment();
    assert.equal(status(report, 'overrides'), 'FAIL');
    assert.equal(report.eligibleForEvidence, false);
    assert.deepEqual(report.commands, []);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-never-executed/);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

test('real Git hidden-index and origin changes cannot produce eligible source evidence', (t) => {
  const f = fixture(t);
  f.git('update-index', '--assume-unchanged', 'source.txt');
  writeFileSync(join(f.root, 'source.txt'), 'changed hidden bytes\n');
  f.git('remote', 'set-url', 'origin', 'https://example.invalid/unapproved.git');
  const report = f.inspect();
  assert.equal(status(report, 'index'), 'FAIL');
  assert.equal(status(report, 'repository'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('unsafe repository configuration and grafts stop inspection before executable probes', (t) => {
  const f = fixture(t);
  f.git('config', 'filter.synthetic.clean', 'never-execute-this');
  let report = f.inspect();
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.equal(
    report.commands.some((c) => c.id === 'npm-version'),
    false,
  );
  f.git('config', '--remove-section', 'filter.synthetic');
  writeFileSync(join(f.root, '.git/info/grafts'), 'invalid fixture history\n');
  report = f.inspect();
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.equal(
    report.commands.some((c) => c.id === 'npm-version'),
    false,
  );
});

test('shared data, malformed native dependencies and real-mode overrides reject fixture admission', (t) => {
  const f = fixture(t);
  const shared = join(f.parent, 'external-data');
  mkdirSync(shared);
  symlinkSync(shared, join(f.root, '.data'), process.platform === 'win32' ? 'junction' : 'dir');
  mkdirSync(join(f.root, 'node_modules'));
  writeFileSync(join(f.root, 'node_modules/.package-lock.json'), '{');
  const report = f.inspect({ environment: { ...f.environment, QP_MODE: 'live', NODE_ENV: 'production' } });
  assert.equal(status(report, 'isolation'), 'FAIL');
  assert.notEqual(status(report, 'platform'), 'PASS');
  assert.equal(status(report, 'local-mock'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('local fixture cannot masquerade as hosted CI and dirty files remain visible', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'source.txt'), 'changed fixture\n');
  const report = f.inspect({ mode: 'ci' });
  assert.equal(status(report, 'history'), 'BLOCKED');
  assert.equal(status(report, 'workspace'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('bounded environment reads reject symlinks, oversized inputs and invalid UTF-8', (t) => {
  const f = fixture(t);
  const file = join(f.parent, 'input');
  writeFileSync(file, 'valid');
  assert.equal(boundedRead(file, 5), 'valid');
  assert.throws(() => boundedRead(file, 4));
  const link = join(f.parent, 'link');
  symlinkSync(file, link);
  assert.throws(() => boundedRead(link));
  writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => boundedRead(file));
  const node = readFileSync(join(f.root, '.node-version'));
  writeFileSync(join(f.root, '.node-version'), '0.0.0\n');
  assert.throws(() => readInputs(f.root), /Invalid environment inputs/);
  writeFileSync(join(f.root, '.node-version'), node);
  assert.equal(readInputs(f.root).node, node.toString().trim());
});

test('real inspection decodes PR and merge-queue event fixtures without treating them as hosted approval', (t) => {
  const f = fixture(t);
  const base = f.git('rev-parse', 'HEAD');
  f.git('switch', '-c', 'event-source');
  writeFileSync(join(f.root, 'event-source.txt'), 'event source\n');
  f.git('add', '.');
  f.git('commit', '-m', 'event source');
  const head = f.git('rev-parse', 'HEAD');
  f.git('switch', 'fixture');
  f.git('merge', '--no-ff', 'event-source', '-m', 'event merge');
  const merge = f.git('rev-parse', 'HEAD');
  const eventFile = join(f.parent, 'event.json');
  const repositoryName = 'pdbsy/quantpass-arbitrum-hackathon';
  const payload = {
    pull_request: {
      base: { repo: { full_name: repositoryName }, ref: 'master', sha: base },
      head: { repo: { full_name: repositoryName }, sha: head },
    },
  };
  const environment = {
    ...f.environment,
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_SHA: merge,
    GITHUB_REF: 'refs/pull/1/merge',
    GITHUB_REPOSITORY: repositoryName,
    GITHUB_EVENT_PATH: eventFile,
  };
  writeFileSync(eventFile, JSON.stringify(payload));
  let report = f.inspect({ mode: 'ci', environment });
  assert.equal(status(report, 'history'), 'PASS');
  assert.equal(report.sourceHead, head);
  assert.equal(report.eligibleForEvidence, false, 'fixture event does not prove a qualified hosted job');
  for (const [name, mutate] of [
    [
      'missing PR',
      (p) => {
        delete p.pull_request;
      },
    ],
    [
      'foreign base repository',
      (p) => {
        p.pull_request.base.repo.full_name = 'foreign/repo';
      },
    ],
    [
      'wrong base ref',
      (p) => {
        p.pull_request.base.ref = 'other';
      },
    ],
    [
      'foreign head repository',
      (p) => {
        p.pull_request.head.repo.full_name = 'foreign/repo';
      },
    ],
  ]) {
    const invalid = structuredClone(payload);
    mutate(invalid);
    writeFileSync(eventFile, JSON.stringify(invalid));
    report = f.inspect({ mode: 'ci', environment });
    assert.equal(status(report, 'history'), 'BLOCKED', name);
    assert.equal(report.eligibleForEvidence, false, name);
  }
  for (const bytes of ['{invalid', 'null']) {
    writeFileSync(eventFile, bytes);
    assert.equal(status(f.inspect({ mode: 'ci', environment }), 'history'), 'BLOCKED');
  }
  writeFileSync(eventFile, JSON.stringify({ merge_group: { head_sha: merge, base_sha: base } }));
  const queueEnv = {
    ...environment,
    GITHUB_EVENT_NAME: 'merge_group',
    GITHUB_REF: 'refs/heads/gh-readonly-queue/master/fixture',
  };
  report = f.inspect({ mode: 'ci', environment: queueEnv });
  assert.equal(status(report, 'history'), 'PASS');
  assert.equal(report.sourceHead, merge);
  assert.equal(report.eligibleForEvidence, false);
  writeFileSync(eventFile, '{}');
  assert.equal(status(f.inspect({ mode: 'ci', environment: queueEnv }), 'history'), 'BLOCKED');
});

for (const [label, bytes] of [
  ['CRLF text', Buffer.from('fixture\r\n')],
  ['invalid UTF-8', Buffer.from([0xff])],
  ['oversized file', Buffer.alloc(2 * 1024 * 1024 + 1, 65)],
])
  test(`real inspection rejects tracked ${label}`, (t) => {
    const f = fixture(t);
    // Suppress newline conversion only in this disposable fixture so on-disk bytes
    // really reach the same production file admission check.
    writeFileSync(join(f.root, '.git/info/attributes'), 'malformed.bin -text\n');
    writeFileSync(join(f.root, 'malformed.bin'), bytes);
    f.git('add', '.');
    f.git('commit', '-m', `fixture ${label}`);
    const report = f.inspect();
    assert.equal(status(report, 'files'), 'FAIL');
    assert.equal(report.eligibleForEvidence, false);
  });

test('real inspection accepts binary NUL fixtures but rejects tracked file symlinks', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'binary.bin'), Buffer.from([0, 255]));
  f.git('add', '.');
  f.git('commit', '-m', 'fixture binary');
  assert.equal(status(f.inspect(), 'files'), 'PASS');
  symlinkSync('source.txt', join(f.root, 'linked-source.txt'));
  f.git('add', '.');
  f.git('commit', '-m', 'fixture tracked link');
  const report = f.inspect();
  assert.equal(status(report, 'files'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('real inspection rejects malformed local-mode defaults and misaligned npm PATH', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, '.env.example'), 'QP_MODE=live\nQP_ADAPTER=live\n');
  let report = f.inspect();
  assert.equal(status(report, 'local-mock'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
  const environment = { ...f.environment, PATH: f.parent };
  report = f.inspect({ environment });
  assert.equal(status(report, 'tools'), 'PASS', 'exact Node/npm versions do not prove PATH alignment');
  assert.notEqual(status(report, 'platform'), 'PASS');
  assert.equal(report.eligibleForEvidence, false);
});

test('real file admission bounds tracked count and aggregate bytes independently', (t) => {
  const f = fixture(t);
  const bulk = join(f.root, 'bulk');
  mkdirSync(bulk);
  for (let n = 0; n < 4097; n++) writeFileSync(join(bulk, `item-${n}.txt`), 'fixture\n');
  f.git('add', '.');
  assert.equal(status(f.inspect(), 'files'), 'FAIL');
  f.git('reset', '--mixed', 'HEAD');
  rmSync(bulk, { recursive: true });
  mkdirSync(bulk);
  for (let n = 0; n < 17; n++) writeFileSync(join(bulk, `item-${n}.bin`), Buffer.alloc(2 * 1024 * 1024));
  f.git('add', '.');
  const report = f.inspect();
  assert.equal(status(report, 'files'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('data isolation rejects excessive directory depth and entry count while preserving shallow private data', async (t) => {
  const { dataRootIsolated } = await import('../tools/environment/observe.mjs');
  const f = fixture(t);
  const data = join(f.root, '.data');
  mkdirSync(data);
  writeFileSync(join(data, 'local.sqlite'), 'isolated fixture');
  assert.equal(dataRootIsolated(f.root), true);
  let nested = data;
  for (let n = 0; n < 9; n++) {
    nested = join(nested, 'nested');
    mkdirSync(nested);
  }
  assert.equal(dataRootIsolated(f.root), false);
  rmSync(join(data, 'nested'), { recursive: true });
  for (let n = 0; n < 1024; n++) writeFileSync(join(data, `entry-${n}`), 'fixture');
  assert.equal(dataRootIsolated(f.root), false);
  assert.equal(readFileSync(join(data, 'local.sqlite'), 'utf8'), 'isolated fixture');
});

test('toolchain input aliases and runtime overrides cannot qualify local mock evidence', (t) => {
  const f = fixture(t);
  const target = join(f.parent, 'node-version');
  copyFileSync(join(f.root, '.node-version'), target);
  rmSync(join(f.root, '.node-version'));
  symlinkSync(target, join(f.root, '.node-version'));
  assert.throws(() => readInputs(f.root), /Environment input unavailable/);
  rmSync(join(f.root, '.node-version'));
  copyFileSync(target, join(f.root, '.node-version'));
  const report = f.inspect({ environment: { ...f.environment, QP_MODE: 'live' } });
  assert.equal(status(report, 'local-mock'), 'FAIL');
  assert.equal(report.eligibleForEvidence, false);
});

test('public default environment inspection rejects interpreter overrides before any probes', () => {
  const forbidden = 'https://example.invalid/unapproved-environment-runtime';
  const script = `
    import {inspectEnvironment} from ${JSON.stringify(new URL('../tools/environment/observe.mjs', import.meta.url).href)};
    process.stdout.write(JSON.stringify(inspectEnvironment()));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repository,
    env: { ...process.env, FNM_NODE_DIST_MIRROR: forbidden },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.mode, 'dev');
  assert.equal(report.eligibleForEvidence, false);
  assert.notEqual(report.exitCode, 0);
  assert.equal(status(report, 'overrides'), 'FAIL');
  assert.deepEqual(report.commands, [], 'unapproved input must prevent all subprocess probes');
  assert.equal(child.stdout.includes(forbidden), false, 'raw override value must not be disclosed');
});
