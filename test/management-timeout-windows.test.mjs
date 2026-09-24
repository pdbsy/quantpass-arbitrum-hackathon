import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CHECK_REGISTRY } from '../tools/management-dashboard/checks.mjs';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { awaitWindowsExercise, runWindowsFixture } from './helpers/windows-management-lifecycle.mjs';

test('F01 lifecycle retains the primary read failure and all teardown failures (cleanup fault injected)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-lifecycle-primary-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  });
  await writeFile(join(root, 'not-a-directory'), 'owned fixture');
  const primary = await readFile(join(root, 'absent-receipt')).catch((error) => error);
  assert.equal(primary.code, 'ENOENT');
  const cleanupFailure = new Error('FAULT_INJECTED authenticated identity cleanup failure');
  let removalFailure;
  const outcome = await runWindowsFixture({
    createRoot: () => root,
    setup: () => {},
    exercise: () => {
      throw primary;
    },
    cleanupIdentities: () => [{ role: 'fixture-child', error: cleanupFailure }],
    cleanupSteps: [],
    removeRoot: async () => {
      try {
        await rm(join(root, 'not-a-directory', 'child'));
      } catch (error) {
        removalFailure = error;
        throw error;
      }
    },
  }).catch((error) => error);
  // Native Windows reports file/child as absent; POSIX reports its non-directory
  // parent. Require the exact platform error, retaining the real failed rm.
  const removalCode = process.platform === 'win32' ? 'ENOENT' : 'ENOTDIR';
  assert.equal(removalFailure.code, removalCode);
  assert.equal(await readFile(join(root, 'not-a-directory'), 'utf8'), 'owned fixture');
  assert.deepEqual(outcome.primary, { phase: 'exercise', code: 'ENOENT' });
  assert.deepEqual(outcome.secondary, [
    { phase: 'cleanup-identities', code: 'unknown', role: 'fixture-child' },
    { phase: 'remove-root', code: removalCode },
  ]);
  assert.equal(Object.hasOwn(outcome, 'cause'), false);
  assert.equal(Object.hasOwn(outcome, 'errors'), false);
});

