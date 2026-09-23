import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInventory, parsePythonLock, scannerTargets } from '../tools/security/inputs.mjs';
import { verifyBytes, selectPlatform } from '../tools/security/bootstrap.mjs';
import { classifySemgrep, classifyOSV, classifyGitleaks } from '../tools/security/results.mjs';
import { stageSources } from '../tools/security/staging.mjs';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
  existsSync,
  readFileSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  adjudicateGitleaksHistory,
  readGitleaksExceptionProof,
} from '../tools/security/gitleaks-disposition.mjs';
import { assertNoSourceIgnore, historyCoverage } from '../tools/ci/check-gitleaks.mjs';
import { fixtureExec } from './helpers/git-fixture.mjs';

test('Gitleaks history qualification rejects a non-repository and detached history without refs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-gitleaks-empty-refs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => historyCoverage(root), /Git history prerequisite failed/);
  const git = (...args) => fixtureExec('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('commit', '-qm', 'Initial fixture');
  git('switch', '--detach', 'HEAD');
  git('branch', '-D', 'main');
  assert.equal(git('for-each-ref'), '');
  assert.equal(git('rev-list', 'HEAD', '--count'), '1');
  assert.throws(() => historyCoverage(root), /Empty Git history coverage/);
});

test('Gitleaks history coverage rejects a real SHA-256 Git object database', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-gitleaks-sha256-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  fixtureExec('git', ['init', '-q', '-b', 'main', '--object-format=sha256'], { cwd: root });
  fixtureExec('git', ['commit', '-qm', 'SHA-256 fixture'], { cwd: root });
  assert.equal(
    fixtureExec('git', ['rev-parse', '--show-object-format'], { cwd: root, encoding: 'utf8' }).trim(),
    'sha256',
  );
  assert.match(
    fixtureExec('git', ['for-each-ref', '--format=%(objectname)'], { cwd: root, encoding: 'utf8' }).trim(),
    /^[a-f0-9]{64}$/,
  );
  assert.throws(() => historyCoverage(root), /Invalid Git reference coverage/);
});

test('Gitleaks source ignore guard refuses every existing root path without disclosing its contents', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'alphaforge-gitleaks-ignore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ignore = join(root, '.gitleaksignore');
  assert.doesNotThrow(() => assertNoSourceIgnore(root));
  for (const value of ['', 'synthetic-finding-fingerprint\n']) {
    writeFileSync(ignore, value);
    assert.throws(
      () => assertNoSourceIgnore(root),
      (error) => {
        assert.match(error.message, /source ignore files are not permitted/);
        assert.doesNotMatch(error.message, /synthetic-finding-fingerprint/);
        return true;
      },
    );
    rmSync(ignore);
  }
  mkdirSync(ignore);
  assert.throws(() => assertNoSourceIgnore(root), /source ignore files are not permitted/);
  rmSync(ignore, { recursive: true });
  if (process.platform !== 'win32') {
    symlinkSync('nonexistent-target', ignore);
    assert.throws(() => assertNoSourceIgnore(root), /source ignore files are not permitted/);
    rmSync(ignore);
  }
  const regular = join(root, 'not-a-directory');
  writeFileSync(regular, 'ordinary file');
  // Windows reports ENOENT for a child of a regular file, unlike POSIX ENOTDIR.
  // Exercise a real non-ENOENT refusal on each host without changing the guard.
  assert.throws(() => lstatSync(join(regular, '.gitleaksignore')), {
    code: process.platform === 'win32' ? 'ENOENT' : 'ENOTDIR',
  });
  const invalidRoot = process.platform === 'win32' ? `${regular}\0` : regular;
  assert.throws(
    () => assertNoSourceIgnore(invalidRoot),
    (error) => {
      assert.match(error.message, /could not be verified/);
      assert.equal(error.cause?.code, process.platform === 'win32' ? 'ERR_INVALID_ARG_VALUE' : 'ENOTDIR');
      return true;
    },
  );
  assert.doesNotThrow(() => assertNoSourceIgnore(root));
});

