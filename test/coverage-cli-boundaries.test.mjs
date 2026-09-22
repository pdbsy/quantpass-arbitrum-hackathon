import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { isTypeOnly } from '../tools/coverage/inventory.mjs';
import { buildPrototypeMap } from '../tools/coverage/prototype-map.mjs';
import { driverForBrowserWorkflow } from '../tools/coverage/browser-legacy.mjs';

const root = resolve(import.meta.dirname, '..');
function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 15000,
    ...options,
  });
}

for (const script of ['prepare.mjs', 'run.mjs'])
  for (const args of [['--unknown', 'value'], ['--base'], ['--base', 'a', '--base', 'b']])
    test(`${script} rejects ambiguous or incomplete arguments before tool execution: ${args.join(' ')}`, () => {
      const result = run(`tools/coverage/${script}`, args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /invalid coverage (prepare|run) arguments/);
      assert.equal(result.stdout, '');
    });

test('workflow launcher converts a signalled child into failure instead of a successful null exit', () => {
  const result = run('tools/coverage/launch.mjs', [], {
    env: {
      ...process.env,
      AF_COVERAGE_COMMAND: JSON.stringify(['-e', "process.kill(process.pid, 'SIGTERM')"]),
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
});

test('type-only re-export proof distinguishes mixed and empty value exports', () => {
  const row = (specifiers) => ({ type: 'ExportNamedDeclaration', exportKind: 'value', specifiers });
  assert.equal(isTypeOnly(row([{ exportKind: 'type' }])), true);
  assert.equal(isTypeOnly(row([{ exportKind: 'type' }, { exportKind: 'value' }])), false);
  assert.equal(isTypeOnly(row([])), false);
});

test('prototype and browser workflow boundaries reject invalid input rather than selecting a source', () => {
  for (const value of [null, undefined, 1, {}]) assert.throws(() => buildPrototypeMap(value), /frozen HTML/);
  assert.throws(() => driverForBrowserWorkflow('unknown'), /UNKNOWN_BROWSER_WORKFLOW/);
  assert.equal(driverForBrowserWorkflow('management'), 'tools/verify-management-browser.mjs');
});

// Only the expensive workflow executor is substituted. The real CLI parses argv,
// orders commands, constructs qualification prerequisites and persists its receipt.
// These assertions validate orchestration, never scanner or application outcomes.
function orchestrationFixture(t, functionalState) {
  const directory = mkdtempSync(join(tmpdir(), 'alphaforge-coverage-orchestration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const record = join(directory, 'calls.jsonl');
  const out = JSON.stringify(directory);
  const recordPath = JSON.stringify(record);
  const mocks = {
    [pathToFileURL(resolve(root, 'tools/coverage/prepare.mjs')).href]: `
      import {appendFileSync} from 'node:fs';
      export async function prepareCoverage(root,options) {
        appendFileSync(${recordPath},JSON.stringify({kind:'prepare',options})+'\\n');
        return {directory:${out}};
      }`,
    [pathToFileURL(resolve(root, 'tools/coverage/collect.mjs')).href]: `
      import {appendFileSync} from 'node:fs';
      export async function collectNodeWorkflow(root,prepared,options) {
        appendFileSync(${recordPath},JSON.stringify({kind:'collect',prepared,options})+'\\n');
        return {directory:${out},state:'PASS'};
      }`,
    [pathToFileURL(resolve(root, 'tools/coverage/report.mjs')).href]: `
      import {appendFileSync} from 'node:fs';
      export async function reportCoverage(root,prepared,options) {
        appendFileSync(${recordPath},JSON.stringify({kind:'report',options})+'\\n');
        return {path:'fixture-report.json',report:{functionalState:${JSON.stringify(functionalState)},thresholdMet:false,summary:{}}};
      }`,
    [pathToFileURL(resolve(root, 'tools/environment/observe.mjs')).href]: `
      export const npmCli=()=>'/qualified-fixture/npm-cli.js';`,
  };
  const hook = join(directory, 'dependencies.mjs');
  writeFileSync(
    hook,
    `import {registerHooks} from 'node:module'; const mocks=${JSON.stringify(mocks)};
     registerHooks({load(url,context,next){return Object.hasOwn(mocks,url)?{format:'module',source:mocks[url],shortCircuit:true}:next(url,context);}});`,
  );
  return {
    directory,
    execute(args) {
      return run('--import', [pathToFileURL(hook).href, 'tools/coverage/run.mjs', ...args]);
    },
    calls: () => readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse),
  };
}

for (const browser of [false, true])
  for (const state of ['PASS', 'FAIL'])
    test(`coverage CLI binds its real workflow list and exit to report state (browser=${browser}, state=${state})`, (t) => {
      const f = orchestrationFixture(t, state);
      const args = ['--base', 'a'.repeat(40)];
      if (browser)
        args.push(
          '--prepared',
          f.directory,
          '--tools',
          '/qualified-fixture/tools',
          '--browser-tools',
          '/qualified-fixture/browser',
          '--chrome',
          '/qualified-fixture/chrome',
        );
      const result = f.execute(args);
      assert.equal(result.status, state === 'PASS' ? 0 : 1, result.stderr);
      const calls = f.calls();
      assert.equal(
        calls.some((row) => row.kind === 'prepare'),
        !browser,
      );
      const jobs = calls.filter((row) => row.kind === 'collect');
      assert.deepEqual(
        jobs.map((row) => row.options.id),
        [
          'npm-check',
          ...(browser ? ['m3-browser', 'legacy-browser', 'management-browser'] : []),
          'coverage-qualification',
          'source-policy',
          'dependency-delta-audit',
          'osv-scanner',
          'gitleaks-history',
        ],
      );
      assert.deepEqual(jobs[0].options.args, ['/qualified-fixture/npm-cli.js', 'run', 'check']);
      const qualification = jobs.find((row) => row.options.id === 'coverage-qualification').options.args;
      assert.equal(qualification.includes('test/coverage-browser.qualified.test.mjs'), browser);
      const bootstrap = decodeURIComponent(qualification[1].split(',').slice(1).join(','));
      assert.match(
        bootstrap,
        browser ? /qualified-fixture\/tools/ : /\.checks\/coverage-tools\/instrumentation\/node_modules/,
      );
      if (browser)
        for (const row of jobs.filter((item) => item.options.id.endsWith('-browser'))) {
          assert.deepEqual(row.options.artifactFiles, ['browser-receipt.json']);
          assert.equal(row.options.args.at(-1), row.options.id.replace('-browser', ''));
          assert.equal(
            row.options.args[row.options.args.indexOf('--chrome') + 1],
            '/qualified-fixture/chrome',
          );
        }
      const final = calls.at(-1);
      assert.equal(final.kind, 'report');
      assert.deepEqual(
        final.options.workflows.map((row) => row.id),
        jobs.map((row) => row.options.id),
      );
      const receipt = JSON.parse(readFileSync(join(f.directory, 'collection-receipt.json')));
      assert.equal(receipt.functionalState, state);
      assert.equal(receipt.thresholdMet, false);
      assert.equal(receipt.scope, browser ? 'NODE_AND_M3_LEGACY_MANAGEMENT_BROWSER' : 'NODE_WORKFLOW_ONLY');
      assert.deepEqual(JSON.parse(result.stdout), receipt);
    });
