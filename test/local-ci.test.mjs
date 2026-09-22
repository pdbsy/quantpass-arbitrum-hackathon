import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto, { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const module = await import('../tools/local-ci/runner.mjs').catch(() => ({}));
const { runLocal, verifyRun } = module;
test('local evidence runner is available before commands can be accepted', () => {
  assert.equal(typeof runLocal, 'function');
  assert.equal(typeof verifyRun, 'function');
});
const available = typeof runLocal === 'function' && process.platform !== 'win32';
for (const channel of ['stdout', 'stderr']) {
  test(
    `${channel} short writes are completed and zero writes fail closed`,
    { skip: !available },
    async (t) => {
      const { config, job } = fixture(t);
      const original = fs.writeSync;
      try {
        fs.writeSync = (...args) => {
          const [fd, buffer, offset = 0, length = buffer.length, position] = args;
          return Buffer.isBuffer(buffer) && buffer.toString() === 'abcdefghijklmnop'
            ? original(fd, buffer, offset, Math.min(1, length), position)
            : original(...args);
        };
        syncBuiltinESMExports();
        const r = await runLocal({ ...config, jobs: [job(`process.${channel}.write('abcdefghijklmnop')`)] });
        assert.equal(r.state, 'PASS');
        assert.equal(readFileSync(join(r.directory, r.jobs[0][channel].file), 'utf8'), 'abcdefghijklmnop');
        fs.writeSync = (...args) =>
          Buffer.isBuffer(args[1]) && args[1].toString() === 'must be captured' ? 0 : original(...args);
        syncBuiltinESMExports();
        const blocked = await runLocal({
          ...config,
          jobs: [job(`process.${channel}.write('must be captured')`)],
        });
        assert.equal(blocked.state, 'BLOCKED');
      } finally {
        fs.writeSync = original;
        syncBuiltinESMExports();
      }
    },
  );
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'af-local-ci-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'source');
  mkdirSync(cwd);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }).trim();
  git('init', '-b', 'fixture');
  writeFileSync(join(cwd, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(cwd, 'source.txt'), 'trusted fixture\n');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture',
  );
  const expected = {
    base: git('rev-parse', 'HEAD'),
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    node: '24.21.0',
  };
  const config = { cwd, outputRoot: join(directory, 'evidence'), expected };
  const job = (code, extra = {}) => ({
    id: 'probe',
    executable: process.execPath,
    args: ['-e', code],
    platform: process.platform,
    arch: process.arch,
    timeoutMs: 2500,
    ...extra,
  });
  return { config, job, git };
}

