import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CHECK_REGISTRY } from '../tools/management-dashboard/checks.mjs';
import { fixtureExec } from './helpers/git-fixture.mjs';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function inspectOwnedPid(identity, terminate = false) {
  if (terminate && !alive(identity.pid)) return;
  // Windows PowerShell is an existing OS component. Hold an actual process
  // handle and verify its start time, ancestry and command before termination;
  // a stale PID file must never authorize killing a reused PID.
  const encodedIdentity = Buffer.from(JSON.stringify(identity)).toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedIdentity}')) | ConvertFrom-Json
$ownedProcess = Get-Process -Id $expected.pid -ErrorAction SilentlyContinue
if ($null -eq $ownedProcess) { exit 0 }
try {
  $null = $ownedProcess.Handle
  if ($ownedProcess.HasExited) { exit 0 }
  $metadata = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $expected.pid)
  if ($ownedProcess.HasExited) { exit 0 }
  if ($null -eq $metadata -or
      $metadata.ParentProcessId -ne $expected.parentPid -or
      $ownedProcess.StartTime.ToUniversalTime() -lt [DateTime]::Parse($expected.startedAfter).ToUniversalTime() -or
      -not $metadata.CommandLine.Contains($expected.commandPart) -or
      [IO.Path]::GetFullPath($metadata.ExecutablePath) -ine [IO.Path]::GetFullPath($expected.executable)) {
    throw 'Fixture process identity changed; refusing PID cleanup'
  }
  $startTicks = $ownedProcess.StartTime.ToUniversalTime().Ticks.ToString()
  if (${terminate ? '$true' : '$false'}) {
    if ($startTicks -ne $expected.startTicks) { throw 'PID birth identity changed; refusing cleanup' }
    $ownedProcess.Kill()
    if (-not $ownedProcess.WaitForExit(3000)) { throw 'Owned process survived cleanup' }
  } else { [Console]::Out.Write($startTicks) }
} finally { $ownedProcess.Dispose() }
`;
  const cleanup = spawnSync(
    join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', timeout: 8000, maxBuffer: 4096, windowsHide: true, shell: false },
  );
  assert.equal(cleanup.error, undefined);
  assert.equal(cleanup.status, 0, cleanup.stderr);
  if (!terminate) {
    assert.match(cleanup.stdout, /^[0-9]+$/);
    return { ...identity, startTicks: cleanup.stdout };
  }
}

function cleanupFixture(identities) {
  const errors = [];
  for (const identity of identities) {
    try {
      inspectOwnedPid(identity, true);
    } catch (error) {
      errors.push(error);
    }
  }
  assert.deepEqual(errors, [], 'all owned fixture processes must be cleaned up');
}

test(
  'Windows management integration timeout returns bounded FAIL without claiming process-tree cleanup',
  { skip: process.platform !== 'win32' ? 'Requires a real Windows runner and fixed 120s timeout' : false },
  async () => {
    const integration = CHECK_REGISTRY.find((check) => check.id === 'integration');
    assert.equal(integration.file, 'node');
    assert.deepEqual(integration.args, ['--test', 'test/server.test.ts']);
    assert.equal(integration.timeoutMs, 120_000);
    const root = await mkdtemp(join(tmpdir(), 'alphaforge-management-windows-timeout-'));
    const nonce = randomUUID();
    const pidPath = join(root, 'fixture-pids.json');
    const resultPath = join(root, 'result.json');
    const repository = resolve(import.meta.dirname, '..');
    const commit = fixtureExec('git', ['rev-parse', 'HEAD'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    let outer;
    let watchdog;
    let completion;
    let stderr = '';
    let startedAfter;
    const identities = [];
    const outputLimit = 4096;
    try {
      await mkdir(join(root, 'test'));
      await writeFile(join(root, 'package.json'), '{"type":"module","private":true}\n');
      await writeFile(
        join(root, 'test/server.test.ts'),
        `import { renameSync, writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidPath + '.tmp')}, JSON.stringify({ nonce: ${JSON.stringify(nonce)}, pid: process.pid, parentPid: process.ppid }), { flag: 'wx' });
