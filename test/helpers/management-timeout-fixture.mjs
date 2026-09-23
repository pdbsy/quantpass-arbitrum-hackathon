import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function groupExists(group) {
  if (!group || group.retired) return false;
  try {
    process.kill(-group.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      group.retired = true;
      return false;
    }
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

function killFixtureGroup(group) {
  if (!groupExists(group)) return;
  try {
    process.kill(-group.pid, 'SIGKILL');
  } catch (error) {
    if (error.code === 'ESRCH') group.retired = true;
    else throw error;
  }
}

async function confirmGone(group) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!groupExists(group)) return;
    await delay(25);
  }
  assert.fail(`fixture process group ${group.pid} survived cleanup`);
}

export async function runEscapedPipeTimeoutFixture() {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-management-timeout-'));
  const pidPath = join(root, 'descendant.pid');
  const resultPath = join(root, 'result.json');
  const syntheticToken = `${'gh' + 'p_'}ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`;
  const holdCode = `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    writeFileSync(${JSON.stringify(pidPath)}, String(grandchild.pid));
    grandchild.unref();
    console.log(${JSON.stringify(syntheticToken)});
  `;
  const checksUrl = new URL('../../tools/management-dashboard/checks.mjs', import.meta.url).href;
  const harnessCode = `
    import { writeFileSync } from 'node:fs';
    import { runCheck } from ${JSON.stringify(checksUrl)};
    const result = await runCheck('lint', {
      root: ${JSON.stringify(root)},
      commit: 'f'.repeat(40),
      runId: 'native-timeout-fixture',
      maxLogBytes: 160,
    });
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));
  `;
  let supervisor;
  let supervisorGroup;
  let completed;
  let descendantGroup;
  let stderr = '';
  let observed;
  let failure;
  const cleanupErrors = [];
  const started = Date.now();
  try {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'alphaforge-management-timeout-fixture',
        version: '1.0.0',
        private: true,
        scripts: { lint: 'node hold.mjs' },
      }),
    );
    await writeFile(join(root, 'hold.mjs'), holdCode);
    supervisor = spawn(process.execPath, ['--input-type=module', '-e', harnessCode], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(Number.isInteger(supervisor.pid) && supervisor.pid > 0);
    supervisorGroup = { pid: supervisor.pid, retired: false };
    supervisor.once('exit', () => groupExists(supervisorGroup));
    supervisor.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    supervisor.stdout.resume();
    completed = new Promise((resolve) => supervisor.once('close', resolve));

    while (!existsSync(pidPath) && Date.now() - started < 15_000) await delay(50);
    assert.ok(existsSync(pidPath), `native fixture did not launch: ${stderr}`);
    const descendantPid = Number(await readFile(pidPath, 'utf8'));
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
    descendantGroup = { pid: descendantPid, retired: false };
    assert.equal(groupExists(descendantGroup), true);

    while (!existsSync(resultPath) && Date.now() - started < 135_000) await delay(100);
    const elapsedMs = Date.now() - started;
    const settledBeforeRelease = existsSync(resultPath);
    assert.equal(groupExists(descendantGroup), true);
    const result = settledBeforeRelease ? JSON.parse(await readFile(resultPath, 'utf8')) : null;
    if (settledBeforeRelease) {
      const exitCode = await Promise.race([
        completed,
        delay(5_000).then(() => {
          throw new Error('native timeout harness did not exit');
        }),
      ]);
      assert.equal(exitCode, 0, stderr);
    }
    observed = { settledBeforeRelease, elapsedMs, result, syntheticToken };
  } catch (error) {
    failure = error;
  } finally {
    const attempt = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    await attempt(() => killFixtureGroup(descendantGroup));
    await attempt(() => killFixtureGroup(supervisorGroup));
    if (completed) await attempt(() => Promise.race([completed, delay(5_000)]));
    await attempt(() => confirmGone(descendantGroup));
    await attempt(() => confirmGone(supervisorGroup));
    await attempt(() => rm(root, { recursive: true, force: true }));
  }
  if (failure && cleanupErrors.length)
    throw new AggregateError([failure, ...cleanupErrors], 'native timeout fixture and cleanup failed');
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'native timeout fixture cleanup failed');
  return observed;
}