const pin = (name, version) => `${name}==${version} --hash=sha256:${'a'.repeat(64)}\n`;

test('scanner bootstrap rejects changed bytes and unsupported execution hosts', () => {
  const bytes = Buffer.from('reviewed fixture');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.doesNotThrow(() => verifyBytes(bytes, digest));
  assert.throws(() => verifyBytes(Buffer.from('replacement'), digest));
  assert.throws(() => verifyBytes(bytes, 'not-a-digest'));
  assert.equal(selectPlatform('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(selectPlatform('linux', 'x64'), 'linux-x64');
  assert.throws(() => selectPlatform('darwin', 'x64'));
  assert.throws(() => selectPlatform('win32', 'x64'));
});

test('Python inventory rejects unpinned, unhashed, duplicate and executable requirements', () => {
  assert.deepEqual(parsePythonLock('# qualification\n' + pin('Foo_Bar', '2.0.0')), [
    { ecosystem: 'PyPI', name: 'foo-bar', version: '2.0.0' },
  ]);
  for (const text of [
    '',
    'foo>=2',
    'foo==2.0.0',
    '--extra-index-url https://invalid.test',
    pin('foo', '2') + pin('foo', '3'),
  ])
    assert.throws(() => parsePythonLock(text));
});

test('OSV inventory preserves every ecosystem/version across graphs and maps tool inputs', () => {
  const inventory = buildInventory({
    npmLock: {
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.1.0' },
        'node_modules/a': { version: '1.0.0' },
        'node_modules/x/node_modules/a': { version: '1.0.0' },
        'node_modules/@scope/b': { version: '2.0.0' },
      },
    },
    pythonLocks: [pin('foo', '2.0.0'), pin('foo', '3.0.0')],
    contractLock: {
      openzeppelin: { version: '5.4.0' },
      foundry: { version: '1.5.1', commit: 'b'.repeat(40) },
      solc: { version: '0.8.31' },
    },
  });
  assert.deepEqual(
    inventory.packages.filter((p) => p.ecosystem === 'npm'),
    [
      { ecosystem: 'npm', name: '@foundry-rs/forge-darwin-arm64', version: '1.5.1' },
      { ecosystem: 'npm', name: '@openzeppelin/contracts', version: '5.4.0' },
      { ecosystem: 'npm', name: '@scope/b', version: '2.0.0' },
      { ecosystem: 'npm', name: 'a', version: '1.0.0' },
    ],
  );
  assert.deepEqual(
    inventory.packages.filter((p) => p.ecosystem === 'PyPI'),
    [
      { ecosystem: 'PyPI', name: 'foo', version: '2.0.0' },
      { ecosystem: 'PyPI', name: 'foo', version: '3.0.0' },
    ],
  );
  assert.ok(inventory.packages.some((p) => p.commit === 'b'.repeat(40)));
  assert.equal(inventory.npmEntries, 3);
  assert.equal(inventory.pythonEntries, 2);
  assert.ok(inventory.unmapped.some((p) => p.name === 'solc'));
});

test('OSV inventory cannot silently omit malformed lock entries or an empty graph', () => {
  const base = {
    npmLock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { version: '1.0.0' } } },
    pythonLocks: [pin('foo', '2.0.0')],
    contractLock: {
      openzeppelin: { version: '5.4.0' },
      foundry: { version: '1.5.1', commit: 'b'.repeat(40) },
      solc: { version: '0.8.31' },
    },
  };
  for (const entry of [{}, { version: '*' }, { version: '1.0.0', link: true }]) {
    const bad = structuredClone(base);
    bad.npmLock.packages['node_modules/a'] = entry;
    assert.throws(() => buildInventory(bad));
  }
  assert.throws(() => buildInventory({ ...base, npmLock: { lockfileVersion: 3, packages: {} } }));
  assert.throws(() => buildInventory({ ...base, pythonLocks: [] }));
});

