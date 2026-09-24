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
  for (const workflow of ['m3', 'legacy', 'management']) {
    const browserConfiguration = {
      id: `${workflow}-browser`,
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
        '--workflow',
        workflow,
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
}
// Run the existing assertion-bearing method qualifications under the same
// candidate-bound hook. Only verified local tool paths enter the child process.
const prerequisites = {
  AF_QUALIFIED_COVERAGE_TOOLS: resolve(
    options.instrumentationDirectory || resolve(root, '.checks/coverage-tools/instrumentation/node_modules'),
  ),
  ...(options.browserDirectory
    ? {
        AF_QUALIFIED_BROWSER_TOOLS: resolve(options.browserDirectory),
        CHROMIUM_PATH: options.executablePath,
      }
    : {}),
};
const qualification = {
  id: 'coverage-qualification',
  args: [
    '--import',
    `data:text/javascript,${encodeURIComponent(`Object.assign(process.env, ${JSON.stringify(prerequisites)});`)}`,
    '--test',
    'test/coverage-preparation.qualified.test.mjs',
    'test/coverage-node-hook.qualified.test.mjs',
    ...(options.browserDirectory
      ? [
          'test/coverage-browser.qualified.test.mjs',
          'test/coverage-task-board.qualified.test.mjs',
          'test/coverage-browser-paths.qualified.test.mjs',
          'test/management-browser-driver.qualified.test.mjs',
          'test/browser-tool-cli-boundaries.test.mjs',
          'test/browser-tool-failures.qualified.test.mjs',
          'test/m3-browser-cleanup.qualified.test.mjs',
          'test/ui-kline-hover.qualified.test.mjs',
          'test/prototype-damaged-dates.qualified.test.mjs',
          'test/prototype-damaged-state.qualified.test.mjs',
        ]
      : []),
  ],
};
const qualified = await collectNodeWorkflow(root, prepared.directory, {
  ...options,
  ...qualification,
  timeoutMs: 300000,
});
workflows.push({ ...qualification, directory: qualified.directory });
// These existing method qualifications exercise real drivers against this exact
// prepared graph. Their nested browser artifacts remain assertion evidence;
// only the three browser workflows above supply browser observations to report.
if (options.browserDirectory) {
  const bootstrap = `import assert from 'node:assert/strict';
import { resolve } from 'node:path';
for (const key of ['AF_COVERAGE_ROOT', 'AF_COVERAGE_PREPARED', 'AF_COVERAGE_RAW'])
  assert.ok(process.env[key], 'Bound coverage context required: ' + key);
Object.assign(process.env, ${JSON.stringify(prerequisites)}, {
  AF_QUALIFIED_BROWSER_CANDIDATE: process.env.AF_COVERAGE_ROOT,
  AF_QUALIFIED_BROWSER_PREPARED: process.env.AF_COVERAGE_PREPARED,
  AF_QUALIFIED_BROWSER_OUTPUT: resolve(process.env.AF_COVERAGE_RAW, '..', 'qualified-browser'),
  AF_QUALIFIED_BROWSER_NODE_HOOK: resolve(process.env.AF_COVERAGE_RAW, '..', 'node-hook.mjs'),
  AF_RUN_LEGACY_WORKFLOWS: '1',
});`;
  for (const [id, file, timeoutMs] of [
    ['qualified-legacy-workflows', 'test/coverage-browser-legacy.qualified.test.mjs', 600000],
    ['qualified-m3-workflow', 'test/coverage-browser-m3.qualified.test.mjs', 300000],
    ['qualified-browser-policy', 'test/browser-policy-inputs.qualified.test.mjs', 600000],
    ['qualified-legacy-capability', 'test/browser-legacy-capability.qualified.test.mjs', 600000],
  ]) {
    const configuration = {
      id,
      args: ['--import', `data:text/javascript,${encodeURIComponent(bootstrap)}`, '--test', file],
    };
    const qualified = await collectNodeWorkflow(root, prepared.directory, {
      ...options,
      ...configuration,
      timeoutMs,
    });
    workflows.push({ ...configuration, directory: qualified.directory });
  }
}
// Include actual existing gate commands, not imports or inferred scanner hits.
// Their nonzero exits still fail the complete functional workflow collection.
for (const gate of [
  { id: 'source-policy', args: ['tools/ci/check-source-policy.mjs'] },
  { id: 'dependency-delta-audit', args: ['tools/ci/check-dependency-delta.mjs'] },
  { id: 'osv-scanner', args: ['tools/ci/check-osv.mjs'] },
  { id: 'gitleaks-history', args: ['tools/ci/check-gitleaks.mjs'] },
]) {
  const execution = await collectNodeWorkflow(root, prepared.directory, {
    ...options,
    ...gate,
    timeoutMs: 600000,
  });
  workflows.push({ ...gate, directory: execution.directory });
}
const result = await reportCoverage(root, prepared.directory, {
  ...options,
  workflows,
});
const receipt = {
  ...collected,
  reportPath: result.path,
  preparedDirectory: prepared.directory,
  scope: options.browserDirectory ? 'NODE_AND_M3_LEGACY_MANAGEMENT_BROWSER' : 'NODE_WORKFLOW_ONLY',
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
