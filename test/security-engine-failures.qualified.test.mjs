import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import childProcess, { execFileSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { installScanner, selectPlatform, verifyBytes } from '../tools/security/bootstrap.mjs';
import { verifyRuleFixtures } from '../tools/ci/check-semgrep.mjs';
import { verifySecretCanary } from '../tools/ci/check-gitleaks.mjs';
import { fixtureExec } from './helpers/git-fixture.mjs';

const root = resolve(import.meta.dirname, '..');

function stageInstalledEthersRuntime(fixture) {
  const installedRoot = realpathSync(join(root, 'node_modules'));
  const copied = new Set();
  let files = 0;
  let bytes = 0;
  const inspectPackage = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      const metadata = lstatSync(path);
      assert.ok(!metadata.isSymbolicLink(), 'fixture package must not contain symbolic links');
      if (metadata.isDirectory()) inspectPackage(path);
      else {
        assert.ok(metadata.isFile(), 'fixture package must contain regular files');
        files++;
        bytes += metadata.size;
        assert.ok(files <= 10000 && bytes <= 64 * 1024 * 1024, 'fixture runtime copy is bounded');
      }
    }
  };
  const stage = (name, from) => {
    assert.match(name, /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/);
    // Type declaration packages are not loaded by this JavaScript runtime.
    if (name.startsWith('@types/')) return;
    let directory = dirname(createRequire(join(from, 'package.json')).resolve(name));
    let manifest;
    for (let depth = 0; depth < 16; depth++) {
      const path = join(directory, 'package.json');
      if (existsSync(path)) {
        const value = JSON.parse(readFileSync(path, 'utf8'));
        if (value.name === name) {
          manifest = value;
          break;
        }
      }
      directory = dirname(directory);
    }
    assert.ok(manifest, 'installed runtime package identity must match');
    const source = realpathSync(directory);
    const location = relative(installedRoot, source);
    assert.ok(
      location && !isAbsolute(location) && !location.startsWith('..' + sep) && location !== '..',
      'installed runtime must stay in node_modules',
    );
    if (copied.has(source)) return;
    copied.add(source);
    assert.ok(copied.size <= 64, 'fixture runtime dependency graph is bounded');
    inspectPackage(source);
    cpSync(source, join(fixture, 'node_modules', location), {
      recursive: true,
      filter: (path) => path === source || basename(path) !== 'node_modules',
    });
    for (const dependency of Object.keys(manifest.dependencies ?? {})) stage(dependency, source);
  };
  stage('ethers', root);
  assert.ok(copied.size > 1, 'real ethers runtime dependencies must be staged');
}

test('qualified Gitleaks canary rejects a missing config and a real current-tree detection loss', async (t) => {
  const lock = JSON.parse(readFileSync(join(root, 'planning/security-scanners.lock.json')));
  const platform = selectPlatform(process.platform, process.arch);
  const asset = lock.gitleaks.platforms[platform];
  const cache = join(root, '.checks/security-scanners/downloads', asset.filename);
  assert.ok(existsSync(cache), 'qualified Gitleaks cache is required');
  verifyBytes(readFileSync(cache), asset.sha256);
  const tool = await installScanner('gitleaks');
  t.after(() => tool.cleanup());

  const missingConfig = join(tool.directory, 'missing-config');
  mkdirSync(missingConfig);
  assert.throws(
    () => verifySecretCanary({ ...tool, directory: missingConfig }),
    /Gitleaks history\/redaction canary failed/,
  );

  const currentLoss = join(tool.directory, 'current-loss');
  mkdirSync(currentLoss);
  writeFileSync(join(currentLoss, 'gitleaks.toml'), '[extend]\nuseDefault = true\n');
  writeFileSync(join(currentLoss, 'empty-ignore'), '');
  const originalSpawn = childProcess.spawnSync;
  let currentScans = 0;
  const hook = t.mock.method(childProcess, 'spawnSync', function (file, args, options) {
    if (file === tool.binary && args[0] === 'dir') {
      currentScans++;
      const canaryTree = args.at(-1);
      rmSync(join(canaryTree, 'side.txt'));
      rmSync(join(canaryTree, 'merge-only.txt'));
    }
    return originalSpawn.call(this, file, args, options);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => verifySecretCanary({ ...tool, directory: currentLoss }),
      /Gitleaks current-file\/redaction canary failed/,
    );
    assert.equal(currentScans, 1);
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
  }
});

