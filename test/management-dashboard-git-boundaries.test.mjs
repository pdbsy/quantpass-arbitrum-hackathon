import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { collectRecordedGitState, isGitCommitAncestor } from '../tools/management-dashboard/sources.mjs';
const sourceUrl = pathToFileURL(resolve('tools/management-dashboard/sources.mjs')).href;
const branch = 'macbeth/git-review';
const git = (root, args) =>
  fixtureExec('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();
async function fixture(t) {
  await mkdir('.checks', { recursive: true });
  const root = await mkdtemp(resolve('.checks/git-evidence-review-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  git(root, ['init', '--quiet', '-b', 'master']);
  await writeFile(join(root, 'README.md'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['switch', '--quiet', '-c', branch]);
  await writeFile(join(root, 'README.md'), 'source\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'source']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  return {
    root,
    base,
    commit,
    tree,
    recorded: { branch, commit, tree, dirtyFiles: 0, observedAt: '2026-09-23T00:00:00Z' },
  };
}
test('recorded Git rejects otherwise valid CI with third branch, absent pull ref, or unsupported event', async (t) => {
  const f = await fixture(t);
  const valid = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: f.commit,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/' + branch,
  };
  const missingRef = {
    ...valid,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_BASE_REF: 'master',
    GITHUB_HEAD_REF: branch,
  };
  delete missingRef.GITHUB_REF;
  for (const environment of [
    { ...valid, GITHUB_REF: 'refs/heads/unrelated' },
    missingRef,
    { ...valid, GITHUB_EVENT_NAME: 'schedule' },
  ]) {
    const r = await collectRecordedGitState(f.root, 'master', f.recorded, { environment });
    assert.equal(r.error, 'RECORDED_GIT_CI_CONTEXT_INVALID');
    assert.equal(r.status, 'DATA_SOURCE_ERROR');
    assert.equal(r.commit, undefined);
  }
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.commit);
});
test('recorded Git missing local base falls back to an actual origin tracking reference', async (t) => {
  const f = await fixture(t);
  git(f.root, ['update-ref', 'refs/remotes/origin/master', f.base]);
  git(f.root, ['branch', '-D', 'master']);
  const r = await collectRecordedGitState(f.root, 'master', f.recorded);
  assert.equal(r.status, 'READY');
  assert.equal(r.commit, f.commit);
  assert.deepEqual(r.aheadBehind, { ahead: 1, behind: 0 });
});
test('recorded Git real malformed base reference fails closed with a generic query error', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.root, '.git/refs/heads/master'), 'f'.repeat(40) + '\n');
  let native;
  try {
    git(f.root, ['show-ref', '--verify', '--quiet', 'refs/heads/master']);
    assert.fail('must fail');
  } catch (error) {
    native = error;
  }
  assert.equal(typeof native.status, 'number');
  assert.notEqual(native.status, 0);
  assert.notEqual(native.status, 1);
  const r = await collectRecordedGitState(f.root, 'master', f.recorded);
  assert.equal(r.status, 'DATA_SOURCE_ERROR');
  assert.equal(r.error, 'RECORDED_GIT_QUERY_FAILED');
  assert.equal(r.commit, undefined);
  assert.doesNotMatch(JSON.stringify(r), /malformed-ref|fatal|\.checks/);
});
test('recorded Git missing intermediate commit object produces real Git fatal graph failures', async (t) => {
  const f = await fixture(t);
  const intermediate = f.commit;
  await writeFile(join(f.root, 'README.md'), 'descendant\n');
  git(f.root, ['add', '.']);
  git(f.root, ['commit', '--quiet', '-m', 'descendant']);
  const child = git(f.root, ['rev-parse', 'HEAD']);
  const tree = git(f.root, ['rev-parse', 'HEAD^{tree}']);
  await rm(join(f.root, '.git/objects', intermediate.slice(0, 2), intermediate.slice(2)));
  for (const args of [
    ['merge-base', '--is-ancestor', f.base, child],
    ['merge-base', f.base, child],
  ]) {
    let native;
    try {
      git(f.root, args);
      assert.fail('must fail');
    } catch (error) {
      native = error;
    }
    assert.equal(typeof native.status, 'number');
    assert.notEqual(native.status, 0);
    assert.notEqual(native.status, 1, 'fatal native graph error, not an ancestor miss');
    assert.match(native.stderr.toString(), /could not read|unable to read|bad object/i);
  }
  assert.equal(await isGitCommitAncestor(f.root, f.base, child), false);
  const r = await collectRecordedGitState(f.root, 'master', { ...f.recorded, commit: child, tree });
  assert.equal(r.status, 'DATA_SOURCE_ERROR');
  assert.equal(r.error, 'RECORDED_GIT_QUERY_FAILED');
  assert.equal(r.commit, undefined);
});
for (const collector of ['collectGitState', 'collectRecordedGitState'])
  test(`${collector} waits for an owned Git probe after another probe rejects`, async (t) => {
    const f = await fixture(t);
    await writeFile(join(f.root, '.git/refs/heads/master'), 'f'.repeat(40) + '\n');
    const releaseFile = join(f.root, '.git/release-status-probe');
    // Only the launch scheduling boundary is held. The delayed child executes
    // the original Git arguments in its real cwd and returns Git's own bytes.
    const program = `
      import assert from 'node:assert/strict';
      import cp from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { promisify } from 'node:util';
      import { setTimeout as delay } from 'node:timers/promises';
      const [root, releaseFile, moduleUrl, collector, serializedRecord] = process.argv.slice(1);
      const original = cp.execFile;
      const children = [];
      let pending = 0;
      let ordinaryPending = 0;
      let held = 0;
      let ready = false;
      const delayedGit = \`
        const fs = require('node:fs');
        const { spawnSync } = require('node:child_process');
        const [args, releaseFile] = process.argv.slice(1);
        fs.writeFileSync(releaseFile + '.ready', 'ready');
        const deadline = Date.now() + 8000;
        const timer = setInterval(() => {
          if (!fs.existsSync(releaseFile)) {
            if (Date.now() > deadline) { clearInterval(timer); process.exitCode = 124; }
            return;
          }
          clearInterval(timer);
          const result = spawnSync('git', JSON.parse(args), {
            cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 4000,
          });
          if (result.error) throw result.error;
          process.stdout.write(result.stdout);
          process.stderr.write(result.stderr);
          process.exitCode = result.status ?? 1;
        }, 10);
      \`;
      cp.execFile = function(file, args, options, callback) {
        const hold = file === 'git' && args.includes('status');
        if (hold) held++;
        else ordinaryPending++;
        pending++;
        const child = hold
          ? original(process.execPath, ['--eval', delayedGit, JSON.stringify(args), releaseFile], options, callback)
          : original(file, args, options, callback);
        children.push(new Promise((resolve) => child.once('close', () => {
          pending--;
          if (!hold) ordinaryPending--;
          resolve();
        })));
        return child;
      };
      cp.execFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
        cp.execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({stdout, stderr}));
      });
      syncBuiltinESMExports();
      const sources = await import(moduleUrl);
      let settled = false;
      let pendingAtResolution;
      const collection = (collector === 'collectGitState'
        ? sources.collectGitState(root)
        : sources.collectRecordedGitState(root, 'master', JSON.parse(serializedRecord), {environment: {}})
      ).then((value) => { settled = true; pendingAtResolution = pending; return value; });
      const { existsSync } = await import('node:fs');
      try {
        const deadline = Date.now() + 3000;
        while (!(ready = existsSync(releaseFile + '.ready')) || ordinaryPending !== 0) {
          assert.ok(Date.now() < deadline, 'real Git scheduling barrier reached within deadline');
          await delay(10);
        }
        await delay(0);
        assert.equal(held, 1, 'one real status probe was held');
        assert.equal(pending, 1, 'the owned delayed Git launcher is still alive');
        assert.equal(settled, false, 'collector returned while its Git probe was still alive');
        writeFileSync(releaseFile, 'release');
        const actual = await collection;
        assert.equal(actual.status, 'DATA_SOURCE_ERROR');
        assert.equal(actual.error, collector === 'collectGitState' ? 'GIT_QUERY_FAILED' : 'RECORDED_GIT_QUERY_FAILED');
        assert.equal(actual.commit, undefined);
        assert.equal(pendingAtResolution, 0, 'all original probe handles closed before result');
      } finally {
        writeFileSync(releaseFile, 'release');
        await collection;
        await Promise.all(children);
      }
      assert.equal(pending, 0);
      console.log('REAL_GIT_PROBES_DRAINED');
    `;
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        program,
        f.root,
        releaseFile,
        sourceUrl,
        collector,
        JSON.stringify(f.recorded),
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'REAL_GIT_PROBES_DRAINED\n');
    assert.equal(child.stderr, '');
  });