test('F02 lifecycle propagates a real missing-executable spawn error before exhausting receipt polls', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-lifecycle-spawn-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = spawn(join(root, 'absent-executable'), [], { shell: false, stdio: 'pipe' });
  let startupError;
  const completion = new Promise((resolveExit, reject) => {
    child.once('error', (error) => {
      startupError = error;
      reject(error);
    });
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let polls = 0;
  let exerciseFinished = false;
  let captured = false;
  const exercise = async ({ signal, ready }) => {
    try {
      let receipt;
      for (let attempt = 0; attempt < 100; attempt++) {
        polls++;
        try {
          receipt = await readFile(join(root, 'absent-receipt'));
          signal.throwIfAborted();
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await delay(100, undefined, { signal });
      }
      assert.ok(receipt, 'fixture receipt was not produced');
      // This path must never gain process identity authority after startup fails.
      captured = true;
      ready();
    } finally {
      exerciseFinished = true;
    }
  };
  try {
    let finishedBeforeTeardown = false;
    const outcome = await runWindowsFixture({
      createRoot: () => root,
      setup: () => {},
      exercise: () => awaitWindowsExercise(exercise, completion, new Promise(() => {})),
      cleanupIdentities: () => {
        finishedBeforeTeardown = exerciseFinished;
      },
      cleanupSteps: [],
      removeRoot: (allocatedRoot) => rm(allocatedRoot, { recursive: true, force: true }),
    }).catch((error) => error);
    assert.equal(startupError.code, 'ENOENT');
    assert.deepEqual(outcome.primary, { phase: 'outer-startup', code: 'ENOENT' });
    assert.ok(polls < 100, `startup rejection exhausted ${polls} receipt polls`);
    assert.equal(exerciseFinished, true, 'the losing exercise must settle before owned teardown begins');
    assert.equal(finishedBeforeTeardown, true);
    await assert.rejects(access(root), { code: 'ENOENT' });
    const finalPolls = polls;
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assert.equal(polls, finalPolls, 'no receipt work may continue after directory removal');
    assert.equal(captured, false);
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }
});

for (const failedStep of [
  'outer-kill',
  'outer-wait',
  'stdout-destroy',
  'stderr-destroy',
  'outer-exit-check',
]) {
  test(`F03 lifecycle attempts every teardown and removes its real directory after ${failedStep} (fault injected)`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'alphaforge-lifecycle-teardown-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const steps = ['outer-kill', 'outer-wait', 'stdout-destroy', 'stderr-destroy', 'outer-exit-check'];
    const attempted = [];
    const injectedFailure = new Error('FAULT_INJECTED owned outer teardown');
    const outcome = await runWindowsFixture({
      createRoot: () => root,
      setup: () => {},
      exercise: () => {},
      cleanupIdentities: () => {},
      cleanupSteps: steps.map((step) => ({
        phase: step,
        run: () => {
          attempted.push(step);
          if (step === failedStep) throw injectedFailure;
        },
      })),
      removeRoot: (allocatedRoot) => rm(allocatedRoot, { recursive: true, force: true }),
    }).catch((error) => error);
    assert.deepEqual(outcome.primary, { phase: failedStep, code: 'unknown' });
    await assert.rejects(access(root), { code: 'ENOENT' });
    assert.deepEqual(attempted, steps);
  });
}

test('F02 an early normal outer exit cannot bypass receipt and identity validation (completion fault injected)', async () => {
  let finished = false;
  let captured = false;
  const outcome = await awaitWindowsExercise(
    async ({ signal, ready }) => {
      try {
        await delay(100, undefined, { signal });
        captured = true;
        ready();
        return { code: 0, signal: null };
      } finally {
        finished = true;
      }
    },
    Promise.resolve({ code: 0, signal: null }),
    new Promise(() => {}),
  ).catch((error) => error);
  assert.deepEqual(outcome.primary, { phase: 'outer-startup', code: 'EARLY_EXIT' });
  assert.equal(finished, true);
  assert.equal(captured, false);
});

test('F01 the actual Node failure reporter excludes raw primary and nested secondary fields (fault injected)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-lifecycle-reporter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const helper = new URL('./helpers/windows-management-lifecycle.mjs', import.meta.url).href;
  await writeFile(
    join(root, 'reporter.test.mjs'),
    `
import test from 'node:test';
import { runWindowsFixture } from ${JSON.stringify(helper)};
const sensitive = 'SYNTHETIC_LIFECYCLE_PRIVATE_VALUE';
const raw = Object.assign(new Error(sensitive, { cause: new Error(sensitive) }), {
  code: 'ETIMEDOUT', status: 128, path: sensitive, syscall: sensitive,
  spawnargs: [sensitive], errors: [new Error(sensitive)], identity: sensitive,
});

test('controlled lifecycle failure', () => runWindowsFixture({
  createRoot: () => 'private-owned-root', setup: () => {},
  exercise: () => { throw raw; },
  cleanupIdentities: () => { throw new AggregateError([raw], sensitive, { cause: raw }); },
  cleanupSteps: [{ phase: 'outer-kill', run: () => { throw { code: sensitive, status: Infinity, message: sensitive }; } }],
  removeRoot: () => { throw raw; },
}));
`,
  );
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', join(root, 'reporter.test.mjs')],
    {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 32_768,
      shell: false,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.error, undefined);
  const report = result.stdout + result.stderr;
  assert.match(report, /# tests 1\b/);
  assert.match(report, /# fail 1\b/);
  assert.match(report, /ETIMEDOUT/);
  assert.match(report, /cleanup-identities/);
  assert.match(report, /remove-root/);
  assert.ok(!report.includes('SYNTHETIC_LIFECYCLE_PRIVATE_VALUE'));
  assert.ok(!report.includes('spawnargs'));
  assert.ok(report.length < 12_000);
});

test('F02 validated fixture waits for actual outer completion without bypassing identity work', async () => {
  const completion = Promise.withResolvers();
  const validated = Promise.withResolvers();
  const operations = [];
  let finished = false;
  const waiting = awaitWindowsExercise(
    async ({ ready }) => {
      operations.push('receipt', 'identity-child', 'identity-parent');
      ready();
      validated.resolve();
    },
    completion.promise,
    new Promise(() => {}),
  ).then((exit) => {
    finished = true;
    return exit;
  });
  await validated.promise;
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  const finishedBeforeExit = finished;
  completion.resolve({ code: 0, signal: null });
  const result = await waiting;
  assert.equal(finishedBeforeExit, false);
  assert.deepEqual(operations, ['receipt', 'identity-child', 'identity-parent']);
  assert.deepEqual(result, { code: 0, signal: null });
});

test('F02 watchdog after identity capture settles without waiting forever for outer exit (deadline injected)', async () => {
  const validated = Promise.withResolvers();
  const deadline = Promise.withResolvers();
  const resultPromise = awaitWindowsExercise(
    async ({ ready }) => {
      ready();
      validated.resolve();
    },
    new Promise(() => {}),
    deadline.promise,
  ).catch((error) => error);
  await validated.promise;
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  deadline.reject(new Error('FAULT_INJECTED existing watchdog expiry'));
  const result = await resultPromise;
  assert.deepEqual(result?.primary, { phase: 'watchdog', code: 'unknown' });
});

test('F02 a receipt validation failure stays primary even when outer exits successfully (fault injected)', async () => {
  let captureReached = false;
  const outcome = await awaitWindowsExercise(
    async ({ ready }) => {
      assert.equal('FAULT_INJECTED invalid nonce', 'expected fixture nonce');
      captureReached = true;
      ready();
    },
    new Promise((resolveExit) => setImmediate(() => resolveExit({ code: 0, signal: null }))),
    new Promise(() => {}),
  ).catch((error) => error);
  assert.deepEqual(outcome.primary, { phase: 'exercise', code: 'ERR_ASSERTION' });
  assert.equal(captureReached, false);
});

test('F02 returning before authentication cannot admit a later successful outer exit (fault injected)', async () => {
  const outcome = await awaitWindowsExercise(
    async () => {},
    new Promise((resolveExit) => setImmediate(() => resolveExit({ code: 0, signal: null }))),
    new Promise(() => {}),
  ).catch((error) => error);
  assert.deepEqual(outcome?.primary, { phase: 'exercise', code: 'ERR_ASSERTION' });
});

test('F04 allocation failure never removes a guessed directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-lifecycle-allocation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let cleanupCalls = 0;
  const outcome = await runWindowsFixture({
    createRoot: () => mkdtemp(join(root, 'missing-parent', 'fixture-')),
    setup: () => assert.fail('setup after failed allocation'),
    exercise: () => assert.fail('exercise after failed allocation'),
    cleanupIdentities: () => cleanupCalls++,
    cleanupSteps: [{ phase: 'outer-kill', run: () => cleanupCalls++ }],
    removeRoot: () => cleanupCalls++,
  }).catch((error) => error);
  assert.deepEqual(outcome.primary, { phase: 'create-root', code: 'ENOENT' });
  assert.equal(cleanupCalls, 0);
  await access(root);
});

test('F04 lifecycle removes its allocated directory after a real Git setup failure', async (t) => {
  let root;
  let gitFailure;
  let exercised = false;
  t.after(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });
  const outcome = await runWindowsFixture({
    createRoot: async () => {
      root = await mkdtemp(join(tmpdir(), 'alphaforge-lifecycle-git-'));
      return root;
    },
    setup: () => {
      try {
        fixtureExec('git', ['--git-dir=' + join(root, 'absent.git'), 'rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch (error) {
        gitFailure = error;
        throw error;
      }
    },
    exercise: () => {
      exercised = true;
    },
    cleanupIdentities: () => {},
    cleanupSteps: [],
    removeRoot: (allocatedRoot) => rm(allocatedRoot, { recursive: true, force: true }),
  }).catch((error) => error);
  assert.equal(gitFailure.status, 128);
  assert.deepEqual(outcome.primary, { phase: 'setup', code: 'unknown', status: 128 });
  assert.equal(exercised, false);
  await assert.rejects(access(root), { code: 'ENOENT' });
});

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function verifyProbeResult(cleanup, { role, terminate, elapsedMs }, diagnostic) {
  // Parse only this fixed protocol. PowerShell error text can include source
  // lines containing the encoded identity; never forward stderr or spawnargs.
  const stages = new Set([
    'script-start',
    'identity-decoded',
    'get-process',
    'process-found',
    'acquire-handle',
    'handle-acquired',
    'cim-query',
    'cim-complete',
    'checks-complete',
    'terminate',
    'wait-exit',
    'dispose',
    'disposed',
    'probe-error',
  ]);
  const phases = [];
  let checks = 'unknown';
  for (const line of (cleanup.stderr || '').slice(0, 4096).split(/\r?\n/)) {
    const phase = /^AF_PROBE_V1 stage=([a-z-]+) elapsedMs=([0-9]{1,7})$/.exec(line);
    if (phase && stages.has(phase[1]) && phases.length < 16) phases.push([phase[1], Number(phase[2])]);
    const match = /^AF_PROBE_V1 checks=([01]{5})$/.exec(line);
    if (match) checks = match[1];
  }
  const safeRole = ['fixture-child', 'registry-parent'].includes(role) ? role : 'unknown';
  const safeError = !cleanup.error
    ? 'none'
    : ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ENOBUFS', 'EINVAL'].includes(cleanup.error.code)
      ? cleanup.error.code
      : 'unknown';
  const safeElapsed =
    Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= 9_999_999 ? Math.ceil(elapsedMs) : 'unknown';
  const safeStatus = Number.isInteger(cleanup.status) ? cleanup.status : 'unknown';
  const summary = `Windows fixture probe role=${safeRole} mode=${terminate ? 'cleanup' : 'capture'} elapsedMs=${safeElapsed} error=${safeError} status=${safeStatus} stage=${phases.at(-1)?.[0] || 'unknown'} checks=${checks} phases=${phases.map(([stage, ms]) => `${stage}:${ms}`).join(',') || 'unknown'}`;
  diagnostic(summary);
  assert.ok(!cleanup.error, `Windows fixture identity probe failed; ${summary}`);
  assert.ok(cleanup.status === 0, `Windows fixture identity probe rejected; ${summary}`);
  if (!terminate) {
    assert.ok(
      typeof cleanup.stdout === 'string' && /^[0-9]+$/.test(cleanup.stdout),
      `Windows fixture invalid birth ticks; ${summary}`,
    );
    return cleanup.stdout;
  }
}

test('probe diagnostics retain a real native child timeout as failure without raw launch details', () => {
  const result = spawnSync(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], {
    encoding: 'utf8',
    timeout: 250,
    maxBuffer: 4096,
    windowsHide: true,
    shell: false,
  });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  const diagnostics = [];
  assert.throws(
    () =>
      verifyProbeResult(result, { role: 'fixture-child', terminate: false, elapsedMs: 251 }, (line) =>
        diagnostics.push(line),
      ),
    /role=fixture-child mode=capture.*error=ETIMEDOUT.*stage=unknown/,
  );
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0].length <= 2048);
  assert.match(diagnostics[0], /checks=unknown/);
  assert.ok(!diagnostics[0].includes(process.execPath));
});

