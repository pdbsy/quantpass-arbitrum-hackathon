import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  renderNpmSbom,
  validatePackageLock,
  validateSupplyChainPolicy,
  validateWorkflowText,
} from '../tools/check-supply-chain.mjs';

const policy = JSON.parse(
  await readFile(new URL('../planning/supply-chain-policy.json', import.meta.url), 'utf8'),
);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));

const engineeringWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('supply-chain policy and npm lock are closed and produce deterministic SPDX', () => {
  assert.equal(validateSupplyChainPolicy(policy), policy);
  const locked = validatePackageLock(lockfile, packageJson, policy);
  assert.deepEqual(
    locked.map((item) => item.path).sort(),
    Object.keys(lockfile.packages).filter(Boolean).sort(),
  );
  const first = renderNpmSbom(lockfile, packageJson, policy);
  const second = renderNpmSbom(lockfile, packageJson, policy);
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.spdxVersion, 'SPDX-2.3');
  assert.equal(parsed.packages.length, locked.length + 1);
  assert.match(parsed.documentNamespace, /\/sbom\/[0-9a-f]{64}$/);
});

test('npm lock validation rejects source, integrity, license and version drift', () => {
  const firstPath = Object.keys(lockfile.packages).find((path) => path !== '');
  const cases = [
    ['registry substitution', (item) => (item.packages[firstPath].resolved = 'https://example.com/x.tgz')],
    ['missing integrity', (item) => delete item.packages[firstPath].integrity],
    ['weak integrity', (item) => (item.packages[firstPath].integrity = 'sha1-ZmFrZQ==')],
    ['disallowed license', (item) => (item.packages[firstPath].license = 'GPL-3.0-only')],
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(lockfile);
    mutate(candidate);
    assert.throws(
      () => validatePackageLock(candidate, packageJson, policy),
      /Invalid supply-chain state/,
      `${name} must fail closed`,
    );
  }
  const floatingPackage = structuredClone(packageJson);
  const floatingLock = structuredClone(lockfile);
  floatingPackage.dependencies.fastify = '^5.12.3';
  floatingLock.packages[''].dependencies.fastify = '^5.12.3';
  assert.throws(
    () => validatePackageLock(floatingLock, floatingPackage, policy),
    /root dependency fastify must use an exact semantic version/,
  );
});

const ciPath = '.github/workflows/ci.yml';
const actionPin = 'a'.repeat(40);
const valid = `name: Check\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${actionPin}\n`;

test('workflow validation rejects mutable Actions and privileged PR targets', () => {
  assert.doesNotThrow(() => validateWorkflowText(ciPath, valid, policy));
  assert.throws(
    () => validateWorkflowText(ciPath, valid.replace(actionPin, 'v7'), policy),
    /unpinned or malformed Action reference/,
  );
  assert.throws(
    () => validateWorkflowText(ciPath, valid.replace('actions/checkout', 'unknown/action'), policy),
    /unapproved Action owner/,
  );
  assert.throws(
    () => validateWorkflowText(ciPath, valid.replace('actions/checkout', 'actions/cache'), policy),
    /unapproved Action actions\/cache/,
  );
  assert.throws(
    () => validateWorkflowText(ciPath, valid.replace('pull_request:', 'pull_request_target:'), policy),
    /uses pull_request_target/,
  );
});

for (const [name, events] of [
  ['double-quoted', 'on:\n  "pull_request_target":'],
  ['single-quoted', "on:\n  'pull_request_target':"],
  ['escaped', 'on:\n  "pull_request_\\u0074arget":'],
  ['flow map', 'on: {pull_request_target: null}'],
  ['flow sequence', 'on: [push, pull_request_target]'],
  ['scalar', 'on: pull_request_target'],
]) {
  test(`workflow rejects privileged event in ${name} form`, () => {
    const candidate = valid.replace('on:\n  pull_request:', events);
    assert.throws(() => validateWorkflowText(ciPath, candidate, policy), /Invalid supply-chain state/);
  });
}

