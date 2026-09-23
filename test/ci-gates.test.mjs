import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink, readFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { ESLint } from 'eslint';
import { validateContractHost, runContractStages } from '../tools/ci/verify-contracts.mjs';
import { scanSources, sourceTargets } from '../tools/ci/check-source-policy.mjs';
import { compareLocks, classifyAudit, candidateRefs } from '../tools/ci/check-dependency-delta.mjs';
import { validateCIGateWorkflows } from '../tools/ci/workflow-contract.mjs';
import { assertUnchanged } from '../tools/ci/context.mjs';

test('source policy rejects a real aggregate byte overflow before linting any files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-source-byte-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = [];
  for (let index = 0; index < 17; index++) {
    const path = `source-${index}.ts`;
    await writeFile(join(root, path), '');
    await truncate(join(root, path), 2 * 1024 * 1024);
    paths.push(path);
  }
  await assert.rejects(scanSources(root, paths), /Source coverage exceeds limit/);
});

test('source policy rejects an incomplete result at the real ESLint executor boundary', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'alphaforge-source-incomplete-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['x.ts', 'y.ts']) await writeFile(join(root, name), 'export const x = 1;\n');
  const original = ESLint.prototype.lintFiles;
  let observed = 0;
  t.mock.method(ESLint.prototype, 'lintFiles', async function (...args) {
    const results = await original.apply(this, args);
    assert.equal(results.length, 2);
    observed++;
    // Explicit fault injection: lose one genuine engine result. This is a
    // reconciliation test, not a claim that this ESLint version drops files.
    return results.slice(1);
  });
  await assert.rejects(scanSources(root, ['x.ts', 'y.ts']), /Incomplete source scan/);
  assert.equal(observed, 1);
});

test('gate evidence rejects dirty state and changed commit, tree or lock after execution', () => {
  const before = {
    head: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    lockSha256: 'c'.repeat(64),
    trackedClean: true,
  };
  assert.doesNotThrow(() => assertUnchanged(before, { ...before }));
  for (const patch of [
    { head: 'd'.repeat(40) },
    { tree: 'd'.repeat(40) },
    { lockSha256: 'd'.repeat(64) },
    { trackedClean: false },
  ])
    assert.throws(() => assertUnchanged(before, { ...before, ...patch }));
  assert.throws(() => assertUnchanged({ ...before, trackedClean: false }, before));
});

test('contract host rejects unsupported execution environments before tool installation', () => {
  const host = { platform: 'darwin', arch: 'arm64', python: '3.12.9', pythonArch: 'arm64' };
  assert.doesNotThrow(() => validateContractHost(host));
  for (const patch of [
    { platform: 'linux' },
    { arch: 'x64' },
    { python: '3.12.10' },
    { pythonArch: 'x86_64' },
  ])
    assert.throws(() => validateContractHost({ ...host, ...patch }));
});

test('contract stages stop on bootstrap/probe/test failure and never invent ABI success', () => {
  for (const [failAt, expected, completed] of [
    [0, 'BLOCKED', 1],
    [1, 'BLOCKED', 2],
    [2, 'FAIL', 3],
  ]) {
    let calls = 0;
    const report = runContractStages(() => ({ status: calls++ === failAt ? 1 : 0, signal: null }));
    assert.equal(report.state, expected);
    assert.equal(calls, completed);
    assert.notEqual(report.abi, 'PASS');
  }
  assert.equal(runContractStages(() => ({ status: null, signal: 'SIGTERM' })).state, 'BLOCKED');
  const calls = [];
  const report = runContractStages((file, args) => {
    calls.push([file, args]);
    return { status: 0, signal: null };
  });
  assert.equal(report.state, 'PASS');
  assert.equal(report.abi, 'PASS');
  assert.deepEqual(calls[2], ['/bin/bash', ['contracts/script/check-phase1-contracts.sh']]);
});

test('Phase One contract gate cannot skip artifact manifest and rehearsal failures', () => {
  const report = runContractStages((_file, args) => ({
    status: args.includes('contracts/script/check-phase1-contracts.sh') ? 1 : 0,
    signal: null,
  }));
  assert.equal(report.state, 'FAIL');
  assert.notEqual(report.abi, 'PASS');
});

