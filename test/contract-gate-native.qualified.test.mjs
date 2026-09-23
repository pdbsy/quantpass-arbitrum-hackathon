import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixtureExec } from './helpers/git-fixture.mjs';

// Native qualification requires the approved Python and network access to the
// hash-pinned Slither index. A copied cache alone is not an offline wheelhouse.
const repository = fileURLToPath(new URL('../', import.meta.url));

test(
  'native contract gate rejects a mismatched compiler declaration after verified bootstrap',
  {
    skip: process.platform !== 'darwin' || process.arch !== 'arm64',
    timeout: 300000,
  },
  (t) => {
    const parent = mkdtempSync(join(tmpdir(), 'alphaforge-contract-gate-negative-'));
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    const destination = join(parent, 'repo');
    const git = (cwd, ...args) => fixtureExec('git', args, { cwd, encoding: 'utf8' }).trim();
    const head = git(repository, 'rev-parse', 'HEAD');
    git(parent, 'clone', '--quiet', '--no-hardlinks', '--no-checkout', repository, destination);
    const root = realpathSync(destination);
    git(root, 'checkout', '--quiet', '--detach', head);
    for (const directory of ['downloads', 'pip-cache']) {
      const relative = join('.checks/af-chain01/toolchain', directory);
      cpSync(join(repository, relative), join(root, relative), { recursive: true });
    }
    const lockPath = join(root, 'contracts/toolchain.lock.json');
    const originalLock = readFileSync(lockPath);
    const lock = JSON.parse(originalLock);
    // Change only the declared version in an isolated negative fixture. The
    // actual compiler archive and all hash verification remain unchanged.
    lock.solc.longVersion = '0.0.0-negative-fixture';
    const fixtureLock = JSON.stringify(lock, null, 2) + '\n';
    writeFileSync(lockPath, fixtureLock);
    git(root, 'add', 'contracts/toolchain.lock.json');
    git(
      root,
      '-c',
      'user.name=Contract gate fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Isolated negative compiler declaration',
    );
    const fixtureHead = git(root, 'rev-parse', 'HEAD');
    const child = spawnSync(process.execPath, ['tools/ci/verify-contracts.mjs'], {
      cwd: root,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
      encoding: 'utf8',
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 2, child.stderr);
    const report = JSON.parse(child.stdout.trim().split('\n').at(-1));
    assert.equal(report.gate, 'contracts-m3-macos');
    assert.equal(report.head, fixtureHead);
    assert.equal(report.sourceHead, fixtureHead);
    assert.equal(report.trackedClean, true);
    assert.equal(report.contractLockSha256, createHash('sha256').update(fixtureLock).digest('hex'));
    assert.equal(report.state, 'BLOCKED');
    assert.equal(report.abi, 'NOT_RUN');
    assert.deepEqual(
      report.stages,
      [
        { stage: 'bootstrap', state: 'PASS', exitCode: 0, incomplete: false },
        { stage: 'compiler-probe', state: 'BLOCKED', exitCode: 2, incomplete: true },
      ],
      child.stderr.slice(-6000),
    );
    assert.match(child.stdout, /Verified and installed solc 0\.8\.31/);
    assert.doesNotMatch(child.stdout, /Phase One contract manifest matches/);
    assert.equal(git(root, 'status', '--porcelain', '--untracked-files=no'), '');
    assert.equal(git(repository, 'rev-parse', 'HEAD'), head);
    assert.deepEqual(readFileSync(join(repository, 'contracts/toolchain.lock.json')), originalLock);
  },
);