test('recorded Git malformed recorded branch and base stay generic and never reveal provenance', async (t) => {
  const f = await fixture(t);
  for (const [base, recorded] of [
    ['-invalid', f.recorded],
    ['master', { ...f.recorded, branch: '../invalid' }],
  ]) {
    const r = await collectRecordedGitState(f.root, base, recorded);
    assert.equal(r.error, 'RECORDED_GIT_INVALID');
    assert.equal(r.status, 'DATA_SOURCE_ERROR');
    assert.equal(r.commit, undefined);
  }
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), f.commit);
});
test('Git evidence works when TMPDIR is genuinely absent from a child environment', async (t) => {
  const f = await fixture(t);
  const env = { ...process.env };
  delete env.TMPDIR;
  const program = `import {collectGitState} from ${JSON.stringify(sourceUrl)};if(process.env.TMPDIR!==undefined)throw Error('TMPDIR not absent');console.log(JSON.stringify(await collectGitState(${JSON.stringify(f.root)})));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    env,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  const r = JSON.parse(child.stdout);
  assert.equal(r.status, 'READY');
  assert.equal(r.commit, f.commit);
});
test('recorded Git real atomic ref update between Git reads rejects the mixed checkout snapshot', async (t) => {
  const f = await fixture(t);
  const next = git(f.root, ['commit-tree', f.tree, '-p', f.commit, '-m', 'same tree successor']);
  // Control only scheduling at the real child-process boundary: every stdout and
  // stderr value still comes from Git itself, including the atomic update-ref.
  const preload = join(f.root, '.git/real-ref-race.cjs');
  await writeFile(
    preload,
    `
 const cp=require('node:child_process');const {syncBuiltinESMExports}=require('node:module');const original=cp.execFile;
 let moved=false;
 cp.execFile=function(file,args,options,callback){
  if(!moved&&file==='git'&&args.includes('rev-parse')&&args.at(-1)===${JSON.stringify('refs/heads/' + branch + '^{commit}')}){
   moved=true;cp.execFileSync('git',['update-ref',${JSON.stringify('refs/heads/' + branch)},${JSON.stringify(next)},${JSON.stringify(f.commit)}],{cwd:options.cwd,env:options.env});
  }
  return original(file,args,options,callback);
 };cp.execFile[require('node:util').promisify.custom]=(...args)=>new Promise((resolve,reject)=>cp.execFile(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));syncBuiltinESMExports();
 `,
  );
  const program = `import {collectRecordedGitState} from ${JSON.stringify(sourceUrl)};console.log(JSON.stringify(await collectRecordedGitState(${JSON.stringify(f.root)},'master',${JSON.stringify(f.recorded)})));`;
  const child = spawnSync(
    process.execPath,
    ['--require', preload, '--input-type=module', '--eval', program],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  const r = JSON.parse(child.stdout);
  assert.equal(r.error, 'RECORDED_GIT_BRANCH_MISMATCH');
  assert.equal(r.status, 'DATA_SOURCE_ERROR');
  assert.equal(r.commit, undefined);
  assert.equal(git(f.root, ['rev-parse', 'HEAD']), next);
  assert.equal(git(f.root, ['rev-parse', 'HEAD^{tree}']), f.tree);
});
