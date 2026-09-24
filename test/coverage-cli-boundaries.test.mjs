import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// Exercise the real receipt writer and exit contract with controlled worker outcomes.
// These are protocol tests; the qualified browser suites separately run real Chrome.
for (const scenario of [
  'default-pass',
  'explicit-fail',
  'default-throw',
  'explicit-throw',
  'management-missing-summary',
])
  test(`browser CLI preserves worker failure and workflow identity in its receipt: ${scenario}`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'alphaforge-browser-receipt-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const raw = join(directory, 'raw');
    mkdirSync(raw);
    const manifest = { candidateCommit: 'a'.repeat(40), candidateTree: 'b'.repeat(40) };
    const bytes = JSON.stringify(manifest) + '\n';
    writeFileSync(join(directory, 'manifest.json'), bytes);
    const throwing = scenario.endsWith('throw');
    const state = scenario === 'default-pass' ? 'PASS' : 'FAIL';
    const management = scenario.startsWith('management');
    const result = management
      ? { status: state, directory, driver: 'tools/verify-management-browser.mjs', collection: null }
      : {
          directory,
          index: { file: 'fixture-index.json' },
          workflowResult: { state, checks: ['fixture-worker-result'] },
        };
    const worker = throwing
      ? `throw new Error('EXPECTED_WORKER_REJECTION');`
      : `return ${JSON.stringify(result)};`;
    const mocks = {
      [pathToFileURL(resolve(root, 'tools/coverage/prepare.mjs')).href]:
        `export async function verifyPrepared(){return {manifest:${JSON.stringify(manifest)},generated:{},tools:{}};}`,
      [pathToFileURL(resolve(root, 'tools/coverage/browser.mjs')).href]:
        `export async function collectBrowserCoverage(){${worker}}`,
      [pathToFileURL(resolve(root, 'tools/coverage/browser-legacy.mjs')).href]:
        `export async function collectLegacyBrowserCoverage(){${worker}}`,
    };
    const hook = join(directory, 'workers.mjs');
    writeFileSync(
      hook,
      `import {registerHooks} from 'node:module';Object.assign(process.env,${JSON.stringify({ AF_COVERAGE_PREPARED: directory, AF_COVERAGE_RAW: raw })});const mocks=${JSON.stringify(mocks)};registerHooks({load(url,context,next){return Object.hasOwn(mocks,url)?{format:'module',source:mocks[url],shortCircuit:true}:next(url,context);}});`,
    );
    const args = [
      '--import',
      pathToFileURL(hook).href,
      'tools/coverage/run-browser.mjs',
      '--browser-tools',
      directory,
      '--chrome',
      process.execPath,
      '--base',
      manifest.candidateCommit,
    ];
    if (!scenario.startsWith('default')) args.push('--workflow', management ? 'management' : 'm3');
    const child = run(args[0], args.slice(1));
    assert.equal(child.status, state === 'PASS' ? 0 : 1, child.stderr);
    const receipt = JSON.parse(readFileSync(join(directory, 'browser-receipt.json')));
    assert.equal(receipt.state, state);
    assert.equal(receipt.workflow, management ? 'management' : 'm3');
    assert.equal(receipt.candidateCommit, manifest.candidateCommit);
    assert.equal(receipt.candidateTree, manifest.candidateTree);
    assert.equal(receipt.manifestSha256, createHash('sha256').update(bytes).digest('hex'));
    if (throwing) assert.equal(receipt.error, 'EXPECTED_WORKER_REJECTION');
    if (management || throwing) assert.equal(receipt.index, undefined);
    assert.equal(child.stdout, '');
  });

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