for (const [name, action] of [
  ['double-quoted key', '"uses": actions/checkout@v7'],
  ['single-quoted key', "'uses': untrusted/action@v1"],
  ['escaped key', '"u\\u0073es": actions/checkout@v7'],
  ['flow mapping', '{uses: actions/checkout@v7}'],
  ['local action', 'uses: ./actions/local'],
  ['container action', 'uses: docker://alpine:latest'],
  ['expression', 'uses: ${{ matrix.action }}'],
]) {
  test(`workflow rejects unapproved Action in ${name}`, () => {
    const candidate = valid.replace(`uses: actions/checkout@${actionPin}`, action);
    assert.throws(() => validateWorkflowText(ciPath, candidate, policy), /Invalid supply-chain state/);
  });
}

for (const [name, candidate] of [
  ['workflow contents write', valid.replace('contents: read', 'contents: write')],
  ['job contents write', valid.replace('    steps:', '    permissions: {contents: write}\n    steps:')],
  [
    'quoted job OIDC write',
    valid.replace('    steps:', '    "permissions": {"id-token": write}\n    steps:'),
  ],
  ['workflow write-all', valid.replace('permissions:\n  contents: read', 'permissions: write-all')],
  ['workflow read-all', valid.replace('permissions:\n  contents: read', 'permissions: read-all')],
  ['job write-all', valid.replace('    steps:', '    permissions: write-all\n    steps:')],
  [
    'CodeQL exception in CI',
    valid.replace('    steps:', '    permissions: {security-events: write}\n    steps:'),
  ],
  ['unknown scope', valid.replace('contents: read', 'future-scope: read')],
  ['unknown job', valid.replace('  verify:', '  upload:')],
]) {
  test(`workflow permission ceiling rejects ${name}`, () => {
    assert.throws(() => validateWorkflowText(ciPath, candidate, policy), /Invalid supply-chain state/);
  });
}

for (const [name, candidate] of [
  ['duplicate event key', valid.replace('  pull_request:', '  pull_request:\n  "pull_request":')],
  [
    'duplicate uses key',
    valid.replace(
      `uses: actions/checkout@${actionPin}`,
      `uses: actions/checkout@${actionPin}\n        "uses": actions/checkout@v7`,
    ),
  ],
  [
    'alias',
    valid
      .replace('  contents: read', '  contents: &access read')
      .replace('    steps:', '    permissions: {contents: *access}\n    steps:'),
  ],
  ['merge key', valid.replace('  contents: read', '  <<: {contents: write}\n  contents: read')],
  ['explicit tag', valid.replace('  contents: read', '  contents: !!str read')],
  ['multiple documents', valid + '\n---\non: pull_request_target\n'],
  ['YAML directive', '%YAML 1.1\n---\n' + valid],
  ['non-string key', valid.replace('  contents: read', '  true: read')],
  ['invalid YAML', valid + 'broken: [\n'],
  [
    'nested reusable job',
    valid.replace(`    steps:\n      - uses: actions/checkout@${actionPin}\n`, '    uses: ./reusable.yml\n'),
  ],
]) {
  test(`workflow fails closed on ${name}`, () => {
    assert.throws(() => validateWorkflowText(ciPath, candidate, policy), /Invalid supply-chain state/);
  });
}

test('workflow validation preserves checked-in workflows and equivalent safe YAML', async () => {
  for (const name of ['ci.yml', 'codeql.yml', 'dependency-review.yml']) {
    const text = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => validateWorkflowText(`.github/workflows/${name}`, text, policy));
  }
  const model = {
    name: 'Safe quoted/flow YAML',
    on: ['push', 'pull_request'],
    permissions: { contents: 'read' },
    jobs: {
      verify: {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: `actions/checkout@${actionPin}` },
          { run: 'echo "uses: untrusted/action@v1; permissions: write-all; pull_request_target:"' },
        ],
      },
    },
  };
  assert.doesNotThrow(() => validateWorkflowText(ciPath, JSON.stringify(model), policy));
  assert.doesNotThrow(() =>
    validateWorkflowText(ciPath, valid.replace('contents: read', 'contents: none'), policy),
  );
  assert.doesNotThrow(() =>
    validateWorkflowText(ciPath, valid.replace('    steps:', '    permissions: {}\n    steps:'), policy),
  );
  assert.throws(
    () => validateWorkflowText('.github/workflows/new.yml', valid, policy),
    /Invalid supply-chain state/,
  );
});

