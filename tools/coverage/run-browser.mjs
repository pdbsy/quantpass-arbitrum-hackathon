import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyPrepared } from './prepare.mjs';
import { collectBrowserCoverage } from './browser.mjs';
import { sha256 } from './toolchain.mjs';
const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = {
    '--tools': 'instrumentationDirectory',
    '--browser-tools': 'browserDirectory',
    '--chrome': 'executablePath',
    '--base': 'sourceBase',
  }[args[i]];
  assert.ok(key && args[i + 1] && !Object.hasOwn(options, key));
  options[key] = args[i + 1];
}
assert.ok(options.browserDirectory && options.executablePath && options.sourceBase);
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
  const result = await collectBrowserCoverage({
    root,
    manifest,
    generated,
    tools,
    outputDirectory: resolve(output, 'browser'),
    executablePath: options.executablePath,
  });
  assert.equal(result.workflowResult.state, 'PASS');
  receipt = {
    schemaVersion: 1,
    provider: 'LOCAL',
    state: 'PASS',
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    manifestSha256: sha256(readFileSync(resolve(prepared, 'manifest.json'))),
    directory: result.directory,
    index: result.index,
    browserRuntime,
    checks: result.workflowResult.checks,
  };
} catch (error) {
  receipt = {
    schemaVersion: 1,
    provider: 'LOCAL',
    state: 'FAIL',
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    directory: error.browserCoverage?.directory,
    index: error.browserCoverage?.index,
    browserRuntime,
    error: error.message,
  };
  process.exitCode = 1;
}
writeFileSync(resolve(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
  flag: 'wx',
});