test(
  'local CLI exits reflect actual successful, failing and blocked fixture runs',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    mkdirSync(config.outputRoot, { recursive: true });
    for (const [state, exitCode, script, stale] of [
      ['PASS', 0, 'console.log("actual fixture output")', false],
      ['FAIL', 1, 'process.exit(7)', false],
      ['BLOCKED', 2, 'throw Error("must not execute")', true],
    ]) {
      const path = join(config.outputRoot, `${state}.json`);
      writeFileSync(
        path,
        JSON.stringify({
          ...config,
          expected: stale ? { ...config.expected, head: 'a'.repeat(40) } : config.expected,
          jobs: [job(script)],
        }),
      );
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../tools/local-ci/run.mjs', import.meta.url)), path],
        {
          env: process.env,
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      assert.equal(child.status, exitCode, child.stderr);
      const receipt = JSON.parse(child.stdout);
      assert.equal(receipt.state, state);
      assert.equal(
        verifyRun(receipt.directory, stale ? { ...config.expected, head: 'a'.repeat(40) } : config.expected)
          .state,
        state,
      );
    }
  },
);
test(
  'success binds the source, tool bytes and actual output without inherited credentials',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const old = process.env.ALPHAFORGE_TEST_SECRET;
    process.env.ALPHAFORGE_TEST_SECRET = 'synthetic-do-not-inherit';
    t.after(() =>
      old === undefined
        ? delete process.env.ALPHAFORGE_TEST_SECRET
        : (process.env.ALPHAFORGE_TEST_SECRET = old),
    );
    const r = await runLocal({
      ...config,
      jobs: [
        job(
          "if(process.env.ALPHAFORGE_TEST_SECRET || process.env.GITHUB_ACTIONS || process.env.SSH_AUTH_SOCK)process.exit(8); console.log('checked')",
        ),
      ],
    });
    assert.equal(r.state, 'PASS');
    assert.equal(r.source.head, config.expected.head);
    assert.equal(r.source.tree, config.expected.tree);
    assert.match(r.jobs[0].executableSha256, /^[a-f0-9]{64}$/);
    assert.equal(r.jobs[0].exitCode, 0);
    assert.equal(r.jobs[0].cleanup, 'PASS');
    assert.equal(verifyRun(r.directory, config.expected).state, 'PASS');
    assert.match(readFileSync(join(r.directory, r.jobs[0].stdout.file), 'utf8'), /checked/);
  },
);
test(
  'a command failure remains failed after a separate successful rerun',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const failed = await runLocal({ ...config, jobs: [job('process.exit(7)')] });
    assert.equal(failed.state, 'FAIL');
    assert.equal(failed.jobs[0].exitCode, 7);
    const bytes = readFileSync(join(failed.directory, 'report.json'));
    const passed = await runLocal({ ...config, jobs: [job('console.log("ok")')] });
    assert.equal(passed.state, 'PASS');
    assert.notEqual(failed.directory, passed.directory);
    assert.deepEqual(readFileSync(join(failed.directory, 'report.json')), bytes);
    assert.equal(verifyRun(failed.directory, config.expected).state, 'FAIL');
  },
);
test(
  'timeouts terminate stubborn process groups rather than leave background work',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const code = "process.on('SIGTERM',()=>{}); console.log(process.pid);setInterval(()=>{},50)";
    const r = await runLocal({ ...config, jobs: [job(code, { timeoutMs: 200 })] });
    assert.equal(r.state, 'FAIL');
    assert.equal(r.jobs[0].timedOut, true);
    assert.equal(r.jobs[0].cleanup, 'PASS');
    assert.throws(() => process.kill(r.jobs[0].pid, 0), { code: 'ESRCH' });
  },
);
test('abnormal signal termination cannot become PASS', { skip: !available }, async (t) => {
  const { config, job } = fixture(t);
  const r = await runLocal({ ...config, jobs: [job("process.kill(process.pid,'SIGTERM')")] });
  assert.equal(r.state, 'FAIL');
  assert.equal(r.jobs[0].signal, 'SIGTERM');
});
test(
  'a parent exiting successfully with a live child is blocked and cleaned up',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const code =
      "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},50)'],{stdio:'ignore'});console.log(c.pid);c.unref();";
    const r = await runLocal({ ...config, jobs: [job(code)] });
    assert.equal(r.jobs.length, 1, JSON.stringify(r));
    assert.equal(r.state, 'BLOCKED');
    assert.equal(r.jobs[0].leftChildren, true);
    assert.equal(r.jobs[0].cleanup, 'PASS');
    const pid = Number(readFileSync(join(r.directory, r.jobs[0].stdout.file), 'utf8').trim());
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  },
);
test(
  'missing and tampered logs invalidate previously successful evidence',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    for (const mode of ['missing', 'changed']) {
      const r = await runLocal({ ...config, jobs: [job('console.log("evidence")')] });
      const path = join(r.directory, r.jobs[0].stdout.file);
      if (mode === 'missing') rmSync(path);
      else writeFileSync(path, 'replacement');
      assert.equal(verifyRun(r.directory, config.expected).state, 'BLOCKED');
    }
  },
);
test(
  'stale source and wrong tool requirements cannot launch a passing command',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    for (const patch of [{ head: 'a'.repeat(40) }, { tree: 'b'.repeat(40) }, { node: '0.0.0' }]) {
      const r = await runLocal({
        ...config,
        expected: { ...config.expected, ...patch },
        jobs: [job('console.log("must not run")')],
      });
      assert.equal(r.state, 'BLOCKED');
      assert.equal(r.jobs.length, 0);
    }
  },
);
test('unsupported native platforms are NOT_RUN, not simulated successes', { skip: !available }, async (t) => {
  const { config, job } = fixture(t);
  const r = await runLocal({ ...config, jobs: [job('process.exit(9)', { platform: 'win32', arch: 'x64' })] });
  assert.equal(r.state, 'NOT_RUN');
  assert.equal(r.jobs[0].state, 'NOT_RUN');
  assert.equal(r.jobs[0].pid, undefined);
  assert.equal(verifyRun(r.directory, config.expected).state, 'NOT_RUN');
});