test('CodeQL write permission cannot move to workflow or unapproved jobs', async () => {
  const path = '.github/workflows/codeql.yml';
  const text = await readFile(new URL('../.github/workflows/codeql.yml', import.meta.url), 'utf8');
  assert.throws(
    () =>
      validateWorkflowText(
        path,
        text.replace(
          'permissions:\n  contents: read',
          'permissions:\n  contents: read\n  security-events: write',
        ),
        policy,
      ),
    /Invalid supply-chain state/,
  );
  assert.throws(
    () => validateWorkflowText(path, text.replace('  analyze:', '  other:'), policy),
    /Invalid supply-chain state/,
  );
  assert.throws(
    () => validateWorkflowText(path, text.replace('      packages: read', '      packages: write'), policy),
    /Invalid supply-chain state/,
  );
});

test('offline governance policy cannot self-certify external verification', () => {
  assert.doesNotThrow(() => validateSupplyChainPolicy(policy));
  for (const evidence of [
    [],
    ['provider', 'enforced'],
    [
      { provider: 'github-app', revision: 'a'.repeat(40) },
      { enforced: true, tamperTest: 'passed' },
    ],
  ]) {
    const candidate = structuredClone(policy);
    candidate.externalGovernanceGate.status = 'verified';
    candidate.externalGovernanceGate.evidence = evidence;
    assert.throws(() => validateSupplyChainPolicy(candidate), /Invalid supply-chain state/);
  }
  for (const evidence of ['', { length: 0 }, ['fake']]) {
    const candidate = structuredClone(policy);
    candidate.externalGovernanceGate.evidence = evidence;
    assert.throws(() => validateSupplyChainPolicy(candidate), /Invalid supply-chain state/);
  }
});

test('npm PURLs preserve scoped namespace separators', () => {
  const sbom = JSON.parse(renderNpmSbom(lockfile, packageJson, policy));
  const scoped = sbom.packages.find((item) => item.name === '@types/node');
  assert.equal(scoped.externalRefs[0].referenceLocator, 'pkg:npm/%40types/node@24.13.3');
  const unscoped = sbom.packages.find((item) => item.name === 'fastify');
  assert.equal(unscoped.externalRefs[0].referenceLocator, 'pkg:npm/fastify@5.12.3');
});

test('engineering workflow avoids duplicate merge-queue push runs', () => {
  assert.match(engineeringWorkflow, /push:\n\s+branches-ignore:\n\s+- ['"]gh-readonly-queue\/\*\*['"]/);
  assert.match(engineeringWorkflow, /\n {2}merge_group:/);
});

test('root engine metadata and supported native read-only jobs are enforced', () => {
  const drift = structuredClone(lockfile);
  drift.packages[''].engines = { node: '0.0.0', npm: '0.0.0' };
  assert.throws(() => validatePackageLock(drift, packageJson, policy), /engines/);
  for (const name of ['verify-macos']) {
    assert.doesNotThrow(() => validateWorkflowText(ciPath, valid.replace('  verify:', `  ${name}:`), policy));
    assert.throws(
      () =>
        validateWorkflowText(
          ciPath,
          valid.replace('  verify:', `  ${name}:\n    permissions: {contents: write}`),
          policy,
        ),
      /permission/,
    );
  }
});

test('removed Intel macOS job is outside the reviewed workflow profile', () => {
  assert.throws(
    () => validateWorkflowText(ciPath, valid.replace('  verify:', '  verify-macos-intel:'), policy),
    /unknown job|unapproved job/,
  );
});
