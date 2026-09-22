import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifySemgrep, classifyOSV, packageKey } from '../tools/security/results.mjs';
import { buildInventory } from '../tools/security/inputs.mjs';
import { stageSources } from '../tools/security/staging.mjs';
import {
  adjudicateGitleaksHistory,
  readGitleaksExceptionProof,
} from '../tools/security/gitleaks-disposition.mjs';
import { compareLocks, classifyAudit, candidateRefs } from '../tools/ci/check-dependency-delta.mjs';
import { validateCommitSetIdentity } from '../tools/agent-identity-set.mjs';
import { verify } from '../tools/verify-ci.mjs';
import { fixtureExec } from './helpers/git-fixture.mjs';
import { scanWorkspace } from '../tools/check-secrets.mjs';

test('secret baseline rejects environment files and read errors while retaining its explicit binary boundary', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-secret-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  fixtureExec('git', ['init', '--quiet', '-b', 'master'], { cwd: root });
  writeFileSync(join(root, '.env.example'), 'MODE=mock\n');
  writeFileSync(join(root, 'asset.bin'), Buffer.from([65, 0, 66]));
  await scanWorkspace(root);
  writeFileSync(join(root, '.env.local'), 'MODE=mock\n');
  await assert.rejects(scanWorkspace(root), /\.env\.local: environment-file/);
  rmSync(join(root, '.env.local'));
  const source = join(root, 'source.txt');
  writeFileSync(source, 'ordinary source\n');
  fixtureExec('git', ['add', 'source.txt'], { cwd: root });
  rmSync(source);
  await scanWorkspace(root);
  mkdirSync(source);
  await assert.rejects(scanWorkspace(root), (error) => error.code === 'EISDIR');
  rmSync(source, { recursive: true });
  const synthetic = ['ghp', '_', 'A'.repeat(36)].join('');
  writeFileSync(source, synthetic);
  await assert.rejects(scanWorkspace(root), (error) => {
    assert.match(error.message, /source\.txt: github-token/);
    assert.doesNotMatch(error.message, new RegExp(synthetic));
    return true;
  });
});

// Malformed scanner success must not admit findings with incomplete identities.
test('Semgrep rejects contradictory exits and incomplete finding locations', () => {
  const finding = { check_id: 'fixture.rule', path: 'fixture.ts', start: { line: 1 } };
  const report = { version: '1.177.0', results: [finding], errors: [], paths: { scanned: ['fixture.ts'] } };
  assert.equal(classifySemgrep({ status: 1, report }, ['fixture.ts'], '1.177.0').state, 'FAIL');
  assert.equal(classifySemgrep({ status: 0, report }, ['fixture.ts'], '1.177.0').state, 'BLOCKED');
  for (const patch of [{ check_id: '' }, { path: 'outside.ts' }, { start: {} }, { start: { line: 0 } }]) {
    assert.equal(
      classifySemgrep(
        { status: 1, report: { ...report, results: [{ ...finding, ...patch }] } },
        ['fixture.ts'],
        '1.177.0',
      ).state,
      'BLOCKED',
    );
  }
});

test('OSV rejects malformed package identities and partial advisory rows', () => {
  for (const entry of [
    null,
    { name: '' },
    { name: 'fixture', commit: '--bad' },
    { name: 'fixture', ecosystem: 'unknown', version: '1.0.0' },
    { name: 'fixture', ecosystem: 'npm', version: '' },
  ])
    assert.throws(() => packageKey(entry));
  const packageValue = { ecosystem: 'npm', name: 'fixture', version: '1.0.0' };
  const run = (result, status = 0) => classifyOSV({ status, report: { results: [result] } }, [packageValue]);
  assert.equal(run({ packages: [{ package: packageValue }] }).state, 'PASS');
  for (const result of [
    { packages: null },
    { packages: [], error: 'fixture failure' },
    { packages: [{ package: packageValue, vulnerabilities: {} }] },
    { packages: [{ package: packageValue, vulnerabilities: [{ id: '' }] }] },
  ])
    assert.equal(run(result).state, 'BLOCKED');
  assert.equal(
    run({ packages: [{ package: packageValue, vulnerabilities: [{ id: 'OSV-FIXTURE-1' }] }] }, 1).state,
    'FAIL',
  );
});

function inventory() {
  return {
    npmLock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/fixture': { version: '1.0.0' } } },
    pythonLocks: [`fixture==1.0.0 --hash=sha256:${'a'.repeat(64)}\n`],
    contractLock: {
      openzeppelin: { version: '5.4.0' },
      foundry: { version: '1.5.1', commit: 'b'.repeat(40) },
      solc: { version: '0.8.31' },
    },
    browserPackage: {
      source: 'planning/coverage-toolchain.lock.json#browser.package',
      name: 'playwright-core',
      version: '1.62.1',
      url: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.1.tgz',
      sha256: 'a'.repeat(64),
      bytes: 1,
    },
  };
}