test('probe diagnostics preserve only known phases and five booleans from a failing native child', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--eval',
      `
process.stderr.write('SECRET_PATH_COMMAND_NONCE_PID_ENV\\nAF_PROBE_V1 stage=cim-query elapsedMs=12\\nAF_PROBE_V1 checks=11011\\nAF_PROBE_V1 stage=SECRET elapsedMs=13\\n');
process.stderr.write('AF_PROBE_V1 stage=cim-query elapsedMs=12\\n'.repeat(60));
process.stderr.write('AF_PROBE_V1 checks=SECRET\\nAF_PROBE_V1 stage=dispose elapsedMs=123456789SECRET\\n');
process.stdout.write('SECRET_STDOUT');
process.exitCode = 1;
`,
    ],
    { encoding: 'utf8', timeout: 20_000, maxBuffer: 4096, windowsHide: true, shell: false },
  );
  assert.equal(result.status, 1);
  const diagnostics = [];
  assert.throws(
    () =>
      verifyProbeResult(result, { role: 'registry-parent', terminate: true, elapsedMs: 25 }, (line) =>
        diagnostics.push(line),
      ),
    (error) => /role=registry-parent mode=cleanup/.test(error.message) && !error.message.includes('SECRET'),
  );
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0].length <= 2048);
  assert.match(diagnostics[0], /stage=cim-query/);
  assert.match(diagnostics[0], /checks=11011/);
  assert.ok(!diagnostics[0].includes('SECRET'));
});

