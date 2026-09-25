import assert from 'node:assert/strict';
import childProcess, { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runLocal, verifyRun } from '../tools/local-ci/runner.mjs';

const native = process.platform !== 'win32' && process.versions.node === '24.21.0';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-runner-closeout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'source');
  mkdirSync(cwd);
  writeFileSync(join(cwd, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(cwd, 'source.txt'), 'immutable source\n');
  const git = (...args) =>
    execFileSync('/usr/bin/git', ['--no-replace-objects', ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: root,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--quiet', '-b', 'fixture');
  git('add', '--all');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'isolated source',
  );
  const head = git('rev-parse', 'HEAD');
  const expected = { base: head, head, tree: git('rev-parse', 'HEAD^{tree}'), node: '24.21.0' };
  const config = { cwd, outputRoot: join(root, 'evidence'), expected };
  const job = (code, extra = {}) => ({
    id: 'probe',
    executable: process.execPath,
    args: ['-e', code],
    platform: process.platform,
    arch: process.arch,
    timeoutMs: 3000,
    ...extra,
  });
  return { root, cwd, config, job, expected, git };
}

function assertReport(run, expected, state) {
  assert.equal(run.state, state);
  assert.equal(verifyRun(run.directory, expected).state, state);
  const bytes = readFileSync(join(run.directory, 'report.json'));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(readFileSync(join(run.directory, 'report.sha256'), 'utf8'), `${digest}\n`);
}

test(
  'source inspection rejects a real symlink parent substituted after the clean Git status',
  { skip: !native },
  async (t) => {
    const { root, cwd, config, job, expected, git } = fixture(t);
    mkdirSync(join(cwd, 'recorded'));
    writeFileSync(join(cwd, 'recorded', 'check.txt'), 'same visible bytes\n');
    git('add', '--all');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'record nested file',
    );
    expected.base = git('rev-parse', 'HEAD');
    expected.head = expected.base;
    expected.tree = git('rev-parse', 'HEAD^{tree}');
    mkdirSync(join(root, 'replacement'));
    writeFileSync(join(root, 'replacement', 'check.txt'), 'same visible bytes\n');

    const original = childProcess.execFileSync;
    let swapped = false;
    try {
      childProcess.execFileSync = (...args) => {
        const result = original(...args);
        if (!swapped && args[0] === '/usr/bin/git' && args[1]?.includes('ls-tree')) {
          renameSync(join(cwd, 'recorded'), join(root, 'original-recorded'));
          symlinkSync(join(root, 'replacement'), join(cwd, 'recorded'), 'dir');
          swapped = true;
        }
        return result;
      };
      syncBuiltinESMExports();
      const run = await runLocal({ ...config, jobs: [job('process.exit(0)')] });
      assert.equal(swapped, true);
      assertReport(run, expected, 'BLOCKED');
      assert.deepEqual(run.jobs, []);
      assert.equal(run.reason, 'Prerequisite, source, process or evidence integrity incomplete');
    } finally {
      childProcess.execFileSync = original;
      syncBuiltinESMExports();
    }
  },
);

test(
  'native spawn rejection remains blocked with no process ID or passing evidence',
  { skip: !native },
  async (t) => {
    const { root, config, job, expected } = fixture(t);
    const executable = join(root, 'not-executable');
    writeFileSync(executable, 'not an executable\n', { mode: 0o600 });
    const run = await runLocal({
      ...config,
      jobs: [job('process.exit(0)', { executable, timeoutMs: 1 })],
    });
    assertReport(run, expected, 'BLOCKED');
    assert.equal(run.jobs[0].pid, undefined);
    assert.equal(run.jobs[0].processFailure, true);
    assert.equal(run.jobs[0].cleanup, 'PASS');
  },
);

