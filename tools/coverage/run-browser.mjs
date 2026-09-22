import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyPrepared } from './prepare.mjs';
import { collectBrowserCoverage } from './browser.mjs';
import { collectLegacyBrowserCoverage } from './browser-legacy.mjs';
import { sha256 } from './toolchain.mjs';
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = {
    '--tools': 'instrumentationDirectory',
    '--browser-tools': 'browserDirectory',
    '--chrome': 'executablePath',
    '--base': 'sourceBase',
    '--workflow': 'workflow',
  }[args[i]];
  assert.ok(key && args[i + 1] && !Object.hasOwn(options, key));
  options[key] = args[i + 1];
}
assert.ok(options.browserDirectory && options.executablePath && options.sourceBase);
assert.ok(!options.workflow || ['m3', 'legacy', 'management'].includes(options.workflow));
const root = resolve(import.meta.dirname, '../..');
const prepared = process.env.AF_COVERAGE_PREPARED;
const output = resolve(process.env.AF_COVERAGE_RAW, '..');
const { manifest, generated, tools } = await verifyPrepared(root, prepared, options);
const browserRuntime = {
  sha256: sha256(readFileSync(options.executablePath)),
  version: execFileSync(options.executablePath, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim(),
};
let receipt;
try {
  const result =
    options.workflow && options.workflow !== 'm3'
      ? await collectLegacyBrowserCoverage({
          root,
          manifest,
          generated,
          tools,
          outputDirectory: resolve(output, 'browser', options.workflow),
          executablePath: options.executablePath,
          browserPath: resolve(options.browserDirectory, 'index.mjs'),
          workflow: options.workflow,
          nodeHook: resolve(output, 'node-hook.mjs'),
        })
      : await collectBrowserCoverage({
          root,
          manifest,
          generated,
          tools,
          outputDirectory: resolve(output, 'browser'),
          executablePath: options.executablePath,
        });
  const state = options.workflow && options.workflow !== 'm3' ? result.status : result.workflowResult.state;
  assert.ok(['PASS', 'FAIL'].includes(state));
  process.exitCode = state === 'PASS' ? 0 : 1;
  receipt = {
    schemaVersion: 1,
    provider: 'LOCAL',
    state,
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    manifestSha256: sha256(readFileSync(resolve(prepared, 'manifest.json'))),
    directory: result.directory,
    ...(result.nodeChild ? { nodeChild: result.nodeChild } : {}),
    index: options.workflow && options.workflow !== 'm3' ? result.collection?.index : result.index,
    browserRuntime,
    ...(options.workflow && options.workflow !== 'm3'
      ? { driver: result.driver, intervals: result.collection?.observations.length }
      : { checks: result.workflowResult.checks }),
    workflow: options.workflow || 'm3',
  };
} catch (error) {
  receipt = {
    schemaVersion: 1,
    provider: 'LOCAL',
    state: 'FAIL',
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    manifestSha256: sha256(readFileSync(resolve(prepared, 'manifest.json'))),
    workflow: options.workflow || 'm3',
    directory: error.browserCoverage?.directory,
    index: error.browserCoverage?.index,
    failure: error.browserCoverage?.failure,
    browserRuntime,
    error: error.message,
  };
  process.exitCode = 1;
}
writeFileSync(resolve(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
  flag: 'wx',
});