test('an earlier UTF-8 loader preserves first-party source behavior under the real coverage hook', () => {
  const loader = `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);return result.source&&typeof result.source!=='string'?{...result,source:Buffer.from(result.source).toString('utf8')}:result;}});`;
  const result = run(
    '--input-type=module',
    [
      '-e',
      `import assert from 'node:assert/strict';import {isTypeOnly} from './tools/coverage/inventory.mjs';assert.equal(isTypeOnly({type:'ExportAllDeclaration',exportKind:'value'}),false);`,
    ],
    {
      env: {
        ...process.env,
        NODE_OPTIONS:
          `--import=data:text/javascript,${encodeURIComponent(loader)} ${process.env.NODE_OPTIONS || ''}`.trim(),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
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
          ...(browser
            ? [
                'qualified-legacy-workflows',
                'qualified-m3-workflow',
                'qualified-browser-policy',
                'qualified-legacy-capability',
              ]
            : []),
          'source-policy',
          'dependency-delta-audit',
          'osv-scanner',
          'gitleaks-history',
        ],
      );
      assert.deepEqual(jobs[0].options.args, ['/qualified-fixture/npm-cli.js', 'run', 'check']);
      const qualification = jobs.find((row) => row.options.id === 'coverage-qualification').options.args;
      assert.equal(qualification.includes('test/coverage-browser.qualified.test.mjs'), browser);
      assert.equal(qualification.includes('test/prototype-damaged-dates.qualified.test.mjs'), browser);
      const bootstrap = decodeURIComponent(qualification[1].split(',').slice(1).join(','));
      const prefix = 'Object.assign(process.env, ';
      assert.ok(bootstrap.startsWith(prefix) && bootstrap.endsWith(');'));
      const prerequisites = JSON.parse(bootstrap.slice(prefix.length, -2));
      assert.deepEqual(prerequisites, {
        AF_QUALIFIED_COVERAGE_TOOLS: browser
          ? resolve('/qualified-fixture/tools')
          : resolve(root, '.checks/coverage-tools/instrumentation/node_modules'),
        ...(browser
          ? {
              AF_QUALIFIED_BROWSER_TOOLS: resolve('/qualified-fixture/browser'),
              CHROMIUM_PATH: '/qualified-fixture/chrome',
            }
          : {}),
      });
      if (browser)
        for (const row of jobs.filter((item) => item.options.id.endsWith('-browser'))) {
          assert.deepEqual(row.options.artifactFiles, ['browser-receipt.json']);
          assert.equal(row.options.args.at(-1), row.options.id.replace('-browser', ''));
          assert.equal(
            row.options.args[row.options.args.indexOf('--chrome') + 1],
            '/qualified-fixture/chrome',
          );
        }
      if (browser) {
        const qualifiers = jobs.filter((row) => row.options.id.startsWith('qualified-'));
        assert.equal(qualifiers.length, 4);
        for (const [index, row] of qualifiers.entries()) {
          assert.equal(row.options.timeoutMs, [600000, 300000, 600000, 600000][index]);
          assert.equal(
            row.options.args.at(-1),
            [
              'test/coverage-browser-legacy.qualified.test.mjs',
              'test/coverage-browser-m3.qualified.test.mjs',
              'test/browser-policy-inputs.qualified.test.mjs',
              'test/browser-legacy-capability.qualified.test.mjs',
            ][index],
          );
          assert.equal(row.options.artifactFiles, undefined);
          const script = decodeURIComponent(row.options.args[1].split(',').slice(1).join(','));
          // Let the inherited real hook capture its bound context before this
          // controlled input is passed to the actual qualification bootstrap.
          const fixtureBootstrap = (raw) =>
            'data:text/javascript,' +
            encodeURIComponent(
              `Object.assign(process.env, ${JSON.stringify({
                AF_COVERAGE_ROOT: root,
                AF_COVERAGE_PREPARED: f.directory,
                AF_COVERAGE_RAW: raw,
              })}); await import(${JSON.stringify(row.options.args[1])});`,
            );
          const proof = run('--import', [
            fixtureBootstrap(join(f.directory, 'unique-workflow', 'raw')),
            '--input-type=module',
            '-e',
            'console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith("AF_QUALIFIED_")||key==="AF_RUN_LEGACY_WORKFLOWS"))))',
          ]);
          assert.equal(proof.status, 0, proof.stderr);
          const bound = JSON.parse(proof.stdout);
          assert.equal(bound.AF_QUALIFIED_BROWSER_CANDIDATE, root);
          assert.equal(bound.AF_QUALIFIED_BROWSER_PREPARED, f.directory);
          assert.equal(
            bound.AF_QUALIFIED_BROWSER_OUTPUT,
            join(f.directory, 'unique-workflow', 'qualified-browser'),
          );
          assert.equal(
            bound.AF_QUALIFIED_BROWSER_NODE_HOOK,
            join(f.directory, 'unique-workflow', 'node-hook.mjs'),
          );
          assert.equal(bound.AF_RUN_LEGACY_WORKFLOWS, '1');
          const unbound = run('--import', [
            fixtureBootstrap(''),
            '--input-type=module',
            '-e',
            'process.exit(0)',
          ]);
          assert.notEqual(unbound.status, 0);
          assert.match(unbound.stderr, /Bound coverage context required: AF_COVERAGE_RAW/);
          assert.ok(script.includes('AF_COVERAGE_RAW'));
        }
        assert.equal(
          jobs.find((row) => row.options.id === 'coverage-qualification').options.timeoutMs,
          300000,
        );
      }
      const final = calls.at(-1);
      assert.equal(final.kind, 'report');
      assert.deepEqual(
        final.options.workflows.map((row) => row.id),
        jobs.map((row) => row.options.id),
      );
      assert.deepEqual(
        final.options.workflows.filter((row) => row.browser).map((row) => row.id),
        browser ? ['m3-browser', 'legacy-browser', 'management-browser'] : [],
      );
      const receipt = JSON.parse(readFileSync(join(f.directory, 'collection-receipt.json')));
      assert.equal(receipt.functionalState, state);
      assert.equal(receipt.thresholdMet, false);
      assert.equal(receipt.scope, browser ? 'NODE_AND_M3_LEGACY_MANAGEMENT_BROWSER' : 'NODE_WORKFLOW_ONLY');
      assert.deepEqual(JSON.parse(result.stdout), receipt);
    });
