import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const driver = pathToFileURL(join(root, 'tools/verify-management-browser.mjs')).href;

function run(entry, directory, tool, limited = false) {
  const options = {
    cwd: directory,
    env: { ...process.env, AF_PLAYWRIGHT_PATH: tool },
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
  };
  // Only this child shell/Node process lowers its soft and hard limits (Node
  // otherwise raises its soft limit during startup). No browser or
  // subprocess is launched after descriptor exhaustion.
  return limited
    ? spawnSync(
        '/bin/sh',
        [
          '-c',
          'limit=$(ulimit -S -n); case "$limit" in unlimited) limit=128;; *) if [ "$limit" -gt 128 ]; then limit=128; fi;; esac; ulimit -n "$limit" || exit 77; ulimit -S -n > fd-soft-limit; ulimit -H -n > fd-hard-limit; exec "$1" "$2"',
          'alphaforge-private-fd-child',
          process.execPath,
          entry,
        ],
        options,
      )
    : spawnSync(process.execPath, [entry], options);
}

test('native archive denial preserves the old receipt and fails before browser tooling loads', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('Native directory write denial is not enforceable by this POSIX owner-mode fixture');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'alphaforge-browser-archive-'));
  const history = join(directory, '.checks/pr11/history');
  const receipt = join(directory, '.checks/pr11/management-browser.json');
  const oldBytes = Buffer.from('{"status":"PASS","invocation":"previous-only"}\n');
  try {
    await mkdir(history, { recursive: true });
    await writeFile(receipt, oldBytes);
    await writeFile(join(history, 'earlier.json'), '{"invocation":"earlier-archive"}\n');
    await writeFile(join(directory, 'preflight'), 'private permission probe');
    const tool = join(directory, 'tool.mjs');
    await writeFile(tool, `import {writeFileSync} from 'node:fs'; writeFileSync('tool-loaded', 'yes');`);
    const entry = join(directory, 'entry.mjs');
    await writeFile(
      entry,
      `try { await import(${JSON.stringify(driver)}); }
       catch (error) { console.log(JSON.stringify({code:error.code, syscall:error.syscall})); process.exitCode=1; }`,
    );
    await chmod(history, 0o500);
    // mkdir(existing) must succeed. The production failure must be rename,
    // not an earlier directory creation failure or a made-up error code.
    await mkdir(history, { recursive: true });
    let denied;
    try {
      await rename(join(directory, 'preflight'), join(history, 'preflight'));
    } catch (error) {
      denied = error;
    }
    if (!denied) {
      t.skip('Owner-mode permissions were bypassed by this filesystem/ACL; native archive case remains OPEN');
      return;
    }
    assert.equal(denied.code, 'EACCES');
    const result = run(entry, directory, tool);
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { code: 'EACCES', syscall: 'rename' });
    assert.deepEqual(await readFile(receipt), oldBytes);
    assert.deepEqual(await readdir(history), ['earlier.json']);
    assert.equal(await readFile(join(history, 'earlier.json'), 'utf8'), '{"invocation":"earlier-archive"}\n');
    assert.equal(existsSync(join(directory, 'tool-loaded')), false);
    assert.doesNotMatch(result.stdout + result.stderr, /"status"\s*:\s*"PASS"/);
    t.diagnostic(
      'NATIVE_FILESYSTEM_FAILURE: existing history mkdir succeeded; rename EACCES; old bytes retained; tooling not loaded',
    );
  } finally {
    // Restore only the directory owned by this test, even after failed assertions.
    if (existsSync(history)) await chmod(history, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});

test('native listen exhaustion in a bounded child fails without a PASS receipt or live TCP handle', async (t) => {
  if (!['darwin', 'linux'].includes(process.platform)) {
    t.skip('This native per-process descriptor-limit fixture requires POSIX /dev/null and /bin/sh');
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'alphaforge-browser-listen-'));
  try {
    await mkdir(join(directory, 'docs/management/dashboard'), { recursive: true });
    const tool = join(directory, 'tool.mjs');
    await writeFile(
      tool,
      `import {openSync} from 'node:fs';
       const observation = globalThis.privateFdObservation;
       observation.toolLoaded = true;
       try { for (let i=0; i<128; i++) observation.fds.push(openSync('/dev/null','r')); }
       catch (error) { observation.exhaustion = error.code; }
       export const chromium = { launch() {
         observation.browserLaunched = true;
         throw new Error('UNEXPECTED_BROWSER_LAUNCH');
       } };`,
    );
    const entry = join(directory, 'entry.mjs');
    await writeFile(
      entry,
      `import {closeSync} from 'node:fs';
       const observation = globalThis.privateFdObservation = {fds:[],toolLoaded:false,browserLaunched:false};
       try { await import(${JSON.stringify(driver)}); observation.unexpectedSuccess=true; }
       catch (error) {
         observation.failure={code:error.code,syscall:error.syscall,address:error.address,stack:error.stack};
         process.exitCode=1;
       } finally {
         observation.fdCount=observation.fds.length;
         for (const fd of observation.fds) closeSync(fd);
         delete observation.fds;
         await new Promise(done=>setImmediate(done));
         await new Promise(done=>setImmediate(done));
         observation.resourcesAfterClose=process.getActiveResourcesInfo();
         console.log(JSON.stringify(observation));
       }`,
    );
    // Repetition qualifies stability without increasing this child's FD budget.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = run(entry, directory, tool, true);
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1, result.stderr);
      const observation = JSON.parse(result.stdout);
      const softLimit = Number(await readFile(join(directory, 'fd-soft-limit'), 'utf8'));
      const hardLimit = Number(await readFile(join(directory, 'fd-hard-limit'), 'utf8'));
      assert.ok(softLimit > 0 && softLimit <= 128);
      assert.equal(hardLimit, softLimit);
      assert.equal(observation.toolLoaded, true);
      assert.equal(observation.exhaustion, 'EMFILE', JSON.stringify({ observation, stderr: result.stderr }));
      assert.ok(observation.fdCount > 0 && observation.fdCount <= 128);
      assert.equal(observation.browserLaunched, false);
      assert.equal(observation.unexpectedSuccess, undefined);
      assert.equal(observation.failure.code, 'EMFILE');
      assert.equal(observation.failure.syscall, 'listen');
      assert.equal(observation.failure.address, '127.0.0.1');
      assert.match(observation.failure.stack, /Server\.setupListenHandle/);
      assert.equal(observation.resourcesAfterClose.includes('TCPServerWrap'), false);
      assert.equal(existsSync(join(directory, '.checks/pr11/management-browser.json')), false);
      assert.deepEqual(await readdir(join(directory, '.checks/pr11/history')), []);
      assert.doesNotMatch(result.stdout + result.stderr, /"status"\s*:\s*"PASS"/);
      t.diagnostic(
        JSON.stringify({
          inputClass: 'NATIVE_PROCESS_RESOURCE_FAILURE',
          attempt,
          softLimit,
          hardLimit,
          ...observation,
        }),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