test(
  'a real non-executable command is BLOCKED before a successful job can be recorded',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const executable = join(config.cwd, 'non-executable');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
    const report = await runLocal({ ...config, jobs: [job('', { executable, args: [] })] });
    assert.equal(report.state, 'BLOCKED');
    assert.equal(report.jobs[0].processFailure, true);
    assert.equal(report.jobs[0].exitCode, null);
    assert.equal(report.jobs[0].cleanup, 'PASS');
    assert.equal(verifyRun(report.directory, config.expected).state, 'BLOCKED');
  },
);

test(
  'tracked symlinks cannot be accepted as a clean executable source snapshot',
  { skip: !available },
  async (t) => {
    const { config, job, git } = fixture(t);
    fs.symlinkSync('source.txt', join(config.cwd, 'linked.txt'));
    git('add', 'linked.txt');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture symlink',
    );
    const expected = {
      ...config.expected,
      head: git('rev-parse', 'HEAD'),
      tree: git('rev-parse', 'HEAD^{tree}'),
    };
    const report = await runLocal({ ...config, expected, jobs: [job('throw Error("must not run")')] });
    assert.equal(report.state, 'BLOCKED');
    assert.deepEqual(report.jobs, []);
  },
);
test('source mutation during execution invalidates the run', { skip: !available }, async (t) => {
  const { config, job } = fixture(t);
  const r = await runLocal({
    ...config,
    jobs: [job("require('node:fs').writeFileSync('source.txt','changed')")],
  });
  assert.equal(r.state, 'BLOCKED');
});

test(
  'a command committing different source cannot bind its successful exit to the original tree',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const code = `
    require('node:fs').writeFileSync('source.txt', 'committed replacement\\n');
    const git = (...args) => require('node:child_process').execFileSync('/usr/bin/git', [
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args
    ], {stdio:'pipe'});
    git('add', 'source.txt'); git('commit', '-m', 'fixture source mutation');
  `;
    const report = await runLocal({ ...config, jobs: [job(code)] });
    assert.equal(report.jobs[0].state, 'PASS');
    assert.equal(report.state, 'BLOCKED');
    assert.equal(verifyRun(report.directory, config.expected).state, 'BLOCKED');
  },
);