test('OSV inventory includes the exact coverage lock graph and fixed browser package with source counts', () => {
  const coverageLock = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'coverage-fixture', version: '0.0.0' },
      'node_modules/istanbul-lib-instrument': { version: '6.0.3' },
      'node_modules/shared': { version: '1.2.3' },
    },
  };
  const inventory = buildInventory({
    npmLock: {
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.1.0' },
        'node_modules/shared': { version: '1.2.3' },
      },
    },
    extraNpmLocks: [{ source: 'planning/coverage-instrumentation.package-lock.json', lock: coverageLock }],
    browserPackage: {
      source: 'planning/coverage-toolchain.lock.json#browser.package',
      name: 'playwright-core',
      version: '1.62.1',
      url: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.1.tgz',
      sha256: 'a'.repeat(64),
    },
    pythonLocks: [pin('foo', '2.0.0')],
    contractLock: {
      openzeppelin: { version: '5.4.0' },
      foundry: { version: '1.5.1', commit: 'b'.repeat(40) },
      solc: { version: '0.8.31' },
    },
  });
  assert.ok(inventory.packages.some((p) => p.name === 'playwright-core' && p.version === '1.62.1'));
  assert.equal(inventory.extraNpmEntries, 2);
  assert.equal(inventory.browserEntries, 1);
  assert.equal(inventory.sourceCounts['package-lock.json'], 1);
  assert.equal(inventory.sourceCounts['planning/coverage-instrumentation.package-lock.json'], 2);
  assert.deepEqual(inventory.packageSources['npm:shared:1.2.3'].sort(), [
    'package-lock.json',
    'planning/coverage-instrumentation.package-lock.json',
  ]);
  assert.deepEqual(inventory.packageSources['npm:playwright-core:1.62.1'], [
    'planning/coverage-toolchain.lock.json#browser.package',
  ]);
});

test('coverage OSV inputs fail closed for missing, malformed or non-exact extra/browser pins', () => {
  const base = {
    npmLock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { version: '1.0.0' } } },
    pythonLocks: [pin('foo', '2.0.0')],
    contractLock: {
      openzeppelin: { version: '5.4.0' },
      foundry: { version: '1.5.1', commit: 'b'.repeat(40) },
      solc: { version: '0.8.31' },
    },
    extraNpmLocks: [
      {
        source: 'planning/coverage-instrumentation.package-lock.json',
        lock: {
          lockfileVersion: 3,
          packages: { '': {}, 'node_modules/instrumenter': { version: '1.0.0' } },
        },
      },
    ],
    browserPackage: {
      source: 'planning/coverage-toolchain.lock.json#browser.package',
      name: 'playwright-core',
      version: '1.62.1',
      url: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.62.1.tgz',
      sha256: 'a'.repeat(64),
    },
  };
  assert.doesNotThrow(() => buildInventory(base));
  assert.throws(() =>
    buildInventory({ ...base, requireCoverage: true, extraNpmLocks: undefined, browserPackage: undefined }),
  );
  for (const patch of [
    { extraNpmLocks: [] },
    {
      extraNpmLocks: [
        {
          source: 'planning/coverage-instrumentation.package-lock.json',
          lock: { lockfileVersion: 2, packages: {} },
        },
      ],
    },
    {
      extraNpmLocks: [
        {
          source: 'planning/coverage-instrumentation.package-lock.json',
          lock: { lockfileVersion: 3, packages: { 'node_modules/instrumenter': { version: '*' } } },
        },
      ],
    },
    {
      extraNpmLocks: [
        {
          source: 'planning/coverage-instrumentation.package-lock.json',
          lock: { lockfileVersion: 3, packages: { 'node_modules/playwright-core': { version: '1.62.0' } } },
        },
      ],
    },
    { browserPackage: { ...base.browserPackage, version: '1.62.0' } },
    { browserPackage: { ...base.browserPackage, sha256: 'not-a-sha' } },
    { browserPackage: { ...base.browserPackage, url: 'https://registry.npmjs.org/other.tgz' } },
  ])
    assert.throws(() => buildInventory({ ...base, ...patch }));
});