renameSync(${JSON.stringify(pidPath + '.tmp')}, ${JSON.stringify(pidPath)});
process.stdout.write('WINDOWS_TIMEOUT_FIXTURE\\n' + 'x'.repeat(16384));
process.stderr.write('y'.repeat(16384));
setInterval(() => {}, 1000);
// Last-resort fixture lifetime; later than the independent outer watchdog.
setTimeout(() => process.exit(99), 180000);
`,
      );
      const program = `
import { writeFile } from 'node:fs/promises';
import { runCheck } from ${JSON.stringify(new URL('../tools/management-dashboard/checks.mjs', import.meta.url).href)};
const result = await runCheck('integration', {
  root: ${JSON.stringify(root)}, commit: ${JSON.stringify(commit)},
  runId: 'windows-native-timeout', maxLogBytes: 256,
});
await writeFile(${JSON.stringify(resultPath)}, JSON.stringify(result), { flag: 'wx' });
`;
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
      );
      const currentPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1];
      environment.PATH = [dirname(process.execPath), currentPath || ''].join(delimiter);
      const started = performance.now();
      startedAfter = new Date().toISOString();
      outer = spawn(process.execPath, ['--input-type=module', '--eval', program], {
        cwd: root,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      outer.stdout.on('data', () => {});
      outer.stderr.on('data', (bytes) => {
        stderr = (stderr + bytes.toString()).slice(0, outputLimit);
      });
      // Wait for the owned outer process, not inherited pipe closure: the
      // regression being tested can leave descendant pipe handles open.
      completion = new Promise((resolveExit, reject) => {
        outer.once('error', reject);
        outer.once('exit', (code, signal) => resolveExit({ code, signal }));
      });
      const deadline = new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Windows timeout outer watchdog expired')), 160_000);
      });
      const exercise = async () => {
        let owned;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            owned = JSON.parse(await readFile(pidPath, 'utf8'));
            break;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await delay(100);
          }
        }
        assert.equal(owned?.nonce, nonce, 'the fixed registry command must start the fixture');
        assert.notEqual(owned.pid, owned.parentPid);
        for (const identity of [
          { pid: owned.pid, parentPid: owned.parentPid, commandPart: join(root, 'test/server.test.ts') },
          { pid: owned.parentPid, parentPid: outer.pid, commandPart: 'test/server.test.ts' },
        ]) {
          assert.ok(Number.isInteger(identity.pid) && identity.pid > 0);
          assert.notEqual(identity.pid, process.pid);
          assert.notEqual(identity.pid, outer.pid);
          identities.push(inspectOwnedPid({ ...identity, startedAfter, executable: process.execPath }));
        }
        return completion;
      };
      const exit = await Promise.race([exercise(), deadline]);
      const elapsed = performance.now() - started;
      assert.equal(exit.signal, null, stderr);
      assert.equal(exit.code, 0, stderr);
      assert.ok(elapsed >= 120_000 && elapsed < 160_000, `unexpected elapsed time: ${elapsed}`);
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      assert.equal(result.record.id, 'integration');
      assert.equal(result.record.status, 'FAIL');
      assert.equal(result.record.exitCode, 124);
      assert.equal(result.cleanupConfirmed, false);
      assert.match(result.log, /TIMEOUT/);
      assert.match(result.log, /CLEANUP_UNCONFIRMED/);
      assert.ok(Buffer.byteLength(result.log) <= 256);
      const owned = JSON.parse(await readFile(pidPath, 'utf8'));
      assert.equal(owned.nonce, nonce, 'the real fixed registry command must start the fixture');
    } finally {
      clearTimeout(watchdog);
      // Only this private fixture can create this receipt. Never enumerate or
      // terminate processes by executable name, port, or a wildcard tree.
      try {
        cleanupFixture(identities);
      } finally {
        if (outer) {
          if (outer.exitCode === null && outer.signalCode === null) outer.kill('SIGKILL');
          if (completion) await Promise.race([completion.catch(() => {}), delay(5000)]);
          outer.stdout.destroy();
          outer.stderr.destroy();
          assert.ok(outer.exitCode !== null || outer.signalCode !== null || !outer.pid);
        }
        await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }
  },
);