test(
  'replay refuses substituted log types and an empty job set even with recomputed digests',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const report = await runLocal({ ...config, jobs: [job('console.log("actual output")')] });
    assert.equal(report.state, 'PASS');
    const log = join(report.directory, report.jobs[0].stdout.file);
    const original = readFileSync(log);
    rmSync(log);
    fs.symlinkSync(report.jobs[0].stderr.file, log);
    assert.equal(verifyRun(report.directory, config.expected).state, 'BLOCKED');
    rmSync(log);
    mkdirSync(log);
    assert.equal(verifyRun(report.directory, config.expected).state, 'BLOCKED');
    rmSync(log, { recursive: true });
    writeFileSync(log, original);
    report.jobs = [];
    report.manifest = [];
    report.manifestSha256 = createHash('sha256')
      .update(JSON.stringify([], null, 2) + '\n')
      .digest('hex');
    const bytes = JSON.stringify(report, null, 2) + '\n';
    writeFileSync(join(report.directory, 'report.json'), bytes);
    writeFileSync(
      join(report.directory, 'report.sha256'),
      createHash('sha256').update(bytes).digest('hex') + '\n',
    );
    assert.equal(verifyRun(report.directory, config.expected).state, 'BLOCKED');
  },
);
test(
  'temporary non-repositories cannot inherit the enclosing checkout history',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const r = await runLocal({
      ...config,
      outputRoot: join(config.cwd, 'evidence'),
      jobs: [
        job(
          "const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'no-repository-'));const r=cp.spawnSync('/usr/bin/git',['rev-parse','HEAD'],{cwd,env:{PATH:process.env.PATH}});process.exit(r.status===128?0:9)",
        ),
      ],
    });
    assert.equal(r.state, 'PASS');
  },
);
test('invalid jobs and absent executables do not silently pass', { skip: !available }, async (t) => {
  const { config, job } = fixture(t);
  assert.equal((await runLocal({ ...config, jobs: [] })).state, 'BLOCKED');
  assert.equal(
    (await runLocal({ ...config, jobs: [job('', { executable: '/missing/af-program' })] })).state,
    'BLOCKED',
  );
  assert.equal((await runLocal({ ...config, jobs: [job('', { timeoutMs: 0 })] })).state, 'BLOCKED');
});
test(
  'readback rejects stale candidate and report tampering; no private runtime directories remain',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const r = await runLocal({ ...config, jobs: [job('process.exit(0)')] });
    assert.equal(verifyRun(r.directory, { ...config.expected, head: 'a'.repeat(40) }).state, 'BLOCKED');
    assert.ok(!readdirSync(r.directory).includes('private'));
    const path = join(r.directory, 'report.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.jobs[0].exitCode = 1;
    writeFileSync(path, JSON.stringify(data));
    assert.equal(verifyRun(r.directory, config.expected).state, 'BLOCKED');
  },
);
test(
  'readback rejects unknown job states even with a recomputed transport checksum',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const r = await runLocal({ ...config, jobs: [job('process.exit(0)')] });
    const data = JSON.parse(readFileSync(join(r.directory, 'report.json'), 'utf8'));
    data.jobs[0].state = 'UNRECOGNIZED';
    const bytes = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(join(r.directory, 'report.json'), bytes);
    writeFileSync(
      join(r.directory, 'report.sha256'),
      createHash('sha256').update(bytes).digest('hex') + '\n',
    );
    assert.equal(verifyRun(r.directory, config.expected).state, 'BLOCKED');
  },
);
test(
  'hidden index flags cannot bind changed executable bytes to an old tree',
  { skip: !available },
  async (t) => {
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
      const { config, job, git } = fixture(t);
      writeFileSync(join(config.cwd, 'check.mjs'), 'process.exit(7);\n');
      git('add', 'check.mjs');
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'Failing source',
      );
      config.expected.head = git('rev-parse', 'HEAD');
      config.expected.tree = git('rev-parse', 'HEAD^{tree}');
      git('update-index', flag, 'check.mjs');
      writeFileSync(join(config.cwd, 'check.mjs'), 'process.exit(0);\n');
      assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
      const r = await runLocal({ ...config, jobs: [job('', { args: ['check.mjs'] })] });
      assert.equal(r.state, 'BLOCKED');
      assert.equal(r.jobs.length, 0);
    }
  },
);
test(
  'a reason cannot excuse PASS over a real failed command after checksum recomputation',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const r = await runLocal({ ...config, jobs: [job('process.exit(7)')] });
    assert.equal(r.state, 'FAIL');
    const data = JSON.parse(readFileSync(join(r.directory, 'report.json'), 'utf8'));
    data.state = 'PASS';
    data.reason = 'synthetic bypass attempt';
    const bytes = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(join(r.directory, 'report.json'), bytes);
    writeFileSync(
      join(r.directory, 'report.sha256'),
      createHash('sha256').update(bytes).digest('hex') + '\n',
    );
    assert.equal(verifyRun(r.directory, config.expected).state, 'BLOCKED');
  },
);
test(
  'readback rejects missing or mistyped mandatory process evidence fields',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const r = await runLocal({ ...config, jobs: [job('process.exit(0)')] });
    for (const key of [
      'signal',
      'timedOut',
      'leftChildren',
      'processFailure',
      'logFailure',
      'pid',
      'startedAt',
      'finishedAt',
      'exitCode',
    ]) {
      for (const mode of ['missing', 'wrong-type']) {
        const data = structuredClone(r);
        if (mode === 'missing') delete data.jobs[0][key];
        else data.jobs[0][key] = {};
        const bytes = JSON.stringify(data, null, 2) + '\n';
        writeFileSync(join(r.directory, 'report.json'), bytes);
        writeFileSync(
          join(r.directory, 'report.sha256'),
          createHash('sha256').update(bytes).digest('hex') + '\n',
        );
        assert.equal(verifyRun(r.directory, config.expected).state, 'BLOCKED', `${key}: ${mode}`);
      }
    }
    const data = structuredClone(r);
    delete data.source.trackedSnapshotSha256;
    const bytes = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(join(r.directory, 'report.json'), bytes);
    writeFileSync(
      join(r.directory, 'report.sha256'),
      createHash('sha256').update(bytes).digest('hex') + '\n',
    );
    assert.equal(verifyRun(r.directory, config.expected).state, 'BLOCKED');
  },
);