test('Semgrep coverage includes tracked Python and config code but excludes test fixtures and dependency output', () => {
  assert.deepEqual(
    scannerTargets([
      'apps/a.tsx',
      'tools/a.mjs',
      'contracts/script/b.py',
      'eslint.config.mjs',
      'test/fixture.js',
      'contracts/script/tests/test_a.py',
      'apps/node_modules/a.js',
      'apps/dist/a.js',
      'docs/view.js',
    ]),
    ['apps/a.tsx', 'contracts/script/b.py', 'docs/view.js', 'eslint.config.mjs', 'tools/a.mjs'],
  );
  assert.throws(() => scannerTargets(['../escape.py']));
  assert.throws(() => scannerTargets([]));
});

test('Semgrep rejects partial/error results and reports findings without source snippets', () => {
  const ok = {
    status: 0,
    report: { version: '1.177.0', results: [], errors: [], paths: { scanned: ['a.ts', 'b.py'] } },
  };
  assert.equal(classifySemgrep(ok, ['a.ts', 'b.py'], '1.177.0').state, 'PASS');
  const hit = structuredClone(ok);
  hit.status = 1;
  hit.report.results = [
    {
      check_id: 'af.rule',
      path: 'a.ts',
      start: { line: 4 },
      extra: { lines: 'private source', message: 'private source' },
    },
  ];
  const summary = classifySemgrep(hit, ['a.ts', 'b.py'], '1.177.0');
  assert.equal(summary.state, 'FAIL');
  assert.ok(!JSON.stringify(summary).includes('private source'));
  for (const patch of [
    { status: 2 },
    { signal: 'SIGTERM' },
    { report: {} },
    { report: { ...ok.report, errors: [{ type: 'ParseError' }] } },
    { report: { ...ok.report, paths: { scanned: ['a.ts'] } } },
  ])
    assert.equal(classifySemgrep({ ...ok, ...patch }, ['a.ts', 'b.py'], '1.177.0').state, 'BLOCKED');
});

test('OSV reconciles every package including clean dependencies and fails on any advisory', () => {
  const packages = [
    { ecosystem: 'npm', name: 'a', version: '1.0.0' },
    { ecosystem: 'PyPI', name: 'b', version: '2.0.0' },
  ];
  const ok = { status: 0, report: { results: [{ packages: packages.map((p) => ({ package: p })) }] } };
  assert.equal(classifyOSV(ok, packages).state, 'PASS');
  const hit = structuredClone(ok);
  hit.status = 1;
  hit.report.results[0].packages[0].vulnerabilities = [{ id: 'OSV-TEST-1', summary: 'advisory' }];
  assert.equal(classifyOSV(hit, packages).state, 'FAIL');
  for (const patch of [
    { status: 127 },
    { status: 128 },
    { status: 1 },
    { signal: 'SIGTERM' },
    { report: {} },
    { report: { results: [{ packages: [ok.report.results[0].packages[0]] }] } },
    { report: { results: [] } },
  ])
    assert.equal(classifyOSV({ ...ok, ...patch }, packages).state, 'BLOCKED');
});

