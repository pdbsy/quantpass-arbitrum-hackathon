import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runCheck } from '../tools/management-dashboard/checks.mjs';
import { npmCli } from '../tools/environment/observe.mjs';

test('registered integration executes the approved Node and confirms cleanup without inherited PATH', async (t) => {
  // Detects a launcher that relies on PATH, dispatches the wrong registered
  // arguments, skips the real child, or claims success without confirmed cleanup.
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), 'alphaforge-management-public-entry-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const nonce = randomUUID();
  const receiptPath = join(root, 'receipt.json');
  const testPath = join(root, 'test/server.test.ts');
  await mkdir(join(root, 'test'));
  await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n');
  await writeFile(
    testPath,
    `import { writeFileSync } from 'node:fs';
import test from 'node:test';
test('private registered integration receipt', () => {
  writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({
    nonce: ${JSON.stringify(nonce)}, executable: process.execPath,
    cwd: process.cwd(), testPath: process.argv[1], path: process.env.PATH,
  }), { flag: 'wx' });
});

`,
  );
  const parentPath = Object.entries(process.env).filter(([key]) => key.toUpperCase() === 'PATH');
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.toUpperCase() === 'PATH') delete environment[key];
  const program = `
import assert from 'node:assert/strict';
import { runCheck } from ${JSON.stringify(new URL('../tools/management-dashboard/checks.mjs', import.meta.url).href)};
// Windows spawn may restore an omitted PATH. Establish the
// no-PATH input in this owned process immediately before the public entry.
for (const key of Object.keys(process.env)) if (key.toUpperCase() === 'PATH') delete process.env[key];
assert.equal(Object.keys(process.env).some(key => key.toUpperCase() === 'PATH'), false);
const result = await runCheck('integration', {
  root: ${JSON.stringify(root)}, commit: 'a'.repeat(40), runId: 'public-entry-no-path',
});
process.stdout.write(JSON.stringify({ nonce: ${JSON.stringify(nonce)}, result }));
`;
  // The outer watchdog exceeds the fixed 120s production timeout plus cleanup.
  // The fixture has no timers, server, or descendant process of its own.
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 150_000,
    maxBuffer: 256 * 1024,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  assert.deepEqual(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() === 'PATH'),
    parentPath,
  );
  const observed = JSON.parse(run.stdout);
  assert.equal(observed.nonce, nonce);
  assert.equal(observed.result.record.id, 'integration');
  assert.equal(observed.result.record.status, 'PASS');
  assert.equal(observed.result.record.exitCode, 0);
  assert.equal(observed.result.cleanupConfirmed, true);
  assert.doesNotMatch(observed.result.log, /PROCESS_ERROR|TIMEOUT|CLEANUP_UNCONFIRMED/);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.nonce, nonce);
  assert.equal(realpathSync.native(receipt.executable), realpathSync.native(process.execPath));
  assert.equal(realpathSync.native(receipt.cwd), root);
  assert.equal(realpathSync.native(resolve(root, receipt.testPath)), realpathSync.native(testPath));
  assert.equal(receipt.path, dirname(process.execPath) + delimiter);
  t.diagnostic(JSON.stringify({ nonce, launcher: observed.result.record.id, cleanupConfirmed: true }));
});

function nativeIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const result = spawnSync(
    '/bin/ps',
    ['-p', String(pid), '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart=', '-o', 'command='],
    {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 16384,
      env: { ...process.env, LC_ALL: 'C' },
    },
  );
  assert.equal(result.error, undefined);
  if (result.status === 1 && result.stdout.trim() === '') return null;
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
  assert.ok(match, 'native process identity must be available');
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    pgid: Number(match[3]),
    start: match[4],
    command: match[5],
  };
}

async function waitReceipt(path) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  assert.fail('owned fixture did not publish its ready receipt');
}

