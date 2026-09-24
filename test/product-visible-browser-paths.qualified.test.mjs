import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const expectedChecks = [
  'Prototype Home, Market, and Rankings filters expose selected, empty, reset, and comparison states',
  'Prototype Forum and Account flows preserve bookmarks, drafts, local notes, replies, deletion, and profile edits',
  'Product API and prototype trial controls expose zero or missing-operation errors, cancel, allocation, release, and withdrawal states',
  'Prototype Pass trading exposes chart controls, asset context, invalid input, reviewed buy and sell receipts, and account readback',
];

// The complete driver includes a genuine server Retry-After wait (60s).
// Keep its child within the existing coverage driver's 300s budget; the parent
// gets 15s to process the result. This does not alter fixed product/security timeouts.
test('legacy product driver records the visible prototype interaction contract', { timeout: 315_000 }, () => {
  const browserModule = process.env.AF_PLAYWRIGHT_PATH;
  const executablePath = process.env.CHROMIUM_PATH;
  const port = process.env.AF_BROWSER_PORT;
  assert.ok(browserModule, 'AF_PLAYWRIGHT_PATH is required; never silently skip');
  assert.ok(executablePath, 'CHROMIUM_PATH is required; never silently skip');
  assert.ok(port, 'AF_BROWSER_PORT is required; never silently select a shared port');

  const child = spawnSync(process.execPath, ['tools/verify-ui-browser.mjs'], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      AF_PLAYWRIGHT_PATH: browserModule,
      CHROMIUM_PATH: executablePath,
      AF_BROWSER_PORT: port,
    },
    encoding: 'utf8',
    timeout: 300_000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, `driver signal: ${child.signal}\n${child.stderr}`);
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);

  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 'PASSED');
  for (const check of expectedChecks) assert.ok(result.checks.includes(check), check);

  const receipt = JSON.parse(readFileSync(resolve(result.evidence, 'result.json'), 'utf8'));
  assert.deepEqual(receipt, { status: 'PASSED', checks: result.checks });
});