test('Gitleaks distinguishes scanner errors from findings and never emits secret/email/match fields', () => {
  assert.equal(classifyGitleaks({ status: 0, report: [] }).state, 'PASS');
  const hit = {
    status: 10,
    report: [
      {
        RuleID: 'synthetic-rule',
        File: 'example.txt',
        StartLine: 2,
        Commit: 'b'.repeat(40),
        Secret: 'canary-sensitive-value',
        Match: 'canary-sensitive-value',
        Email: 'private@example.test',
        Fingerprint: 'b'.repeat(40) + ':example.txt:synthetic-rule:2',
      },
    ],
  };
  const summary = classifyGitleaks(hit);
  assert.equal(summary.state, 'FAIL');
  assert.ok(!JSON.stringify(summary).includes('canary-sensitive-value'));
  assert.ok(!JSON.stringify(summary).includes('private@example.test'));
  for (const value of [
    { status: 1, report: [] },
    { status: 10, report: [] },
    { status: 0, report: hit.report },
    { status: 0, report: {} },
    { status: 0, report: [], signal: 'SIGTERM' },
  ])
    assert.equal(classifyGitleaks(value).state, 'BLOCKED');
});

test('scanner staging rejects missing, symlink and escaped sources instead of skipping files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-scanner-stage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'),
    target = join(dir, 'target');
  mkdirSync(source);
  mkdirSync(target);
  writeFileSync(join(source, 'ok.py'), 'value = 1\n');
  assert.equal(stageSources(source, target, ['ok.py']).files, 1);
  assert.throws(() => stageSources(source, target, ['missing.py']));
  assert.throws(() => stageSources(source, target, ['../escaped.py']));
  if (process.platform !== 'win32') {
    symlinkSync(join(source, 'ok.py'), join(source, 'link.py'));
    assert.throws(() => stageSources(source, target, ['link.py']));
  }
});

test('Gitleaks history coverage includes deleted files and side refs, rejects shallow repositories', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const exec = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  exec('init', '-b', 'main');
  writeFileSync(join(dir, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(dir, 'old.txt'), 'initial\n');
  exec('add', '.');
  exec('commit', '-m', 'initial');
  exec('tag', 'retained');
  exec('switch', '-c', 'side');
  writeFileSync(join(dir, 'side.txt'), 'side\n');
  exec('add', '.');
  exec('commit', '-m', 'side');
  exec('switch', 'main');
  exec('rm', 'old.txt');
  exec('commit', '-m', 'delete');
  const report = historyCoverage(dir);
  assert.equal(report.commits, 3);
  assert.ok(report.refs.some((r) => r.name === 'refs/heads/side'));
  assert.ok(report.refs.some((r) => r.name === 'refs/tags/retained'));
  writeFileSync(join(dir, '.git', 'shallow'), exec('rev-parse', 'HEAD') + '\n');
  assert.throws(() => historyCoverage(dir));
});

// Hand-checked immutable provenance evidence; no credential or blanket hash allowance.
const approvedFinding = {
  RuleID: 'generic-api-key',
  File: 'docs/product/PHASE1-PRODUCT-WALLET-FLOWS.md',
  StartLine: 12,
  EndLine: 12,
  Commit: '69330dfffeceb86cf793fa0163ff4f72a466f3eb',
  Secret: 'REDACTED',
  Match: 'REDACTED',
  Email: 'must-not-be-emitted@example.test',
};
function realExceptionProof() {
  const read = (...args) => execFileSync('git', ['--no-replace-objects', ...args]);
  return {
    historicalCommit: read('cat-file', 'commit', '69330dfffeceb86cf793fa0163ff4f72a466f3eb'),
    blobOid: read(
      'rev-parse',
      '69330dfffeceb86cf793fa0163ff4f72a466f3eb:docs/product/PHASE1-PRODUCT-WALLET-FLOWS.md',
    )
      .toString()
      .trim(),
    blob: read('cat-file', 'blob', 'b118b774535825efd5d7afe8931e134827f4f974'),
    sourceCommit: read('cat-file', 'commit', '28ff3d4b5c6e70ff0c6ea1b11ad0fea4283887fd'),
    tree: read('cat-file', 'tree', '7f4abc27757e099c1b5b26a66509395015bdb7b7'),
  };
}
const dispositionTime = new Date('2026-09-20T12:00:00Z');