async function runOwnedLintFixture(t, retainedDescendant, { afterAssertions, removeFixture = rm } = {}) {
  // Fail before launching anything if native identity observation is unavailable.
  assert.ok(nativeIdentity(process.pid));
  const npm = npmCli();
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), 'alphaforge-management-owned-')));
  const nonce = randomUUID();
  const leafPath = join(root, 'leaf.mjs');
  const readyPath = join(root, 'ready.json');
  const releasePath = join(root, 'release');
  const exitPath = join(root, 'leader-exit.json');
  const lifetime = retainedDescendant ? 15_000 : 180_000;
  let child;
  let parentIdentity;
  let leaf;
  let leafRetired = false;
  let observationError;
  let watchdog;
  let resultPromise;
  let observedResult;
  let failure;
  const failures = [];
  const events = [];
  const started = performance.now();
  // Node's native diagnostic publication is observed only. No spawn, timer,
  // kill, private function, or production judgement is replaced.
  const observeChild = ({ process: candidate }) => {
    candidate.once('spawn', () => {
      if (candidate.spawnargs[1] !== npm || candidate.spawnargs.slice(2).join(' ') !== 'run lint') return;
      try {
        assert.equal(child, undefined, 'one real registered npm child');
        child = candidate;
        candidate.once('exit', (code, signal) =>
          events.push({ event: 'exit', code, signal, elapsed: performance.now() - started }),
        );
        candidate.once('close', (code, signal) =>
          events.push({ event: 'close', code, signal, elapsed: performance.now() - started }),
        );
        parentIdentity = nativeIdentity(candidate.pid);
        assert.equal(parentIdentity.pgid, candidate.pid);
      } catch (error) {
        observationError = error;
      }
    });
  };
  const diagnostics = channel('child_process');
  try {
    await writeFile(
      leafPath,
      `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
${nativeIdentity.toString()}
const expiresAt = Date.now() + ${lifetime};
setTimeout(() => process.exit(91), ${lifetime});
const receipt = { nonce: ${JSON.stringify(nonce)}, executable: process.execPath, cwd: process.cwd(), expiresAt, identity: nativeIdentity(process.pid) };
writeFileSync(${JSON.stringify(readyPath + '.tmp')}, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
renameSync(${JSON.stringify(readyPath + '.tmp')}, ${JSON.stringify(readyPath)});
`,
    );
    if (retainedDescendant) {
      await writeFile(
        join(root, 'leader.mjs'),
        `
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
setTimeout(() => process.exit(92), 20000);
const descendant = spawn(process.execPath, [${JSON.stringify(leafPath)}, ${JSON.stringify(nonce)}], { detached: false, stdio: 'ignore' });
descendant.once('error', () => process.exit(93));
descendant.unref();
while (!existsSync(${JSON.stringify(releasePath)})) await delay(25);
process.once('exit', code => writeFileSync(${JSON.stringify(exitPath)}, JSON.stringify({ nonce: ${JSON.stringify(nonce)}, code }), { flag: 'wx', mode: 0o600 }));
process.exit(0);
`,
      );
    }
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        scripts: { lint: retainedDescendant ? 'node leader.mjs' : `node leaf.mjs ${nonce}` },
      }),
    );
    diagnostics.subscribe(observeChild);
    resultPromise = runCheck('lint', {
      root,
      commit: 'a'.repeat(40),
      runId: retainedDescendant ? 'owned-retained-group' : 'owned-real-timeout',
    });
    resultPromise.catch(() => {});
    leaf = await waitReceipt(readyPath);
    if (observationError) throw observationError;
    assert.ok(child && parentIdentity);
    assert.equal(leaf.nonce, nonce);
    assert.equal(realpathSync.native(leaf.executable), realpathSync.native(process.execPath));
    assert.equal(realpathSync.native(leaf.cwd), root);
    assert.equal(leaf.identity.pgid, parentIdentity.pgid);
    assert.ok(
      leaf.identity.command.includes(leafPath) || leaf.identity.command.includes(`leaf.mjs ${nonce}`),
    );
    assert.ok(leaf.identity.command.endsWith(nonce));
    assert.deepEqual(nativeIdentity(leaf.identity.pid), leaf.identity);
    assert.ok(leaf.expiresAt > Date.now() + (retainedDescendant ? 5000 : 125_000));
    if (retainedDescendant) await writeFile(releasePath, nonce, { flag: 'wx', mode: 0o600 });
    observedResult = await Promise.race([
      resultPromise,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('owned fixture outer watchdog expired')), 150_000);
      }),
    ]);
    const elapsed = performance.now() - started;
    assert.equal(observedResult.record.id, 'lint');
    assert.equal(observedResult.record.status, 'FAIL');
    const exit = events.find((event) => event.event === 'exit');
    const close = events.find((event) => event.event === 'close');
    assert.ok(exit && close, 'actual npm exit and close observed');
    if (retainedDescendant) {
      assert.deepEqual(JSON.parse(await readFile(exitPath, 'utf8')), { nonce, code: 0 });
      assert.equal(exit.code, 0);
      assert.equal(exit.signal, null);
      assert.ok(close.elapsed < 15_000, 'real parent closes early with descendant stdio ignored');
      assert.equal(observedResult.record.exitCode, 127);
      assert.equal(observedResult.cleanupConfirmed, false);
      assert.match(observedResult.log, /CLEANUP_UNCONFIRMED/);
      assert.doesNotMatch(observedResult.log, /TIMEOUT|PROCESS_ERROR/);
    } else {
      assert.equal(exit.code, null);
      assert.equal(exit.signal, 'SIGTERM');
      assert.ok(elapsed >= 120_000 && elapsed < 150_000, 'real fixed timeout and bounded completion');
      assert.equal(observedResult.record.exitCode, 124);
      assert.equal(observedResult.cleanupConfirmed, true, 'POSIX prompt group cleanup must be confirmed');
      assert.match(observedResult.log, /TIMEOUT/);
      assert.doesNotMatch(observedResult.log, /CLEANUP_UNCONFIRMED|PROCESS_ERROR/);
    }
    const remainingLeaf = nativeIdentity(leaf.identity.pid);
    if (remainingLeaf === null) leafRetired = true;
    assert.equal(remainingLeaf, null, 'owned leaf must disappear');
    afterAssertions?.();
    t.diagnostic(
      JSON.stringify({
        scenario: retainedDescendant ? 'P2' : 'P5',
        nonce,
        parentIdentity,
        leaf,
        events,
        elapsed,
        result: observedResult,
      }),
    );
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(watchdog);
    diagnostics.unsubscribe(observeChild);
    if (retainedDescendant) {
      // A partial-startup leader may still be awaiting its private release file.
      // Release only our own fixture; its exit cannot bypass production cleanup.
      try {
        await writeFile(releasePath, nonce, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') failures.push(error);
      }
    }
    // On a partial startup, obtain the private receipt if it was published.
    if (!leaf) {
      try {
        leaf = JSON.parse(await readFile(readyPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') failures.push(error);
      }
    }
    if (leaf && !leafRetired) {
      try {
        assert.equal(leaf.nonce, nonce);
        const current = nativeIdentity(leaf.identity.pid);
        if (!current) leafRetired = true;
        else {
          // Parent PID can change after reparenting; birth, group, and command cannot.
          for (const key of ['pid', 'pgid', 'start', 'command'])
            assert.equal(current[key], leaf.identity[key]);
          assert.ok(current.command.endsWith(nonce));
          assert.equal(realpathSync.native(leaf.executable), realpathSync.native(process.execPath));
          process.kill(current.pid, 'SIGKILL');
          for (let attempt = 0; attempt < 100; attempt++) {
            const remaining = nativeIdentity(current.pid);
            if (!remaining) {
              leafRetired = true;
              break;
            }
            assert.equal(remaining.start, current.start);
            assert.equal(remaining.command, current.command);
            await delay(25);
            if (attempt === 99) assert.fail('owned leaf survived cleanup');
          }
        }
      } catch (error) {
        if (error.code !== 'ESRCH') failures.push(error);
      }
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch (error) {
        failures.push(error);
      }
    }
    if (resultPromise && !observedResult) {
      const settled = await Promise.race([
        resultPromise.then(
          () => true,
          () => true,
        ),
        delay(5000).then(() => false),
      ]);
      if (!settled) failures.push(new Error('registered process failed to settle during cleanup'));
    }
    // Preserve an unconfirmed fixture and its finite-life receipt for diagnosis.
    if (!failures.length) {
      try {
        await removeFixture(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failure || failures.length)
      t.diagnostic(
        JSON.stringify({
          scenario: retainedDescendant ? 'P2' : 'P5',
          nonce,
          root,
          parentIdentity,
          leaf,
          events,
          result: observedResult,
          failure: failure?.message,
          cleanupFailures: failures.map((error) => error.message),
        }),
      );
  }
  if (failures.length)
    throw new AggregateError(
      failure ? [failure, ...failures] : failures,
      'identity-bound cleanup must complete',
    );
  if (failure) throw failure;
}

test(
  'retained same-group descendant makes an early successful npm close fail cleanup admission',
  {
    skip: process.platform === 'win32' ? 'NOT_RUN: requires native POSIX process groups' : false,
  },
  async (t) => runOwnedLintFixture(t, true),
);

test(
  'real fixed lint timeout closes the POSIX group promptly with confirmed cleanup',
  {
    skip:
      process.platform === 'win32'
        ? 'NOT_RUN: Windows timeout cleanup has separate unconfirmed semantics'
        : false,
  },
  async (t) => runOwnedLintFixture(t, false),
);

test(
  'FAULT_INJECTED fixture removal failure preserves the original assertion and cleanup error',
  { skip: process.platform === 'win32' ? 'NOT_RUN: uses the native POSIX retained-group fixture' : false },
  async (t) => {
    let primary;
    let removals = 0;
    const cleanup = new Error('FAULT_INJECTED fixture removal failure');
    await assert.rejects(
      runOwnedLintFixture(t, true, {
        afterAssertions() {
          try {
            assert.fail('FAULT_INJECTED primary fixture assertion');
          } catch (error) {
            primary = error;
            throw error;
          }
        },
        async removeFixture(path, options) {
          // Fault only the test utility's cleanup boundary, after actual owned
          // removal. No production function, process, timer, or counter is patched.
          removals++;
          await rm(path, options);
          assert.throws(() => realpathSync.native(path), { code: 'ENOENT' });
          throw cleanup;
        },
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.ok(primary instanceof assert.AssertionError);
        assert.deepEqual(error.errors, [primary, cleanup]);
        return true;
      },
    );
    assert.equal(removals, 1);
  },
);