test('qualified Gitleaks gate rejects an extra synthetic finding in both history and current files', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-gitleaks-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const checkout = join(directory, 'repo');
  fixtureExec('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', root, checkout], {
    cwd: directory,
  });
  const fixture = realpathSync(checkout);
  const head = fixtureExec('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fixtureExec('git', ['-C', fixture, 'checkout', '--quiet', '--detach', head], { cwd: directory });
  fixtureExec('git', ['-C', fixture, 'update-ref', 'refs/remotes/origin/master', head], {
    cwd: directory,
  });

  const lock = JSON.parse(readFileSync(join(root, 'planning/security-scanners.lock.json')));
  const platform = selectPlatform(process.platform, process.arch);
  const asset = lock.gitleaks.platforms[platform];
  const cache = join(root, '.checks/security-scanners/downloads', asset.filename);
  assert.ok(existsSync(cache), 'qualified Gitleaks cache is required');
  verifyBytes(readFileSync(cache), asset.sha256);
  const fixtureCache = join(fixture, '.checks/security-scanners/downloads');
  mkdirSync(fixtureCache, { recursive: true });
  cpSync(cache, join(fixtureCache, asset.filename));
  // This fixture proceeds into a real complete scan, so it needs the installed
  // address-proof runtime. Missing-history fixtures deliberately remain dependency-free.
  stageInstalledEthersRuntime(fixture);

  const canary = [
    'ghp',
    '_',
    createHash('sha256')
      .update('AlphaForge disposable gate finding, never issued')
      .digest('hex')
      .slice(0, 36),
  ].join('');
  writeFileSync(join(fixture, 'synthetic-token.txt'), `credential = "${canary}"\n`);
  fixtureExec('git', ['-C', fixture, 'add', 'synthetic-token.txt'], { cwd: directory });
  fixtureExec(
    'git',
    [
      '-C',
      fixture,
      '-c',
      'user.name=Scanner Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--quiet',
      '-m',
      'synthetic never-issued scanner finding',
    ],
    { cwd: directory },
  );
  const status = fixtureExec('git', ['-C', fixture, 'status', '--porcelain', '--untracked-files=no'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(status, '');

  const child = childProcess.spawnSync(process.execPath, [join(fixture, 'tools/ci/check-gitleaks.mjs')], {
    cwd: fixture,
    env: process.env,
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, JSON.stringify({ stdout: child.stdout, stderr: child.stderr }));
  assert.equal(child.stderr, '');
  assert.doesNotMatch(child.stdout, new RegExp(canary));
  const report = JSON.parse(child.stdout);
  assert.equal(report.state, 'FAIL');
  assert.equal(report.canary, 'PASS');
  assert.equal(report.historyDisposition.state, 'FAIL');
  assert.equal(report.currentFiles.state, 'FAIL');
  assert.equal(report.historyScannerExit, 10);
  assert.ok(report.refs.some((ref) => ref.name === 'refs/remotes/origin/master'));
});

test('qualified Semgrep detects missing positives and contaminated negatives with its real engine', async (t) => {
  const lock = JSON.parse(readFileSync(join(root, 'planning/security-scanners.lock.json')));
  const platform = selectPlatform(process.platform, process.arch);
  const selected = lock.semgrep.platforms[platform];
  // The local coverage runner deliberately removes developer directories from
  // PATH. Qualify this real native prerequisite before exposing its directory to
  // the isolated scanner bootstrap; production runner admission is unchanged.
  const python = process.platform === 'darwin' ? '/opt/homebrew/bin/python3.12' : 'python3.12';
  assert.equal(
    execFileSync(
      python,
      ['-c', 'import platform; print(platform.python_version()); print(platform.machine())'],
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    ).trim(),
    `3.12.9\n${platform === 'darwin-arm64' ? 'arm64' : 'x86_64'}`,
    'qualified native Python is required',
  );
  // This is an explicit native qualification command. Missing cached prerequisites
  // fail before bootstrap; this test never starts an implicit artifact download.
  for (const name of selected.wheelFiles) {
    const path = join(root, '.checks/security-scanners/downloads', name);
    assert.ok(existsSync(path), 'qualified scanner wheel cache is required');
    verifyBytes(readFileSync(path), lock.semgrep.wheels[name].sha256);
  }
  const previousPath = process.env.PATH;
  let tool;
  try {
    if (process.platform === 'darwin') process.env.PATH = `${dirname(python)}:${previousPath || ''}`;
    tool = await installScanner('semgrep');
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  t.after(() => tool.cleanup());
  const config = join(root, 'tools/security/semgrep.yml');
  const original = JSON.parse(readFileSync(join(root, 'tools/security/rule-fixtures.json')));
  const attempt = (name, fixtures) => {
    const directory = join(tool.directory, name);
    mkdirSync(directory);
    return () => verifyRuleFixtures({ ...tool, directory }, config, JSON.stringify(fixtures));
  };
  assert.deepEqual(attempt('control', original)(), { rules: 22, fixtures: 44 });
  assert.throws(attempt('missing-rule', original.slice(1)), /fixture coverage mismatch/);
  const invalidLanguage = structuredClone(original);
  invalidLanguage[0].language = 'unqualified-language';
  assert.throws(attempt('invalid-language', invalidLanguage), /Invalid Semgrep fixture/);
  const missingPositives = original.map((row) => ({ ...row, bad: row.good }));
  assert.throws(attempt('missing-positives', missingPositives), /did not detect rule canaries completely/);
  const contaminatedNegative = structuredClone(original);
  contaminatedNegative[0].good = contaminatedNegative[0].bad;
  assert.throws(attempt('contaminated-negative', contaminatedNegative), /positive\/negative rule regression/);
});

test('qualified scanner bootstrap rejects corrupted inputs and executor failures with atomic cleanup', async (t) => {
  const lockPath = join(root, 'planning/security-scanners.lock.json');
  const lock = JSON.parse(readFileSync(lockPath));
  const platform = selectPlatform(process.platform, process.arch);
  const selected = lock.semgrep.platforms[platform];
  for (const name of selected.wheelFiles) {
    const path = join(root, '.checks/security-scanners/downloads', name);
    assert.ok(existsSync(path), 'qualified scanner wheel cache is required');
    verifyBytes(readFileSync(path), lock.semgrep.wheels[name].sha256);
  }
  const gitleaksAsset = lock.gitleaks.platforms[platform];
  const gitleaksCache = join(root, '.checks/security-scanners/downloads', gitleaksAsset.filename);
  assert.ok(existsSync(gitleaksCache), 'qualified Gitleaks cache is required');
  verifyBytes(readFileSync(gitleaksCache), gitleaksAsset.sha256);
  const python = process.platform === 'darwin' ? '/opt/homebrew/bin/python3.12' : 'python3.12';
  assert.equal(
    execFileSync(
      python,
      ['-c', 'import platform; print(platform.python_version()); print(platform.machine())'],
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    ).trim(),
    `3.12.9\n${platform === 'darwin-arm64' ? 'arm64' : 'x86_64'}`,
  );
  const originalRead = fs.readFileSync;
  const originalSpawn = childProcess.spawnSync;
  const previousPath = process.env.PATH;
  const installRoot = join(root, '.checks/security-scanners');
  const installs = () =>
    readdirSync(installRoot)
      .filter((name) => /^(semgrep|gitleaks)-/.test(name))
      .sort();
  const cases = [
    {
      name: 'schema',
      scanner: 'semgrep',
      mutate: (value) => {
        value.schemaVersion = -1;
      },
      error: /Unsupported scanner lock/,
    },
    {
      name: 'requirements-path',
      scanner: 'semgrep',
      mutate: (value) => {
        value.semgrep.platforms[platform].requirements = '../outside';
      },
    },
    {
      name: 'empty-wheel-graph',
      scanner: 'semgrep',
      mutate: (value) => {
        value.semgrep.platforms[platform].wheelFiles = [];
      },
    },
    {
      name: 'wheel-identity',
      scanner: 'semgrep',
      mutate: (value) => {
        value.semgrep.wheels[selected.wheelFiles[0]].filename = 'wrong.whl';
      },
    },
    {
      name: 'python-probe',
      scanner: 'semgrep',
      fail: (file, args) => file === 'python3.12' && args[0] === '-c',
    },
    {
      name: 'venv-create',
      scanner: 'semgrep',
      fail: (file, args) => file === 'python3.12' && args[1] === 'venv',
    },
    {
      name: 'pip-install',
      scanner: 'semgrep',
      fail: (_file, args) => args[1] === 'pip' && args.includes('install'),
    },
    {
      name: 'pip-check',
      scanner: 'semgrep',
      fail: (_file, args) => args[1] === 'pip' && args.includes('check'),
    },
    { name: 'archive-extraction', scanner: 'gitleaks', fail: (file) => file === 'tar' },
    {
      name: 'binary-version',
      scanner: 'gitleaks',
      fail: (file, args) => file.endsWith('/gitleaks') && args[0] === 'version',
      wrongVersion: true,
    },
  ];
  try {
    if (process.platform === 'darwin') process.env.PATH = `${dirname(python)}:${previousPath || ''}`;
    for (const item of cases) {
      const before = installs();
      let injected = 0;
      const readHook = t.mock.method(fs, 'readFileSync', function (path, ...args) {
        if (String(path) === lockPath && item.mutate) {
          const value = structuredClone(lock);
          item.mutate(value);
          injected++;
          return Buffer.from(JSON.stringify(value));
        }
        return originalRead.call(this, path, ...args);
      });
      const spawnHook = t.mock.method(childProcess, 'spawnSync', function (file, args, options) {
        if (item.fail?.(file, args)) {
          injected++;
          // Only this explicit failure boundary is substituted. Other probes,
          // environment creation and hash-locked installation execute normally.
          // The failing child is real; no successful scanner report is invented.
          return originalSpawn(
            process.execPath,
            ['-e', item.wrongVersion ? 'console.log("0.0.0")' : 'process.exit(23)'],
            {
              ...options,
              timeout: 10000,
            },
          );
        }
        return originalSpawn.call(this, file, args, options);
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(installScanner(item.scanner), item.error ?? /Qualified .* bootstrap failed/);
        assert.ok(injected > 0, `intended failure boundary was reached: ${item.name}`);
        assert.deepEqual(installs(), before, `partial scanner installation leaked: ${item.name}`);
      } finally {
        readHook.mock.restore();
        spawnHook.mock.restore();
        syncBuiltinESMExports();
      }
    }
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});