// Reverting to a weak runtime digest must block this otherwise valid run.
test(
  'raw Git source binding works when weak Node digests are unavailable',
  { skip: !available },
  async (t) => {
    const { config, job, git } = fixture(t);
    const unusual = '文件 with spaces\n"quote".bin';
    writeFileSync(join(config.cwd, '.gitattributes'), '* text=auto eol=lf\n*.bin -text\n');
    writeFileSync(join(config.cwd, unusual), Buffer.from([0, 13, 10, 255, 128, 0]));
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'binary source binding',
    );
    config.expected.head = git('rev-parse', 'HEAD');
    config.expected.tree = git('rev-parse', 'HEAD^{tree}');
    const original = crypto.createHash;
    try {
      crypto.createHash = (algorithm, ...args) => {
        if (['sha1', 'md5'].includes(algorithm.toLowerCase())) throw new Error('Weak digest unavailable');
        return original(algorithm, ...args);
      };
      syncBuiltinESMExports();
      const r = await runLocal({ ...config, jobs: [job('console.log("bound actual source")')] });
      assert.equal(r.state, 'PASS');
      assert.equal(verifyRun(r.directory, config.expected).state, 'PASS');
      assert.match(readFileSync(join(r.directory, r.jobs[0].stdout.file), 'utf8'), /bound actual source/);
    } finally {
      crypto.createHash = original;
      syncBuiltinESMExports();
    }
  },
);

test(
  'clean Git normalization cannot admit different on-disk source bytes',
  { skip: !available },
  async (t) => {
    const { config, job, git } = fixture(t);
    writeFileSync(join(config.cwd, '.gitattributes'), '* text=auto eol=lf\nsource.txt text eol=crlf\n');
    git('add', '.gitattributes');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'explicit checkout normalization',
    );
    config.expected.head = git('rev-parse', 'HEAD');
    config.expected.tree = git('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(config.cwd, 'source.txt'), 'trusted fixture\r\n');
    git('add', 'source.txt');
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
    const r = await runLocal({ ...config, jobs: [job('console.log("must not run")')] });
    assert.equal(r.state, 'BLOCKED');
    assert.equal(r.jobs.length, 0);
  },
);

test(
  'runner refuses shallow history and tracked executable-mode drift before executing work',
  { skip: !available },
  async (t) => {
    const { config, job, git } = fixture(t);
    fs.chmodSync(join(config.cwd, 'source.txt'), 0o755);
    git('config', 'core.filemode', 'false');
    const changed = await runLocal({ ...config, jobs: [job('throw Error("must not execute")')] });
    assert.equal(changed.state, 'BLOCKED');
    assert.equal(changed.jobs.length, 0);
    fs.chmodSync(join(config.cwd, 'source.txt'), 0o644);
    const shallow = join(config.cwd, '.git/shallow');
    writeFileSync(shallow, config.expected.head + '\n');
    const incomplete = await runLocal({ ...config, jobs: [job('throw Error("must not execute")')] });
    assert.equal(incomplete.state, 'BLOCKED');
    assert.equal(incomplete.jobs.length, 0);
  },
);

test(
  'runner bounds real process logs and records a replayable blocked outcome',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const result = await runLocal({
      ...config,
      jobs: [job("process.stdout.write('x'.repeat(17 * 1024 * 1024));", { timeoutMs: 10000 })],
    });
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.jobs[0].logFailure, true);
    assert.equal(result.jobs[0].cleanup, 'PASS');
    assert.equal(verifyRun(result.directory, config.expected).state, 'BLOCKED');
  },
);

test(
  'fixture evidence replay rejects contradictory states, signals and artifact identity even with a recalculated checksum',
  { skip: !available },
  async (t) => {
    const { config, job } = fixture(t);
    const result = await runLocal({ ...config, jobs: [job('process.exit(0)')] });
    assert.equal(result.state, 'PASS');
    for (const mutate of [
      (r) => {
        r.state = 'APPROVED';
      },
      (r) => {
        r.jobs[0].state = 'FAIL';
      },
      (r) => {
        r.jobs[0].signal = 'SIGTERM';
      },
      (r) => {
        r.jobs[0].signal = 'INVALID';
        r.jobs[0].exitCode = null;
      },
      (r) => {
        r.jobs[0].exitCode = 256;
      },
      (r) => {
        r.jobs[0].executableSha256 = '0'.repeat(64);
      },
      (r) => {
        r.state = 'BLOCKED';
        r.reason = '';
        r.errorCode = 'INTERNAL';
      },
      (r) => {
        r.state = 'BLOCKED';
        r.reason = 'fixture';
        r.errorCode = '';
      },
      (r) => {
        r.state = 'FAIL';
      },
    ]) {
      const altered = structuredClone(result);
      mutate(altered);
      const bytes = JSON.stringify(altered, null, 2) + '\n';
      writeFileSync(join(result.directory, 'report.json'), bytes);
      writeFileSync(
        join(result.directory, 'report.sha256'),
        createHash('sha256').update(bytes).digest('hex') + '\n',
      );
      assert.equal(verifyRun(result.directory, config.expected).state, 'BLOCKED');
    }
  },
);
