import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { prepareCoverage } from './prepare.mjs';
import { collectNodeWorkflow } from './collect.mjs';
import { reportCoverage } from './report.mjs';
import { npmCli } from '../environment/observe.mjs';
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = {
    '--tools': 'instrumentationDirectory',
    '--base': 'sourceBase',
    '--prepared': 'preparedDirectory',
    '--browser-tools': 'browserDirectory',
    '--chrome': 'executablePath',
  }[args[i]];
  assert.ok(key && args[i + 1] && !Object.hasOwn(options, key), 'invalid coverage run arguments');
  options[key] = args[i + 1];
}
assert.ok(options.sourceBase, 'explicit --base required');
const prepared = options.preparedDirectory
  ? { directory: resolve(options.preparedDirectory) }
  : await prepareCoverage(root, options);
const configuration = { id: 'npm-check', args: [npmCli(), 'run', 'check'] };
const collected = await collectNodeWorkflow(root, prepared.directory, {
  ...options,
  ...configuration,
  timeoutMs: 1200000,
});
const workflows = [{ ...configuration, directory: collected.directory }];
if (options.browserDirectory) {
  assert.ok(options.executablePath, 'explicit browser executable required');
  const browserConfiguration = {
    id: 'm3-browser',
    args: [
      'tools/coverage/run-browser.mjs',
      '--tools',
      options.instrumentationDirectory,
      '--browser-tools',
      options.browserDirectory,
      '--chrome',
      options.executablePath,
      '--base',
      options.sourceBase,
    ],
  };
  const browserRun = await collectNodeWorkflow(root, prepared.directory, {
    ...options,
    ...browserConfiguration,
    artifactFiles: ['browser-receipt.json'],
    timeoutMs: 300000,
  });
  workflows.push({ ...browserConfiguration, directory: browserRun.directory, browser: true });
}
const result = await reportCoverage(root, prepared.directory, {
  ...options,
  workflows,
});
const receipt = {
  ...collected,
  reportPath: result.path,
  preparedDirectory: prepared.directory,
  scope: options.browserDirectory ? 'NODE_AND_M3_BROWSER' : 'NODE_WORKFLOW_ONLY',
  functionalState: result.report.functionalState,
  thresholdMet: result.report.thresholdMet,
  summary: result.report.summary,
};
writeFileSync(
  resolve(collected.directory, 'collection-receipt.json'),
  JSON.stringify(receipt, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = result.report.functionalState === 'PASS' ? 0 : 1;
