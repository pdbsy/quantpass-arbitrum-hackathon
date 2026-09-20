import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInventory, parsePythonLock, scannerTargets } from '../tools/security/inputs.mjs';
import { verifyBytes, selectPlatform } from '../tools/security/bootstrap.mjs';
import { classifySemgrep, classifyOSV, classifyGitleaks } from '../tools/security/results.mjs';
import { stageSources } from '../tools/security/staging.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { historyCoverage } from '../tools/ci/check-gitleaks.mjs';

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