async function sourceFixture(t, text, name = 'entry.tsx') {
  const dir = await mkdtemp(join(tmpdir(), 'af-source-policy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'apps'));
  const path = `apps/${name}`;
  await writeFile(join(dir, path), text);
  return { dir, path };
}

test('source policy scans TSX and rejects dangerous dynamic code even with inline disable', async (t) => {
  const fixture = await sourceFixture(t, 'export const view = <div>safe</div>;');
  assert.equal((await scanSources(fixture.dir, [fixture.path])).state, 'PASS');
  for (const code of [
    'eval(input);',
    'new Function(input);',
    'setTimeout("doWork()", 10);',
    'const href = "javascript:bad()";',
    '/* eslint-disable */\neval(input);',
  ]) {
    await writeFile(join(fixture.dir, fixture.path), code);
    const report = await scanSources(fixture.dir, [fixture.path]);
    assert.equal(report.state, 'FAIL', code);
    assert.ok(report.errors + report.warnings > 0);
  }
  await writeFile(join(fixture.dir, fixture.path), 'const value = ;');
  assert.equal((await scanSources(fixture.dir, [fixture.path])).state, 'BLOCKED');
});

test('source target coverage rejects empty, missing and escaping files', async (t) => {
  const fixture = await sourceFixture(t, 'export const value = 1;');
  assert.deepEqual(
    sourceTargets([
      'apps/a.ts',
      'packages/b.mjs',
      'docs/board.js',
      'tools/check.mjs',
      'test/fixture.ts',
      'apps/node_modules/x.js',
      'apps/dist/x.js',
    ]),
    ['apps/a.ts', 'docs/board.js', 'packages/b.mjs', 'tools/check.mjs'],
  );
  await assert.rejects(scanSources(fixture.dir, []));
  await assert.rejects(scanSources(fixture.dir, ['apps/missing.ts']));
  await assert.rejects(scanSources(fixture.dir, ['../outside.ts']));
  await symlink(join(fixture.dir, fixture.path), join(fixture.dir, 'apps/link.ts'));
  await assert.rejects(scanSources(fixture.dir, ['apps/link.ts']));
});

test('dependency diff detects all metadata changes as well as adds and removals', () => {
  const old = {
    packages: {
      '': { name: 'fixture' },
      'node_modules/a': { version: '1.0.0', integrity: 'old', license: 'MIT' },
    },
  };
  assert.deepEqual(compareLocks(old, structuredClone(old)), { added: [], removed: [], changed: [] });
  for (const patch of [
    { version: '2.0.0' },
    { integrity: 'new' },
    { license: 'ISC' },
    { optional: true },
    { resolved: 'new' },
  ]) {
    const head = structuredClone(old);
    Object.assign(head.packages['node_modules/a'], patch);
    assert.equal(compareLocks(old, head).changed.length, 1);
  }
  const head = { packages: { '': { name: 'fixture' }, 'node_modules/b': { version: '1.0.0' } } };
  assert.equal(compareLocks(old, head).added[0].path, 'node_modules/b');
  assert.equal(compareLocks(old, head).removed[0].path, 'node_modules/a');
});

function auditResult(counts = {}, vulnerabilities = {}) {
  return {
    status: 0,
    signal: null,
    report: {
      auditReportVersion: 2,
      vulnerabilities,
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...counts },
        dependencies: { total: 2 },
      },
    },
  };
}
test('dependency audit rejects incomplete/network/timeout results and blocks high severity', () => {
  assert.equal(classifyAudit(auditResult()).state, 'PASS');
  const high = auditResult({ high: 1, total: 1 }, { a: { severity: 'high' } });
  high.status = 1;
  assert.equal(classifyAudit(high).state, 'FAIL');
  const low = auditResult({ low: 1, total: 1 }, { a: { severity: 'low' } });
  assert.equal(classifyAudit(low).state, 'PASS');
  for (const patch of [
    { status: 2 },
    { signal: 'SIGTERM' },
    { error: new Error('timeout') },
    { report: {} },
    { report: { error: { code: 'ENETUNREACH' } } },
    { report: { ...high.report, metadata: auditResult().report.metadata } },
  ])
    assert.equal(classifyAudit({ ...auditResult(), ...patch }).state, 'BLOCKED');
});

test('dependency candidate binding distinguishes PR heads from merge checkout and new branch baselines', () => {
  const base = 'a'.repeat(40),
    head = 'b'.repeat(40),
    checkout = 'c'.repeat(40);
  assert.deepEqual(
    candidateRefs(
      'pull_request',
      { pull_request: { base: { sha: base }, head: { sha: head } } },
      { head: checkout, master: base },
    ),
    { base, head, baselineKind: 'pull_request' },
  );
  assert.deepEqual(candidateRefs('push', { before: '0'.repeat(40), after: head }, { head, master: base }), {
    base,
    head,
    baselineKind: 'new-branch-origin-master',
  });
  assert.throws(() => candidateRefs('pull_request', {}, { head, master: base }));
  assert.throws(() => candidateRefs('push', { before: '--bad', after: head }, { head, master: base }));
});

test('actual CI gate contracts reject skipped, replaced and weakened jobs', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateCIGateWorkflows(stringify(workflow)));
  for (const job of [
    'contracts-m3-macos',
    'source-policy-js',
    'dependency-delta-audit',
    'semgrep-ce',
    'osv-scanner',
    'gitleaks',
  ]) {
    for (const mutate of [
      (w) => {
        delete w.jobs[job];
      },
      (w) => {
        w.jobs[job].if = false;
      },
      (w) => {
        w.jobs[job]['continue-on-error'] = true;
      },
      (w) => {
        w.jobs[job].steps.at(-1).run = 'echo PASS';
      },
      (w) => {
        w.jobs[job].steps.at(-1).if = false;
      },
      (w) => {
        w.jobs[job].steps[0].with['fetch-depth'] = 1;
      },
    ]) {
      const bad = structuredClone(workflow);
      mutate(bad);
      assert.throws(() => validateCIGateWorkflows(stringify(bad)));
    }
  }
});

test('Python gate qualification refuses version, architecture and floating setup drift', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  for (const job of ['contracts-m3-macos', 'semgrep-ce']) {
    for (const patch of [
      { 'python-version': '3.12.10' },
      { architecture: 'unsupported' },
      { 'check-latest': true },
    ]) {
      const bad = structuredClone(workflow);
      Object.assign(bad.jobs[job].steps[4].with, patch);
      assert.throws(() => validateCIGateWorkflows(stringify(bad)));
    }
  }
});
