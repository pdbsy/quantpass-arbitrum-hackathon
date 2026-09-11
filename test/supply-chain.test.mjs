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
  assert.equal(validatePackageLock(lockfile, packageJson, policy).length, 216);
  const first = renderNpmSbom(lockfile, packageJson, policy);
  const second = renderNpmSbom(lockfile, packageJson, policy);
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.spdxVersion, 'SPDX-2.3');
  assert.equal(parsed.packages.length, 217);
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

test('workflow validation rejects mutable Actions and privileged PR targets', () => {
  const valid = `name: Check\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  check:\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n`;
  assert.doesNotThrow(() => validateWorkflowText('valid.yml', valid, policy));
  assert.throws(
    () => validateWorkflowText('floating.yml', valid.replace('a'.repeat(40), 'v7'), policy),
    /unpinned or malformed Action reference/,
  );
  assert.throws(
    () => validateWorkflowText('owner.yml', valid.replace('actions/checkout', 'unknown/action'), policy),
    /unapproved Action owner/,
  );
  assert.throws(
    () => validateWorkflowText('action.yml', valid.replace('actions/checkout', 'actions/cache'), policy),
    /unapproved Action actions\/cache/,
  );
  assert.throws(
    () => validateWorkflowText('target.yml', valid.replace('pull_request:', 'pull_request_target:'), policy),
    /uses pull_request_target/,
  );
});

test('engineering workflow avoids duplicate merge-queue push runs', () => {
  assert.match(engineeringWorkflow, /push:\n\s+branches-ignore:\n\s+- ['"]gh-readonly-queue\/\*\*['"]/);
  assert.match(engineeringWorkflow, /\n {2}merge_group:/);
});