test('one approved historical tree finding passes only through an auditable disposition, retaining raw FAIL', () => {
  const value = { status: 10, report: [approvedFinding] };
  const before = JSON.stringify(value);
  const result = adjudicateGitleaksHistory(value, realExceptionProof(), dispositionTime);
  assert.equal(result.state, 'PASS');
  assert.equal(result.raw.state, 'FAIL');
  assert.equal(result.raw.findings.length, 1);
  assert.equal(result.dispositions.length, 1);
  assert.equal(result.dispositions[0].id, 'GITLEAKS-FP-001');
  assert.equal(result.dispositions[0].proof, 'VERIFIED');
  assert.equal(JSON.stringify(value), before);
  assert.ok(!JSON.stringify(result).includes('must-not-be-emitted'));
  assert.ok(!JSON.stringify(result).includes('REDACTED'));
});

test('changed finding identity, multiline finding, duplicates and additional findings remain blocking', () => {
  const proof = realExceptionProof();
  for (const patch of [
    { RuleID: 'github-pat' },
    { File: 'different.md' },
    { StartLine: 13 },
    { EndLine: 13 },
    { EndLine: undefined },
    { Commit: 'a'.repeat(40) },
    { Commit: '' },
  ]) {
    const result = adjudicateGitleaksHistory(
      { status: 10, report: [{ ...approvedFinding, ...patch }] },
      proof,
      dispositionTime,
    );
    assert.equal(result.state, 'FAIL');
    assert.deepEqual(result.dispositions, []);
  }
  for (const extra of [approvedFinding, { ...approvedFinding, File: 'another.txt' }]) {
    const result = adjudicateGitleaksHistory(
      { status: 10, report: [approvedFinding, extra] },
      proof,
      dispositionTime,
    );
    assert.equal(result.state, 'FAIL');
    assert.deepEqual(result.dispositions, []);
    assert.equal(result.raw.findings.length, 2);
  }
});

test('missing and altered immutable objects cannot substantiate the authorized exception', () => {
  const proof = realExceptionProof();
  for (const field of Object.keys(proof)) {
    for (const bad of [undefined, field === 'blobOid' ? 'c'.repeat(40) : Buffer.from('altered object\n')]) {
      const result = adjudicateGitleaksHistory(
        { status: 10, report: [approvedFinding] },
        { ...proof, [field]: bad },
        dispositionTime,
      );
      assert.equal(result.state, 'BLOCKED', field);
      assert.equal(result.raw.state, 'FAIL');
      assert.deepEqual(result.dispositions, []);
    }
  }
});

test('scanner errors, missing reports and inconsistent finding exits cannot use a disposition', () => {
  const proof = realExceptionProof();
  for (const patch of [
    { status: 0 },
    { status: 1 },
    { status: null },
    { signal: 'SIGTERM' },
    { error: new Error('sensitive detail') },
    { report: null },
    { report: {} },
    { report: [{ ...approvedFinding, StartLine: '12' }] },
  ]) {
    const result = adjudicateGitleaksHistory(
      { status: 10, report: [approvedFinding], ...patch },
      proof,
      dispositionTime,
    );
    assert.equal(result.state, 'BLOCKED');
    assert.deepEqual(result.dispositions, []);
    assert.ok(!JSON.stringify(result).includes('sensitive detail'));
  }
  assert.equal(adjudicateGitleaksHistory({ status: 0, report: [] }, null, dispositionTime).state, 'PASS');
});

test('expired, premature or invalid exception time fails closed without changing a clean scan', () => {
  for (const time of [
    new Date('2026-10-20T00:00:00Z'),
    new Date('2026-09-19T23:59:59Z'),
    new Date('invalid'),
  ]) {
    const result = adjudicateGitleaksHistory(
      { status: 10, report: [approvedFinding] },
      realExceptionProof(),
      time,
    );
    assert.equal(result.state, 'BLOCKED');
    assert.deepEqual(result.dispositions, []);
  }
});