test('probe diagnostics keep the birth-tick stdout protocol and reject malformed output', () => {
  const result = spawnSync(process.execPath, ['--eval', "process.stdout.write('638942400000000000')"], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 4096,
    windowsHide: true,
    shell: false,
  });
  assert.equal(result.status, 0);
  assert.equal(
    verifyProbeResult(result, { role: 'fixture-child', terminate: false, elapsedMs: 12 }, () => {}),
    '638942400000000000',
  );
  // Fault injection at the unavailable Windows probe boundary: malformed bytes
  // must fail closed without reflecting raw output into the assertion report.
  assert.throws(
    () =>
      verifyProbeResult(
        { ...result, stdout: 'SECRET_INVALID_TICKS' },
        { role: 'fixture-child', terminate: false, elapsedMs: 12 },
        () => {},
      ),
    (error) => /invalid birth ticks/.test(error.message) && !error.message.includes('SECRET'),
  );
});

function inspectOwnedPid(identity, terminate, diagnostic) {
  if (terminate && !alive(identity.pid)) return;
  // Windows PowerShell is an existing OS component. Hold an actual process
  // handle and verify its start time, ancestry and command before termination;
  // a stale PID file must never authorize killing a reused PID.
  const encodedIdentity = Buffer.from(JSON.stringify(identity)).toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$probeClock = [Diagnostics.Stopwatch]::StartNew()
function Write-ProbeStage([string]$stage) {
  # Diagnostic IO must never prevent identity checks or held-handle disposal.
  try {
    [Console]::Error.WriteLine('AF_PROBE_V1 stage=' + $stage + ' elapsedMs=' + $probeClock.ElapsedMilliseconds)
    [Console]::Error.Flush()
  } catch {}
}
Write-ProbeStage 'script-start'
try {
$expected = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedIdentity}')) | ConvertFrom-Json
Write-ProbeStage 'identity-decoded'
Write-ProbeStage 'get-process'
$ownedProcess = Get-Process -Id $expected.pid -ErrorAction SilentlyContinue
if ($null -eq $ownedProcess) { exit 0 }
Write-ProbeStage 'process-found'
try {
  Write-ProbeStage 'acquire-handle'
  $null = $ownedProcess.Handle
  Write-ProbeStage 'handle-acquired'
  if ($ownedProcess.HasExited) { exit 0 }
  Write-ProbeStage 'cim-query'
  $metadata = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $expected.pid)
  Write-ProbeStage 'cim-complete'
  if ($ownedProcess.HasExited) { exit 0 }
  $expectedTail = $expected.commandPart
  $command = if ($null -ne $metadata -and $null -ne $metadata.CommandLine) { $metadata.CommandLine.TrimEnd() } else { '' }
  $checks = [ordered]@{
    metadataPresent = $null -ne $metadata
    parentMatches = $null -ne $metadata -and $metadata.ParentProcessId -eq $expected.parentPid
    startedAfterMatches = $ownedProcess.StartTime.ToUniversalTime() -ge [DateTime]::Parse($expected.startedAfter).ToUniversalTime()
    commandMatches = $command.EndsWith(' ' + $expectedTail) -or $command.EndsWith(' "' + $expectedTail + '"')
    executableMatches = $null -ne $metadata -and $null -ne $metadata.ExecutablePath -and [IO.Path]::GetFullPath($metadata.ExecutablePath) -ieq [IO.Path]::GetFullPath($expected.executable)
  }
  # Order: metadata, parent, started-after, command, executable. Missing checks
  # remain unknown to the caller until this entire comparison has completed.
  try {
    [Console]::Error.WriteLine('AF_PROBE_V1 checks=' + (($checks.Values | ForEach-Object { if ($_){ '1' } else { '0' } }) -join ''))
    [Console]::Error.Flush()
  } catch {}
  Write-ProbeStage 'checks-complete'
  if ($checks.Values -contains $false) {
    # Emit only booleans, never a process command line or executable path.
    throw ('Fixture process identity changed; refusing PID cleanup; checks=' + ($checks | ConvertTo-Json -Compress))
  }
  $startTicks = $ownedProcess.StartTime.ToUniversalTime().Ticks.ToString()
  if (${terminate ? '$true' : '$false'}) {
    if ($startTicks -ne $expected.startTicks) { throw 'PID birth identity changed; refusing cleanup' }
    Write-ProbeStage 'terminate'
    $ownedProcess.Kill()
    Write-ProbeStage 'wait-exit'
    if (-not $ownedProcess.WaitForExit(3000)) { throw 'Owned process survived cleanup' }
  } else { [Console]::Out.Write($startTicks) }
} finally {
  Write-ProbeStage 'dispose'
  $ownedProcess.Dispose()
  Write-ProbeStage 'disposed'
}
} catch {
  # Do not let PowerShell print an error source line with encoded identity data.
  Write-ProbeStage 'probe-error'
  exit 1
}
`;
  const probeStarted = performance.now();
  const cleanup = spawnSync(
    join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { encoding: 'utf8', timeout: terminate ? 8000 : 20000, maxBuffer: 4096, windowsHide: true, shell: false },
  );
  const startTicks = verifyProbeResult(
    cleanup,
    { role: identity.role, terminate, elapsedMs: performance.now() - probeStarted },
    diagnostic,
  );
  if (!terminate) return { ...identity, startTicks };
}

function cleanupFixture(identities, lifecycle, diagnostic) {
  const errors = [];
  for (const identity of identities) {
    try {
      lifecycle[identity.role].cleanup = 'started';
      inspectOwnedPid(identity, true, diagnostic);
      lifecycle[identity.role].cleanup = 'probe-returned';
    } catch (error) {
      lifecycle[identity.role].cleanup = 'failed';
      errors.push({ role: identity.role, error });
    }
  }
  return errors;
}

test(
  'Windows management integration timeout returns bounded FAIL without claiming process-tree cleanup',
  { skip: process.platform !== 'win32' ? 'Requires a real Windows runner and fixed 120s timeout' : false },
  async (t) => {
    const diagnostic = (line) => t.diagnostic(line);
    const integration = CHECK_REGISTRY.find((check) => check.id === 'integration');
    assert.equal(integration.file, 'node');
    assert.deepEqual(integration.args, ['--test', 'test/server.test.ts']);
    assert.equal(integration.timeoutMs, 120_000);
    // Native canonicalization expands Windows short names before either the
    // child runner or its command identity is constructed.
    let root;
    const nonce = randomUUID();
    let pidPath;
    let resultPath;
    const repository = resolve(import.meta.dirname, '..');
    let commit;
    let outer;
    let watchdog;
    let completion;
    let stderr = '';
    let startedAfter;
    const identities = [];
    const lifecycle = Object.fromEntries(
      ['fixture-child', 'registry-parent'].map((role) => [
        role,
        {
          capture: 'not-started',
          cleanup: 'not-attempted-unverified',
        },
      ]),
    );
    const outputLimit = 4096;
    await runWindowsFixture({
      createRoot: () => mkdtemp(join(tmpdir(), 'alphaforge-management-windows-timeout-')),
      setup: (allocatedRoot) => {
        root = realpathSync.native(allocatedRoot);
        pidPath = join(root, 'fixture-pids.json');
        resultPath = join(root, 'result.json');
        commit = fixtureExec('git', ['rev-parse', 'HEAD'], {
          cwd: repository,
          encoding: 'utf8',
        }).trim();
      },
      exercise: async () => {
        await mkdir(join(root, 'test'));
        await writeFile(join(root, 'package.json'), '{"type":"module","private":true}\n');
        await writeFile(
          join(root, 'test/server.test.ts'),
          `import { renameSync, writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidPath + '.tmp')}, JSON.stringify({ nonce: ${JSON.stringify(nonce)}, pid: process.pid, parentPid: process.ppid, cwd: process.cwd(), argvPath: process.argv[1] }), { flag: 'wx' });
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
        // Observe rejection immediately; awaitWindowsExercise propagates it,
        // cancels receipt polling and joins that work before teardown.
        completion.catch(() => {});
        const deadline = new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error('Windows timeout outer watchdog expired')), 160_000);
        });
        const exercise = async ({ signal, ready }) => {
          let owned;
          for (let attempt = 0; attempt < 100; attempt++) {
            try {
              owned = JSON.parse(await readFile(pidPath, 'utf8'));
              signal.throwIfAborted();
              break;
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
              await delay(100, undefined, { signal });
            }
          }
          signal.throwIfAborted();
          assert.equal(owned?.nonce, nonce, 'the fixed registry command must start the fixture');
          assert.notEqual(owned.pid, owned.parentPid);
          assert.equal(
            realpathSync.native(owned.cwd),
            root,
            'the nonce-bound fixture runs in its owned root',
          );
          assert.equal(
            realpathSync.native(owned.argvPath),
            realpathSync.native(join(root, 'test/server.test.ts')),
            'the owned child executes the exact private fixture file',
          );
          // The locked Node test runner passes its glob result as a relative child
          // argument. process.argv[1] is absolute inside that child, but CIM observes
          // the original relative command. Verify both, retaining every PID guard.
          for (const identity of [
            {
              role: 'fixture-child',
              pid: owned.pid,
              parentPid: owned.parentPid,
              commandPart: join('test', 'server.test.ts'),
            },
            {
              role: 'registry-parent',
              pid: owned.parentPid,
              parentPid: outer.pid,
              commandPart: 'test/server.test.ts',
            },
          ]) {
            assert.ok(Number.isInteger(identity.pid) && identity.pid > 0);
            assert.notEqual(identity.pid, process.pid);
            assert.notEqual(identity.pid, outer.pid);
            lifecycle[identity.role].capture = 'started';
            try {
              identities.push(
                inspectOwnedPid(
                  { ...identity, startedAfter, executable: process.execPath },
                  false,
                  diagnostic,
                ),
              );
              lifecycle[identity.role].capture = 'authenticated';
              lifecycle[identity.role].cleanup = 'not-attempted';
            } catch (error) {
              lifecycle[identity.role].capture = 'failed';
              throw error;
            }
          }
          ready();
        };
        const exit = await awaitWindowsExercise(exercise, completion, deadline);
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
      },
      cleanupIdentities: () => {
        clearTimeout(watchdog);
        // Only this private fixture can create this receipt. Never enumerate or
        // terminate processes by executable name, port, or a wildcard tree.
        return cleanupFixture(identities, lifecycle, diagnostic);
      },
      cleanupSteps: [
        {
          phase: 'lifecycle-diagnostic',
          run: () => {
            // Unregistered descendants are never signalled. These are observations
            // of our calls only, not a claim that every fixture descendant exited.
            for (const [role, state] of Object.entries(lifecycle)) {
              diagnostic(
                `Windows fixture lifecycle role=${role} capture=${state.capture} cleanup=${state.cleanup} descendantSurvival=unknown`,
              );
            }
          },
        },
        {
          phase: 'outer-kill',
          run: () => {
            if (outer && outer.exitCode === null && outer.signalCode === null) outer.kill('SIGKILL');
          },
        },
        {
          phase: 'outer-wait',
          run: async () => {
            if (completion) await Promise.race([completion.catch(() => {}), delay(5000)]);
          },
        },
        { phase: 'stdout-destroy', run: () => outer?.stdout.destroy() },
        { phase: 'stderr-destroy', run: () => outer?.stderr.destroy() },
        {
          phase: 'outer-exit-check',
          run: () => {
            if (outer) {
              assert.ok(outer.exitCode !== null || outer.signalCode !== null || !outer.pid);
            }
          },
        },
      ],
      removeRoot: (allocatedRoot) =>
        rm(allocatedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    });
  },
);