export async function runSynchronousKillErrorFixture({ waitForTimeout = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-management-kill-error-'));
  const resultPath = join(root, 'result.json');
  const checksUrl = new URL('../../tools/management-dashboard/checks.mjs', import.meta.url).href;
  const harnessCode = `
    import cp from 'node:child_process';
    import { EventEmitter } from 'node:events';
    import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { PassThrough } from 'node:stream';
    import { runCheck, runChecks } from ${JSON.stringify(checksUrl)};
    class FakeChild extends EventEmitter {
      pid = 424242;
      exitCode = null;
      signalCode = null;
      stdout = new PassThrough();
      stderr = new PassThrough();
      unref() {}
    }
    let child;
    const originalKill = process.kill;
    let signalCalls = 0;
    process.kill = (pid, signal) => {
      if (pid === -child.pid && signal === 0) return true;
      if (pid === -child.pid && (signal === 'SIGKILL' || signal === 'SIGTERM')) {
        signalCalls++;
        if (signalCalls <= 5)
          child.emit('error', new Error('FAULT_INJECTED synchronous group signal denial'));
        return true;
      }
      return originalKill(pid, signal);
    };
    cp.spawn = () => {
      child = new FakeChild();
      if (!${waitForTimeout})
        queueMicrotask(() => child.emit('error', new Error('FAULT_INJECTED initial child error')));
      return child;
    };
    syncBuiltinESMExports();
    const result = await runCheck('lint', {
      root: ${JSON.stringify(root)},
      commit: 'f'.repeat(40),
      runId: 'sync-kill-error-fixture',
    });
    child.emit('error', new Error('FAULT_INJECTED late child error'));
    child.emit('close', 0);
    // Let both deferred cleanup deadlines pass to detect signals scheduled after settlement.
    if (${waitForTimeout}) await new Promise(resolve => setTimeout(resolve, 2300));
    const checkSignalCalls = signalCalls;
    let evidence;
    if (!${waitForTimeout}) {
      signalCalls = 0;
      const root = ${JSON.stringify(root)};
      mkdirSync(root + '/.checks/management', { recursive: true });
      const latest = root + '/.checks/management/latest.json';
      writeFileSync(latest, 'previous complete evidence');
      let errorMessage;
      try {
        await runChecks({
          root,
          profile: 'quick',
          runId: 'sync-error-evidence',
          collectGitState: async () => ({
            status: 'READY', commit: 'f'.repeat(40), tree: 'e'.repeat(40),
            branch: 'fixture/sync-error', dirtyFiles: 0,
          }),
        });
      } catch (error) { errorMessage = error.message; }
      child.emit('error', new Error('FAULT_INJECTED late collector child error'));
      child.emit('close', 0);
      evidence = {
        errorMessage, signalCalls,
        latest: readFileSync(latest, 'utf8'),
        files: readdirSync(root + '/.checks/management/sync-error-evidence'),
      };
    }
    process.kill = originalKill;
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ result, signalCalls: checkSignalCalls, evidence }));
  `;
  let supervisor;
  let supervisorGroup;
  let completed;
  let failure;
  let observed;
  let stderr = '';
  const cleanupErrors = [];
  try {
    supervisor = spawn(process.execPath, ['--input-type=module', '-e', harnessCode], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(Number.isInteger(supervisor.pid) && supervisor.pid > 0);
    supervisorGroup = { pid: supervisor.pid, retired: false };
    supervisor.once('exit', () => groupExists(supervisorGroup));
    supervisor.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(0, 2000);
    });
    supervisor.stdout.resume();
    completed = new Promise((resolve) => supervisor.once('close', resolve));
    let deadline;
    const exitCode = await Promise.race([
      completed,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('synchronous kill-error harness did not exit')),
          waitForTimeout ? 135_000 : 5_000,
        );
      }),
    ]).finally(() => clearTimeout(deadline));
    assert.equal(exitCode, 0, stderr);
    observed = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch (error) {
    failure = error;
  } finally {
    const attempt = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    await attempt(() => killFixtureGroup(supervisorGroup));
    if (completed) await attempt(() => Promise.race([completed, delay(5_000)]));
    await attempt(() => confirmGone(supervisorGroup));
    await attempt(() => rm(root, { recursive: true, force: true }));
  }
  if (failure && cleanupErrors.length)
    throw new AggregateError([failure, ...cleanupErrors], 'kill-error fixture and cleanup failed');
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'kill-error fixture cleanup failed');
  return observed;
}