test('the production proof reader uses actual Git objects and missing history remains blocked', (t) => {
  assert.deepEqual(readGitleaksExceptionProof(process.cwd()), realExceptionProof());
  const dir = mkdtempSync(join(tmpdir(), 'af-gitleaks-missing-proof-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const proof = readGitleaksExceptionProof(dir);
  assert.equal(proof, null);
  assert.equal(
    adjudicateGitleaksHistory({ status: 10, report: [approvedFinding] }, proof, dispositionTime).state,
    'BLOCKED',
  );
});

test('artifact downloader validates cached bytes and refuses unqualified locations before network access', async (t) => {
  const { downloadArtifact } = await import('../tools/security/bootstrap.mjs');
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-scanner-artifact-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const cache = join(parent, 'cache');
  mkdirSync(cache);
  const bytes = Buffer.from('reviewed local artifact fixture');
  const artifact = {
    url: 'https://github.com/example/releases/artifact',
    filename: 'scanner.bin',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw Error('Unexpected network request');
  });
  writeFileSync(join(cache, artifact.filename), bytes);
  assert.equal(await downloadArtifact(artifact, cache), join(cache, artifact.filename));
  for (const patch of [
    { url: 'http://github.com/example/file' },
    { url: 'https://user@github.com/example/file' },
    { url: 'https://user:pass@github.com/example/file' },
    { url: 'https://github.com/example/file?version=1' },
    { url: 'https://github.com/example/file#hash' },
    { url: 'https://unqualified.example.test/file' },
    { filename: '../scanner.bin' },
    { filename: 'directory\\scanner.bin' },
  ])
    await assert.rejects(downloadArtifact({ ...artifact, ...patch }, cache), /Unqualified/);
  await assert.rejects(downloadArtifact({ ...artifact, sha256: '0'.repeat(64) }, cache), /SHA-256/);
  const linked = join(parent, 'linked');
  symlinkSync(cache, linked);
  await assert.rejects(downloadArtifact(artifact, linked), /symlinks/);
  rmSync(join(cache, artifact.filename));
  symlinkSync(join(parent, 'target'), join(cache, artifact.filename));
  writeFileSync(join(parent, 'target'), bytes);
  await assert.rejects(downloadArtifact(artifact, cache), /Invalid cached/);
  assert.equal(calls, 0);
});

test('artifact download stream enforces origin, size and hash before atomically installing', async (t) => {
  const { downloadArtifact } = await import('../tools/security/bootstrap.mjs');
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-scanner-stream-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const bytes = Buffer.from('complete verified fixture');
  const artifact = {
    url: 'https://github.com/example/releases/artifact',
    filename: 'scanner.bin',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  let response;
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const bad of [
    { ok: false, url: artifact.url },
    { ok: true, url: 'https://unqualified.example.test/file' },
  ]) {
    response = bad;
    await assert.rejects(downloadArtifact(artifact, parent), /unavailable/);
  }
  response = {
    ok: true,
    url: artifact.url,
    body: (async function* () {
      yield Buffer.from('changed');
    })(),
  };
  await assert.rejects(downloadArtifact(artifact, parent), /SHA-256/);
  assert.equal(existsSync(join(parent, artifact.filename)), false);
  response = {
    ok: true,
    url: artifact.url,
    body: (async function* () {
      const chunk = Buffer.alloc(1024 * 1024);
      for (let n = 0; n < 181; n++) yield chunk;
    })(),
  };
  await assert.rejects(downloadArtifact(artifact, parent), /size limit/);
  assert.equal(existsSync(join(parent, artifact.filename)), false);
  response = {
    ok: true,
    url: 'https://release-assets.githubusercontent.com/fixture',
    body: (async function* () {
      yield bytes.subarray(0, 8);
      yield bytes.subarray(8);
    })(),
  };
  const result = await downloadArtifact(artifact, parent);
  assert.deepEqual(readFileSync(result), bytes);
  assert.equal(
    readdirSync(parent).some((name) => name.endsWith('.tmp')),
    false,
  );
});
