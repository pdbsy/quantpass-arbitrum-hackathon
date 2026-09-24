import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { collectBrowserCoverage, shouldTransformBrowserPath } from '../tools/coverage/browser.mjs';
import { replayBrowserCoverage } from '../tools/coverage/browser-evidence.mjs';

const root = process.env.AF_QUALIFIED_BROWSER_CANDIDATE;
const prepared = process.env.AF_QUALIFIED_BROWSER_PREPARED;
const outputDirectory = process.env.AF_QUALIFIED_BROWSER_OUTPUT;
assert.ok(root && prepared && outputDirectory, 'fixed qualified candidate and output paths required');
const manifest = JSON.parse(readFileSync(resolve(prepared, 'manifest.json')));
const generated = JSON.parse(readFileSync(resolve(prepared, 'generated.json')));
const require = createRequire(resolve(process.env.AF_QUALIFIED_COVERAGE_TOOLS, '__qualified_entry__.cjs'));
const parser = require('@babel/parser');
const { chromium } = await import(
  pathToFileURL(resolve(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs')).href
);

function assertSameIntervals(actual, expected) {
  assert.equal(actual.length, expected.length, 'browser interval count differs');
  const actualIds = actual.map((row) => row.id);
  const expectedById = new Map(expected.map((row) => [row.id, row]));
  assert.equal(new Set(actualIds).size, actual.length, 'duplicate replay interval');
  assert.equal(expectedById.size, expected.length, 'duplicate live interval');
  assert.deepEqual([...actualIds].sort(), [...expectedById.keys()].sort(), 'browser interval IDs differ');
  // Multiple pages finish independently. Identity and every recorded field,
  // including the original sequence, maps and counters, must still agree.
  for (const row of actual) assert.deepEqual(row, expectedById.get(row.id));
}

test('interval equality permits completion order but rejects lost, duplicate or changed evidence', () => {
  const first = { id: 'first', sequence: 0, complete: true, sources: { fixture: { s: { 0: 1 } } } };
  const second = { id: 'second', sequence: 1, complete: true, sources: { fixture: { s: { 0: 2 } } } };
  assertSameIntervals([second, first], [first, second]);
  assert.throws(() => assertSameIntervals([first], [first, second]));
  assert.throws(() => assertSameIntervals([first, first], [first, second]));
  assert.throws(() => assertSameIntervals([first, second], [first, first]));
  assert.throws(() => assertSameIntervals([first, { ...second, id: 'other' }], [first, second]));
  for (const patch of [{ sequence: 0 }, { complete: false }, { sources: { fixture: { s: { 0: 3 } } } }])
    assert.throws(() => assertSameIntervals([first, { ...second, ...patch }], [first, second]));
});

test('local Vite dependency paths stay third-party while first-party paths remain eligible', () => {
  assert.equal(shouldTransformBrowserPath('node_modules/vite/dist/client/client.mjs'), false);
  assert.equal(shouldTransformBrowserPath('packages/node_modules/helper/index.mjs'), false);
  assert.equal(shouldTransformBrowserPath('apps/web/src/product-ui.ts'), true);
  assert.equal(shouldTransformBrowserPath('tools/verify-m3-browser.mjs'), true);
  assert.equal(shouldTransformBrowserPath('apps/web/index.html'), false);
});

test('actual instrumented M3 workflow retains canonical prototype and original TS browser graphs', async () => {
  const result = await collectBrowserCoverage({
    root,
    manifest,
    generated,
    tools: { chromium, parser },
    outputDirectory,
    executablePath: process.env.CHROMIUM_PATH,
    port: 0,
  });
  assert.equal(result.workflowResult.state, 'PASS');
  assert.equal(result.workflowResult.walletSends.length, 9);
  const replay = replayBrowserCoverage({ manifest, outputDirectory: result.directory, index: result.index });
  assertSameIntervals(replay.observations, result.observations);
  assert.ok(result.observations.every((row) => row.complete));
  const completed = result.observations.find(
    (row) => row.sources['apps/web/src/product-ui.ts'] && row.sources['tools/verify-m3-browser.mjs'],
  );
  assert.ok(completed);
  const prototype = completed.sources['apps/web/prototype/AlphaForge_v3_EN.html'].coverage;
  assert.deepEqual(prototype.statementMap, manifest.sources[prototype.path].coverage.statementMap);
  assert.ok(Object.values(prototype.f).some((count) => count > 0));
  const driver = completed.sources['tools/verify-m3-browser.mjs'].coverage;
  assert.ok(
    Object.values(driver.f).some((count) => count > 0),
    'real transported driver callbacks must execute',
  );
});
