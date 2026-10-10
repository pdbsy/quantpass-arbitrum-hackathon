import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import {
  PUBLIC_DEPLOYMENT_OCCURRENCE as occurrence,
  readGitleaksPublicDeploymentProof,
  adjudicateGitleaksPublicDeployment,
} from '../tools/security/gitleaks-public-deployment.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const observedAt = new Date('2026-10-10T12:00:00Z');
const tokenLines = [555, 591, 616, 652, 692, 728, 753, 789, 1003, 1039, 1064, 1100, 1215, 1243];
const findings = (commit = occurrence.publishedCommit, file = occurrence.file) =>
  tokenLines.map((line) => ({
    RuleID: 'generic-api-key',
    File: file,
    StartLine: line,
    EndLine: line,
    Commit: commit,
    Match: 'REDACTED',
    Secret: 'REDACTED',
    Email: 'do-not-emit@example.test',
  }));
const value = (report) => ({ status: report.length ? 10 : 0, report });
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_GRAFT_FILE: '/dev/null',
        GIT_NO_LAZY_FETCH: '1',
      },
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
const adjudicate = (scan, proof, options = {}) =>
  adjudicateGitleaksPublicDeployment(scan, proof, { scope: 'history', observedAt, ...options });
const realProof = (scan = value(findings())) =>
  readGitleaksPublicDeploymentProof(root, scan, { scope: 'history' });

function temporaryHistory() {
  const dir = mkdtempSync(join(tmpdir(), 'af-public-deployment-history-'));
  git(dir, 'init', '-b', 'main');
  const objects = git(root, 'rev-parse', '--git-path', 'objects').toString().trim();
  mkdirSync(join(dir, '.git', 'objects', 'info'), { recursive: true });
  writeFileSync(join(dir, '.git', 'objects', 'info', 'alternates'), resolve(root, objects) + '\n');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, occurrence.file), git(root, 'cat-file', 'blob', occurrence.blob));
  git(dir, 'add', occurrence.file);
  git(
    dir,
    '-c',
    'user.name=Proof Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'isolated same public deployment blob',
  );
  return dir;
}

test('exact published public addresses retain raw FAIL and produce only bounded proof dispositions', () => {
  const scan = value(findings());
  const before = JSON.stringify(scan);
  const proof = realProof(scan);
  assert.ok(proof);
  const result = adjudicate(scan, proof);
  assert.equal(result.raw.state, 'FAIL');
  assert.equal(result.raw.findings.length, 14);
  assert.equal(result.state, 'PASS');
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0].blob, occurrence.blob);
  assert.deepEqual(result.dispositions[0].lines, tokenLines);
  assert.equal(result.remainingScanValue.status, 0);
  assert.deepEqual(result.remainingScanValue.report, []);
  assert.equal(JSON.stringify(scan), before);
  assert.ok(!JSON.stringify(result.dispositions).includes('REDACTED'));
  assert.ok(!JSON.stringify(result.dispositions).includes('do-not-emit'));
});

