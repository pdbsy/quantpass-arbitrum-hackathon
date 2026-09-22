import assert from 'node:assert/strict';
import fs, { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { installScanner, selectPlatform, verifyBytes } from '../tools/security/bootstrap.mjs';
import { verifyRuleFixtures } from '../tools/ci/check-semgrep.mjs';

const root = resolve(import.meta.dirname, '..');

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
