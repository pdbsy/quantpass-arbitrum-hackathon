import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isMap, parseDocument } from 'yaml';

import { validateWorkflowText } from '../tools/check-supply-chain.mjs';

const ciPath = '.github/workflows/ci.yml';
const policy = JSON.parse(
  await readFile(new URL('../planning/supply-chain-policy.json', import.meta.url), 'utf8'),
);

function assertKeyOnlyName(text) {
  const document = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    merge: false,
    resolveKnownTags: false,
    logLevel: 'silent',
  });
  assert.deepEqual(document.errors, []);
  assert.deepEqual(document.warnings, []);
  assert.ok(isMap(document.contents));
  const pair = document.contents.items[0];
  assert.equal(pair.key.value, 'name');
  // A key-only flow pair has no value node, unlike an explicit YAML null scalar.
  assert.equal(pair.value, null);
}

test('key-only flow mapping reaches the missing workflow events rejection', () => {
  const text = '{name}';
  assertKeyOnlyName(text);
  assert.throws(() => validateWorkflowText(ciPath, text, policy), {
    name: 'Error',
    message: 'Invalid supply-chain state: .github/workflows/ci.yml must declare explicit workflow events',
  });
});

test('valid workflow permits a key-only flow pair with no value node', () => {
  const text = `{
  name,
  on: [pull_request],
  permissions: {contents: read},
  jobs: {
    verify: {
      runs-on: ubuntu-24.04,
      steps: [{run: 'echo AlphaForge'}]
    }
  }
}`;
  assertKeyOnlyName(text);
  assert.doesNotThrow(() => validateWorkflowText(ciPath, text, policy));
});