test(
  'FAULT_INJECTED EPERM liveness probes block evidence in a supervised subprocess',
  { skip: !native },
  async (t) => {
    const { config, job, expected } = fixture(t);
    const runnerUrl = new URL('../tools/local-ci/runner.mjs', import.meta.url).href;
    const input = { ...config, jobs: [job("process.stdout.write('finished\\n')")] };
    const script = `
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { runLocal } from ${JSON.stringify(runnerUrl)};
      const originalSpawn = cp.spawn;
      const originalKill = process.kill;
      cp.spawn = (...args) => {
        const child = originalSpawn(...args);
        process.stdout.write(JSON.stringify({type:'spawned',pid:child.pid})+'\\n');
        return child;
      };
      syncBuiltinESMExports();
      let denied = 0;
      process.kill = (pid, signal) => {
        if (pid < 0 && signal === 0) {
          denied++;
          const error = new Error('FAULT_INJECTED permission denial');
          error.code = 'EPERM';
          throw error;
        }
        return originalKill(pid, signal);
      };
      try {
        const run = await runLocal(JSON.parse(process.argv[1]));
        process.stdout.write(JSON.stringify({type:'result',run,denied})+'\\n');
      } finally {
        process.kill = originalKill;
        cp.spawn = originalSpawn;
        syncBuiltinESMExports();
      }
    `;
    const supervisor = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    const events = [];
    const groups = new Set();
    supervisor.stdout.on('data', (bytes) => {
      output += bytes;
      const lines = output.split('\n');
      output = lines.pop();
      for (const line of lines) {
        const event = JSON.parse(line);
        events.push(event);
        if (event.type === 'spawned' && Number.isInteger(event.pid)) groups.add(event.pid);
      }
    });
    supervisor.stderr.on('data', (bytes) => {
      errors += bytes;
    });
    const completion = new Promise((resolve) => supervisor.on('close', resolve));
    let watchdog;
    let cleanupError;
    try {
      const exitCode = await Promise.race([
        completion,
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error('supervised EPERM probe timed out')), 8000);
        }),
      ]);
      assert.equal(exitCode, 0, errors);
      assert.equal(output, '');
      const result = events.find((event) => event.type === 'result');
      assert.ok(result, errors);
      assert.ok(result.denied > 0);
      assert.equal(groups.has(result.run.jobs[0].pid), true);
      assertReport(result.run, expected, 'BLOCKED');
      assert.equal(result.run.jobs[0].leftChildren, true);
      assert.equal(result.run.jobs[0].cleanup, 'BLOCKED');
      assert.equal(
        readFileSync(join(result.run.directory, result.run.jobs[0].stdout.file), 'utf8'),
        'finished\n',
      );
    } finally {
      clearTimeout(watchdog);
      if (supervisor.exitCode === null) supervisor.kill('SIGKILL');
      for (const pid of groups) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') cleanupError ??= error;
        }
      }
    }
    assert.ifError(cleanupError);
    for (const pid of groups) {
      let gone = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          process.kill(-pid, 0);
        } catch (error) {
          if (error.code === 'ESRCH') {
            gone = true;
            break;
          }
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(gone, true, `supervised process group ${pid} survived cleanup`);
    }
  },
);

test(
  'watchdog blocks evidence while a detached descendant holds the native output pipe open',
  { skip: !native },
  async (t) => {
    const { root, config, job, expected } = fixture(t);
    const marker = join(root, 'descendant-finished');
    const token = randomUUID();
    const sockets = new Set();
    let ownedSocket;
    let observedPid;
    let resolveClosed;
    const closed = new Promise((resolve) => (resolveClosed = resolve));
    const server = createServer((socket) => {
      sockets.add(socket);
      let message = '';
      socket.on('data', (bytes) => {
        message += bytes.toString('utf8');
        if (message.length > 200) return socket.destroy();
        if (!message.endsWith('\n')) return;
        const [receivedToken, pid] = message.trim().split(':');
        if (receivedToken !== token || !/^[1-9][0-9]*$/.test(pid) || ownedSocket) return socket.destroy();
        ownedSocket = socket;
        observedPid = Number(pid);
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        sockets.delete(socket);
        if (socket === ownedSocket) resolveClosed();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    // The exact fixture exits at its own deadline or through this private
    // connection. Never signal an orphan's numeric PID after it has exited.
    const descendant = join(root, 'descendant.cjs');
    writeFileSync(
      descendant,
      `
      const fs=require('node:fs'),net=require('node:net');
      const [marker,token,port]=process.argv.slice(2);
      const socket=net.connect(Number(port),'127.0.0.1',()=>socket.write(token+':'+process.pid+'\\n'));
      const stop=(reason)=>{fs.writeFileSync(marker,reason);process.exit(0)};
      setTimeout(()=>stop('done'),4500);
      socket.on('data',bytes=>{if(bytes.toString()==='stop:'+token)stop('cleanup')});
      socket.on('error',()=>{});
    `,
    );
    const launcher = join(root, 'launcher.cjs');
    writeFileSync(
      launcher,
      `
      const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,process.argv.slice(2),{detached:true,stdio:['ignore','inherit','inherit']});
      child.unref();process.stdout.write(String(child.pid)+'\\n');
    `,
    );
    const waitClosed = async () => {
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('owned descendant did not close its connection')),
              6000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const run = await runLocal({
        ...config,
        jobs: [
          job('', {
            args: [launcher, descendant, marker, token, String(port)],
            timeoutMs: 800,
          }),
        ],
      });
      assertReport(run, expected, 'BLOCKED');
      assert.equal(run.jobs[0].timedOut, true);
      assert.equal(run.jobs[0].processFailure, true);
      const grandchildPid = Number(readFileSync(join(run.directory, run.jobs[0].stdout.file), 'utf8').trim());
      assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);
      await waitClosed();
      assert.equal(observedPid, grandchildPid, 'completion belongs to the actual pipe-holding descendant');
      assert.equal(readFileSync(marker, 'utf8'), 'done');
      assert.equal(ownedSocket.destroyed, true);
    } finally {
      try {
        if (ownedSocket && !ownedSocket.destroyed) ownedSocket.write('stop:' + token);
        await waitClosed();
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
  },
);