test('different source and merge-like commits qualify only through typed Git tree-to-blob bindings', () => {
  const dir = temporaryHistory();
  try {
    const extraCommit = git(dir, 'rev-parse', 'HEAD').toString().trim();
    const scan = value([...findings(), ...findings(extraCommit)]);
    const result = adjudicate(scan, readGitleaksPublicDeploymentProof(dir, scan, { scope: 'history' }));
    assert.equal(result.state, 'PASS');
    assert.equal(result.dispositions.length, 2);
    assert.equal(result.raw.findings.length, 28);
    const wrong = value(findings('f'.repeat(40)));
    assert.equal(readGitleaksPublicDeploymentProof(dir, wrong, { scope: 'history' }), null);
    assert.equal(adjudicate(wrong, realProof()).state, 'FAIL');
    writeFileSync(join(dir, occurrence.file), '{}\n');
    git(dir, 'add', occurrence.file);
    git(
      dir,
      '-c',
      'user.name=Proof Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'different blob remains blocking',
    );
    const wrongBlob = value(findings(git(dir, 'rev-parse', 'HEAD').toString().trim()));
    assert.equal(readGitleaksPublicDeploymentProof(dir, wrongBlob, { scope: 'history' }), null);
    assert.equal(adjudicate(wrongBlob, realProof()).state, 'FAIL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replacement objects cannot change historical path proof and invented commit/tree evidence fails', () => {
  const dir = temporaryHistory();
  try {
    const extraCommit = git(dir, 'rev-parse', 'HEAD').toString().trim();
    writeFileSync(join(dir, occurrence.file), '{}\n');
    git(dir, 'add', occurrence.file);
    git(
      dir,
      '-c',
      'user.name=Proof Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'replacement target wrong blob',
    );
    const replacement = git(dir, 'rev-parse', 'HEAD').toString().trim();
    git(dir, 'replace', extraCommit, replacement);
    const scan = value(findings(extraCommit));
    const proof = readGitleaksPublicDeploymentProof(dir, scan, { scope: 'history' });
    assert.equal(adjudicate(scan, proof).state, 'PASS');
    const damaged = {
      ...proof,
      commits: {
        ...proof.commits,
        [extraCommit]: { ...proof.commits[extraCommit], docsTree: Buffer.from('forged tree') },
      },
    };
    assert.equal(adjudicate(scan, damaged).state, 'FAIL');
    const invented = {
      ...proof,
      commits: {
        ...proof.commits,
        [extraCommit]: {
          ...proof.commits[extraCommit],
          commit: Buffer.from('tree ' + 'a'.repeat(40) + '\n'),
        },
      },
    };
    assert.equal(adjudicate(scan, invented).state, 'FAIL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('current stage uses its exact canonical absolute path and identical approved bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-public-deployment-stage-'));
  const stagedRoot = join(dir, 'source');
  const file = join(stagedRoot, occurrence.file);
  mkdirSync(join(stagedRoot, 'docs'), { recursive: true });
  writeFileSync(file, git(root, 'cat-file', 'blob', occurrence.blob));
  try {
    const scan = value(findings('', file));
    const options = { scope: 'current', stagedRoot, observedAt };
    const proof = readGitleaksPublicDeploymentProof(root, scan, options);
    const result = adjudicateGitleaksPublicDeployment(scan, proof, options);
    assert.equal(result.state, 'PASS');
    assert.equal(result.dispositions.length, 1);
    assert.equal(
      adjudicateGitleaksPublicDeployment(value(findings('', occurrence.file)), proof, options).state,
      'FAIL',
    );
    assert.equal(
      adjudicateGitleaksPublicDeployment(value(findings('', file + '.backup')), proof, options).state,
      'FAIL',
    );
    assert.equal(
      adjudicateGitleaksPublicDeployment(scan, proof, { ...options, stagedRoot: join(dir, 'other') }).state,
      'FAIL',
    );
    const changed = readFileSync(file, 'utf8').replace(
      /"token": "0x[0-9a-fA-F]{40}"/,
      '"token": "0x' + 'a'.repeat(64) + '"',
    );
    writeFileSync(file, changed);
    assert.equal(readGitleaksPublicDeploymentProof(root, scan, options), null);
    assert.equal(
      adjudicateGitleaksPublicDeployment(scan, { ...proof, stagedBlob: Buffer.from(changed) }, options).state,
      'FAIL',
    );
    rmSync(file);
    symlinkSync(join(root, occurrence.file), file);
    assert.equal(readGitleaksPublicDeploymentProof(root, scan, options), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wrong rule, extra/duplicate/multiline findings, private key, wrong blob and expired proof remain FAIL', () => {
  const scan = value(findings()),
    proof = realProof(scan);
  for (const patch of [
    { RuleID: 'github-pat' },
    { File: 'unrelated.json' },
    { StartLine: 556, EndLine: 556 },
    { EndLine: 556 },
    { EndLine: undefined },
    { Commit: 'f'.repeat(40) },
  ]) {
    const rows = findings();
    rows[0] = { ...rows[0], ...patch };
    assert.equal(adjudicate(value(rows), proof).state, 'FAIL');
  }
  assert.equal(adjudicate(value([...findings(), findings()[0]]), proof).state, 'FAIL');
  assert.equal(adjudicate(value(findings().slice(1)), proof).state, 'FAIL');
  const unknown = { ...findings()[0], File: 'unexpected-secret.env', StartLine: 1, EndLine: 1 };
  const withExtra = adjudicate(value([...findings(), unknown]), proof);
  assert.equal(withExtra.state, 'FAIL');
  assert.deepEqual(withExtra.remainingScanValue.report, [unknown]);
  const privateKey = proof.blob
    .toString('utf8')
    .replace(/"token": "0x[0-9a-fA-F]{40}"/, '"token": "0x' + 'a'.repeat(64) + '"');
  assert.equal(adjudicate(scan, { ...proof, blob: Buffer.from(privateKey) }).state, 'FAIL');
  assert.equal(adjudicate(scan, { ...proof, blob: Buffer.from('{}\n') }).state, 'FAIL');
  assert.equal(adjudicate(scan, null).state, 'FAIL');
  for (const time of ['2026-10-09T23:59:59Z', occurrence.expiresAt, '2027-01-01T00:00:00Z'])
    assert.equal(adjudicate(scan, proof, { observedAt: new Date(time) }).state, 'FAIL');
  assert.equal(adjudicate(scan, proof, { observedAt: new Date(NaN) }).state, 'FAIL');
});

test('scanner process/report schema failures never obtain a public-address disposition', () => {
  const proof = realProof();
  for (const scan of [
    { status: 0, report: findings() },
    { status: 10, report: [] },
    { status: 10, report: null },
    { status: 10, report: findings(), signal: 'SIGTERM' },
    { status: 10, report: findings(), error: new Error('scanner failed') },
    { status: 10, report: [{ ...findings()[0], Commit: '../not-a-commit' }] },
  ]) {
    const result = adjudicate(scan, proof);
    assert.equal(result.state, 'BLOCKED');
    assert.deepEqual(result.dispositions, []);
  }
  assert.equal(adjudicate(value([]), null).state, 'PASS');
});
