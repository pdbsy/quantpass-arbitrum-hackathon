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
  t.after(() => rm(root, { recursive: true, force: true }));
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