test('inventory refuses duplicate extra sources, invalid byte counts and missing contract pins', () => {
  const value = inventory();
  assert.equal(buildInventory(value).browserEntries, 1);
  for (const bytes of [0, -1, 1.2, '1'])
    assert.throws(
      () => buildInventory({ ...value, browserPackage: { ...value.browserPackage, bytes } }),
      /browser package bytes/,
    );
  const graph = { source: 'fixture-lock.json', lock: value.npmLock };
  assert.throws(() => buildInventory({ ...value, extraNpmLocks: [graph, graph] }), /Duplicate coverage/);
  assert.throws(() => buildInventory({ ...value, extraNpmLocks: [null] }), /Duplicate coverage/);
  for (const field of ['openzeppelin', 'foundry', 'solc']) {
    const changed = structuredClone(value);
    delete changed.contractLock[field];
    assert.throws(() => buildInventory(changed), /Incomplete custom contract/);
  }
  const changed = structuredClone(value);
  delete changed.contractLock.foundry.commit;
  assert.throws(() => buildInventory(changed), /Incomplete custom contract/);
});

test('staging refuses empty or ambiguous coverage and NUL inputs without copying them', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'af-stage-closeout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'),
    destination = join(root, 'scan');
  mkdirSync(source);
  mkdirSync(destination);
  writeFileSync(join(source, 'input.txt'), Buffer.from([65, 0, 66]));
  for (const paths of [[], ['input.txt', 'input.txt'], ['input.txt']])
    assert.throws(() => stageSources(source, destination, paths));
  writeFileSync(join(source, 'input.txt'), 'ordinary text');
  assert.equal(stageSources(source, destination, ['input.txt']).files, 1);
});

test('historical disposition rejects non-date observations while retaining raw findings', () => {
  const value = {
    status: 10,
    report: [
      {
        RuleID: 'generic-api-key',
        Commit: '69330dfffeceb86cf793fa0163ff4f72a466f3eb',
        File: 'docs/product/PHASE1-PRODUCT-WALLET-FLOWS.md',
        StartLine: 12,
        EndLine: 12,
      },
    ],
  };
  const proof = readGitleaksExceptionProof(new URL('../', import.meta.url));
  assert.ok(proof);
  for (const date of [null, '2026-09-23T00:00:00Z', new Date(NaN)]) {
    const result = adjudicateGitleaksHistory(value, proof, date);
    assert.equal(result.state, 'BLOCKED');
    assert.equal(result.raw.state, 'FAIL');
    assert.deepEqual(result.dispositions, []);
  }
});

test('dependency deltas and audit reports refuse missing graphs and contradictory findings', () => {
  for (const [base, head] of [
    [null, {}],
    [{}, null],
    [{ packages: {} }, {}],
  ])
    assert.throws(() => compareLocks(base, head), /Lock package graph/);
  const empty = {
    auditReportVersion: 2,
    metadata: {
      dependencies: { total: 1 },
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    },
    vulnerabilities: {},
  };
  assert.equal(classifyAudit({ status: 0, report: empty }).state, 'PASS');
  for (const counts of [
    { ...empty.metadata.vulnerabilities, total: 1 },
    { ...empty.metadata.vulnerabilities, low: -1 },
  ])
    assert.equal(
      classifyAudit({
        status: 0,
        report: { ...empty, metadata: { ...empty.metadata, vulnerabilities: counts } },
      }).state,
      'BLOCKED',
    );
  assert.equal(classifyAudit({ status: 1, report: empty }).state, 'BLOCKED');
  assert.equal(
    classifyAudit({ status: 0, report: { ...empty, vulnerabilities: { fixture: { severity: 'unknown' } } } })
      .state,
    'BLOCKED',
  );
  for (const event of [{}, { merge_group: {} }])
    assert.throws(() => candidateRefs('merge_group', event, {}), /Missing exact/);
  assert.throws(() => candidateRefs('untrusted-event', {}, {}), /Unsupported event/);
});

test('identity ranges reject malformed inputs and empty protected or worker ranges', () => {
  for (const value of [
    { branch: null, commits: [] },
    { branch: 'feature', commits: null },
    { branch: 'master', commits: [] },
    { branch: 'feature', commits: [], protectedTarget: true },
    { branch: 'macbeth06/fixture', commits: [] },
  ])
    assert.throws(() => validateCommitSetIdentity(value));
  assert.deepEqual(
    validateCommitSetIdentity({ branch: 'feature', commits: [{ subject: null, body: null }] }),
    { skipped: true, verified: 0 },
  );
  assert.deepEqual(
    validateCommitSetIdentity({ branch: 'master', commits: [{ subject: 'ordinary change', body: '' }] }),
    { skipped: false, verified: 0 },
  );
});

test('CI wrapper propagates abnormal process status and failed post-run admission', () => {
  const good = { exitCode: 0, head: 'a', tree: 'b', lockSha256: 'c' };
  for (const status of [null, -1, undefined, NaN])
    assert.equal(verify({ inspect: () => good, run: () => status, emit: () => {} }), 2);
  for (const exitCode of [1, 2]) {
    let index = 0;
    assert.equal(
      verify({ inspect: () => (index++ ? { ...good, exitCode } : good), run: () => 0, emit: () => {} }),
      exitCode,
    );
  }
});
