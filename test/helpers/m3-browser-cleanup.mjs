/* global document, MutationObserver */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer as createPortServer } from 'node:net';
import { importUserUI } from '../../tools/import-user-ui.mjs';

import { installCleanupCoverage, assertCleanupCallbackCoverage } from './m3-browser-cleanup-coverage.mjs';

const json = (value) => JSON.stringify(value, null, 2) + '\n';

// These injections run the native operation first. They do not replace the
// M3 journey or synthesize its return value, assertions or wallet evidence.
export async function wrapM3Browser(browser, configuration, directory) {
  const coverageFinishes = [];
  const close = browser.close.bind(browser);
  browser.close = async (...args) => {
    const coverageErrors = [];
    for (const finish of coverageFinishes) {
      try {
        await finish();
      } catch (error) {
        coverageErrors.push(error);
      }
    }
    await close(...args);
    if (coverageErrors.length)
      throw new AggregateError(coverageErrors, 'cleanup qualification capture failed');
    await writeFile(join(directory, 'browser-closed'), 'native close completed');
    if (configuration.browserClose)
      throw new Error('FAULT_INJECTED_M3_BROWSER_CLOSE', {
        cause: new Error('FAULT_INJECTED_CLOSE_CAUSE'),
      });
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    context.setDefaultTimeout(10_000);
    if (!configuration.collectorOwnsCoverage) {
      const finish = await installCleanupCoverage(context, directory);
      if (finish) coverageFinishes.push(finish);
    }
    const newPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      const page = await newPage(...pageArgs);
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (options) => {
        const result = await screenshot(options);
        if (options?.path && basename(options.path) === 'm3-browser-journey.png') {
          const serialized = await page
            .locator('[data-m3-fixture-controls]')
            .getAttribute('data-m3-fixture-evidence');
          await writeFile(
            join(directory, 'journey-before-cleanup.json'),
            json({
              stage: 'JOURNEY_SCREENSHOT_BEFORE_CLEANUP',
              screenshot: options.path,
              resultPublished: existsSync(join(dirname(options.path), 'result.json')),
              evidence: JSON.parse(serialized),
            }),
            { flag: 'wx' },
          );
        }
        return result;
      };
      if (configuration.primary) {
        const goto = page.goto.bind(page);
        page.goto = async (...gotoArgs) => {
          const response = await goto(...gotoArgs);
          await page.locator('[data-m3-fixture-controls]').waitFor();
          await page.evaluate(() => {
            const controls = document.querySelector('[data-m3-fixture-controls]');
            const remove = () => controls.removeAttribute('data-m3-fixture-evidence');
            new MutationObserver(remove).observe(controls, {
              attributes: true,
              attributeFilter: ['data-m3-fixture-evidence'],
            });
            remove();
          });
          return response;
        };
      }
      if (configuration.unroute) {
        const unroute = page.unroute.bind(page);
        page.unroute = async (...routeArgs) => {
          await unroute(...routeArgs);
          await writeFile(join(directory, 'unroute-completed'), 'native unroute completed');
          throw new Error('FAULT_INJECTED_M3_UNROUTE', {
            cause: new Error('FAULT_INJECTED_UNROUTE_CAUSE'),
          });
        };
      }
      return page;
    };
    return context;
  };
  return browser;
}

export async function createM3FaultInputs(root, tool, directory, configuration) {
  await mkdir(directory, { recursive: true });
  const shim = join(directory, 'playwright-boundary.mjs');
  const vite = join(directory, 'vite-boundary.mjs');
  const preload = join(directory, 'preload.mjs');
  await writeFile(
    join(directory, 'injection.json'),
    json({ classification: 'FAULT_INJECTED', configuration }),
  );
  await writeFile(
    shim,
    `import { chromium as actual } from ${JSON.stringify(pathToFileURL(tool).href)};
import { wrapM3Browser } from ${JSON.stringify(import.meta.url)};
export const chromium = { async launch(options) {
  return wrapM3Browser(await actual.launch(options), ${JSON.stringify(configuration)}, ${JSON.stringify(directory)});
}};
`,
  );
  await writeFile(
    vite,
    `import { createServer as actual } from ${JSON.stringify(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href)};
import { writeFile } from 'node:fs/promises';
export async function createServer(options) {
  const server = await actual(options);
  const close = server.close.bind(server);
  server.close = async (...args) => {
    await close(...args);
    await writeFile(${JSON.stringify(join(directory, 'server-closed'))}, 'native close completed');
    if (${Boolean(configuration.serverClose)}) throw new Error('FAULT_INJECTED_M3_SERVER_CLOSE');
  };
  return server;
}
`,
  );
  await writeFile(
    preload,
    `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'vite' && context.parentURL === ${JSON.stringify(pathToFileURL(join(root, 'tools/verify-m3-browser.mjs')).href)})
    return { url: ${JSON.stringify(pathToFileURL(vite).href)}, shortCircuit: true };
  return next(specifier, context);
}});
`,
  );
  return { shim, preload };
}

async function availablePort() {
  const server = createPortServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  return port;
}

async function childRun(root, args, env, directory) {
  let stdout = '';
  let stderr = '';
  let passBeforeServerCleanup = false;
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
  const force = setTimeout(() => child.kill('SIGKILL'), 185_000);
  child.stdout.on('data', (data) => {
    stdout += data;
    if (/"state":\s*"PASS"/.test(stdout) && !existsSync(join(directory, 'server-closed')))
      passBeforeServerCleanup = true;
  });
  child.stderr.on('data', (data) => (stderr += data));
  let result;
  try {
    result = await new Promise((done, reject) => {
      child.on('error', reject);
      child.on('close', (status, signal) => done({ status, signal, passBeforeServerCleanup }));
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
    await writeFile(join(directory, 'stdout.log'), stdout);
    await writeFile(join(directory, 'stderr.log'), stderr);
  }
  await writeFile(join(directory, 'child.json'), json({ ...result, executable: process.execPath, args }));
  return { ...result, stdout, stderr };
}

export async function verifyM3Cleanup(t, root, tool) {
  const { runM3BrowserJourneys } = await import('../../tools/verify-m3-browser.mjs');
  assert.ok(tool && process.env.CHROMIUM_PATH, 'Approved native browser inputs required');
  const output = resolve(process.env.AF_M3_CLEANUP_TEST_OUTPUT || join(root, 'outputs/m3-cleanup-tests'));
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, 'run-'));
  t.diagnostic(`Retained actual M3 cleanup evidence: ${directory}`);
  const { chromium } = await import(pathToFileURL(tool).href);
  const { createServer } = await import('vite');
  await importUserUI(
    await readFile(join(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8'),
    join(root, 'apps/web'),
    join(root, 'build/ui-import'),
  );
  for (const [name, configuration] of [
    ['primary-and-unroute', { primary: true, unroute: true }],
    ['successful-journey-and-unroute', { unroute: true }],
    ['normal-exported-journey', {}],
  ]) {
    await t.test(name, async () => {
      const evidence = join(directory, name);
      await mkdir(evidence);
      const server = await createServer({
        root: join(root, 'apps/web'),
        configFile: join(root, 'apps/web/vite.config.ts'),
        logLevel: 'error',
        server: { host: '127.0.0.1', port: 0, strictPort: true },
      });
      let browser;
      try {
        await server.listen();
        browser = await wrapM3Browser(
          await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true }),
          configuration,
          evidence,
        );
        const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
        let failure;
        let result;
        try {
          result = await runM3BrowserJourneys(page, {
            origin: `http://127.0.0.1:${server.httpServer.address().port}`,
            evidenceDirectory: evidence,
          });
        } catch (error) {
          failure = error;
        }
        await writeFile(
          join(evidence, 'observed.json'),
          json({
            failure: failure && {
              name: failure.name,
              message: failure.message,
              stack: failure.stack,
              m3BrowserFailure: failure.m3BrowserFailure,
            },
            result,
            pageClosed: page.isClosed(),
            browserConnected: browser.isConnected(),
          }),
        );
        assert.equal(page.isClosed(), false, 'exported journey must not close caller page');
        assert.equal(browser.isConnected(), true, 'exported journey must not close caller browser');
        assert.equal(page.listenerCount('pageerror'), 0);
        assert.equal(page.listenerCount('console'), 0);
        if (configuration.unroute) {
          assert.ok(failure);
          assert.equal(
            failure.message,
            configuration.primary ? 'M3_BROWSER_EVIDENCE_UNAVAILABLE' : 'FAULT_INJECTED_M3_UNROUTE',
          );
          assert.equal(
            existsSync(join(evidence, 'result.json')),
            false,
            'cleanup rejection must not publish success',
          );
          const persisted = JSON.parse(await readFile(join(evidence, 'failure.json'), 'utf8'));
          if (!configuration.primary)
            assert.equal(persisted.primaryError, null, 'successful journey must precede unroute failure');
          assert.match(JSON.stringify(persisted), /FAULT_INJECTED_M3_UNROUTE/);
          assert.match(JSON.stringify(persisted), /FAULT_INJECTED_UNROUTE_CAUSE/);
          if (configuration.primary) {
            assert.equal(persisted.primaryError.message, 'M3_BROWSER_EVIDENCE_UNAVAILABLE');
            assert.match(persisted.primaryError.stack, /verify-m3-browser/);
          }
          assert.equal(persisted.cleanupErrors.length, 1);
          assert.equal(persisted.cleanupErrors[0].step, 'page.unroute');
          assert.equal(persisted.cleanupErrors[0].error.message, 'FAULT_INJECTED_M3_UNROUTE');
          assert.equal(persisted.cleanupErrors[0].error.cause.message, 'FAULT_INJECTED_UNROUTE_CAUSE');
          assert.match(persisted.cleanupErrors[0].error.cause.stack, /FAULT_INJECTED_UNROUTE_CAUSE/);
          assert.match(persisted.cleanupErrors[0].error.stack, /FAULT_INJECTED_M3_UNROUTE/);
        } else {
          assert.equal(failure, undefined);
          assert.equal(result.state, 'PASS');
          assert.equal(result.walletSends.length, 9);
          assert.deepEqual(JSON.parse(await readFile(join(evidence, 'result.json'), 'utf8')), result);
          assert.equal(existsSync(join(evidence, 'failure.json')), false);
        }
      } finally {
        const cleanup = await Promise.allSettled([
          Promise.resolve().then(() => browser?.close()),
          Promise.resolve().then(() => server.close()),
        ]);
        assert.ok(
          cleanup.every((r) => r.status === 'fulfilled'),
          JSON.stringify(cleanup),
        );
      }
      if (!configuration.primary) await assertCompletedJourney(evidence);
    });
  }
  for (const [name, configuration] of [
    ['cli-primary-and-browser-close', { primary: true, browserClose: true }],
    ['cli-success-and-browser-close', { browserClose: true }],
    ['cli-success-and-server-close', { serverClose: true }],
    ['cli-normal', {}],
  ]) {
    await t.test(name, async () => {
      const evidence = join(directory, name);
      const { shim, preload } = await createM3FaultInputs(root, tool, evidence, configuration);
      const result = await childRun(
        root,
        ['--import', preload, join(root, 'tools/verify-m3-browser.mjs')],
        {
          ...process.env,
          AF_PLAYWRIGHT_PATH: shim,
          AF_M3_BROWSER_PORT: String(await availablePort()),
          AF_M3_BROWSER_EVIDENCE_ROOT: join(evidence, 'journeys'),
        },
        evidence,
      );
      assert.equal(result.signal, null, result.stderr);
      assert.equal(existsSync(join(evidence, 'browser-closed')), true);
      assert.equal(
        existsSync(join(evidence, 'server-closed')),
        true,
        'server close must be attempted even after browser close rejects',
      );
      const { readdir } = await import('node:fs/promises');
      const runs = await readdir(join(evidence, 'journeys'));
      assert.equal(runs.length, 1);
      const journey = join(evidence, 'journeys', runs[0]);
      if (configuration.browserClose || configuration.serverClose) {
        assert.equal(result.status, 1, result.stderr);
        assert.doesNotMatch(result.stdout, /"state":\s*"PASS"/);
        assert.equal(
          existsSync(join(journey, 'result.json')),
          false,
          'CLI-owned cleanup precedes final success',
        );
        const persisted = JSON.parse(await readFile(join(journey, 'cli-failure.json'), 'utf8'));
        if (!configuration.primary)
          assert.equal(persisted.primaryError, null, 'successful CLI journey must precede cleanup failure');
        assert.match(
          JSON.stringify(persisted),
          configuration.browserClose ? /FAULT_INJECTED_M3_BROWSER_CLOSE/ : /FAULT_INJECTED_M3_SERVER_CLOSE/,
        );
        assert.equal(persisted.cleanupErrors.length, 1);
        const cleanup = persisted.cleanupErrors[0];
        assert.equal(cleanup.step, configuration.browserClose ? 'browser.close' : 'server.close');
        assert.equal(
          cleanup.error.message,
          configuration.browserClose ? 'FAULT_INJECTED_M3_BROWSER_CLOSE' : 'FAULT_INJECTED_M3_SERVER_CLOSE',
        );
        assert.match(cleanup.error.stack, new RegExp(cleanup.error.message));
        if (configuration.browserClose) {
          assert.equal(cleanup.error.cause.message, 'FAULT_INJECTED_CLOSE_CAUSE');
          assert.match(cleanup.error.cause.stack, /FAULT_INJECTED_CLOSE_CAUSE/);
        } else assert.equal(cleanup.error.cause, undefined);
        if (configuration.primary) {
          assert.equal(persisted.primaryError.message, 'M3_BROWSER_EVIDENCE_UNAVAILABLE');
          assert.match(persisted.primaryError.stack, /verify-m3-browser/);
          assert.match(result.stderr, /M3_BROWSER_EVIDENCE_UNAVAILABLE/);
        }
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.passBeforeServerCleanup, false);
        assert.equal(JSON.parse(result.stdout).state, 'PASS');
        assert.equal(JSON.parse(result.stdout).walletSends.length, 9);
        assert.equal(JSON.parse(await readFile(join(journey, 'result.json'), 'utf8')).state, 'PASS');
      }
      if (!configuration.primary) await assertCompletedJourney(evidence);
    });
  }
}

async function assertCompletedJourney(directory) {
  const observed = JSON.parse(await readFile(join(directory, 'journey-before-cleanup.json'), 'utf8'));
  assert.equal(observed.resultPublished, false, 'journey evidence must not publish PASS before cleanup');
  assert.equal(existsSync(observed.screenshot), true);
  const sends = observed.evidence.providerRequests.filter(
    (request) => request.method === 'eth_sendTransaction',
  );
  assert.equal(sends.length, 9, 'all controlled wallet sends must precede cleanup failure');
  assert.equal(observed.evidence.snapshot.onchain.vaultClosed, true);
  await assertCleanupCallbackCoverage(directory);
}

export async function verifyM3CollectorFailure(t, root, tool) {
  const { dirname } = await import('node:path');
  const { prepareCoverage } = await import('../../tools/coverage/prepare.mjs');
  const { readSourceSnapshot } = await import('../../tools/coverage/inventory.mjs');
  const { collectNodeWorkflow } = await import('../../tools/coverage/collect.mjs');
  const { reportCoverage } = await import('../../tools/coverage/report.mjs');
  const output = resolve(process.env.AF_M3_CLEANUP_TEST_OUTPUT || join(root, 'outputs/m3-cleanup-tests'));
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, 'collector-'));
  t.diagnostic(`Retained actual M3 collector failure evidence: ${directory}`);
  const options = {
    instrumentationDirectory: resolve(
      process.env.AF_QUALIFIED_COVERAGE_TOOLS ||
        join(root, '.checks/coverage-tools/instrumentation/node_modules'),
    ),
    browserDirectory: dirname(tool),
    // This nested fault qualification measures its current clean source, not
    // the ancestry of a historical feature branch before a squash merge.
    sourceBase: readSourceSnapshot(root).candidateCommit,
    output: join(directory, 'prepared'),
  };
  const prepared = await prepareCoverage(root, options);
  const preload = join(directory, 'inject-native-boundary.mjs');
  await writeFile(
    join(directory, 'injection.json'),
    json({
      classification: 'FAULT_INJECTED',
      boundary: 'native page.unroute after a real M3 missing-evidence failure',
      replacesDriver: false,
    }),
  );
  await writeFile(
    preload,
    `import { chromium } from ${JSON.stringify(pathToFileURL(tool).href)};
import { wrapM3Browser } from ${JSON.stringify(import.meta.url)};
const launch = chromium.launch.bind(chromium);
chromium.launch = async options => wrapM3Browser(await launch(options), {primary:true,unroute:true,collectorOwnsCoverage:true}, ${JSON.stringify(directory)});
`,
  );
  const configuration = {
    id: 'm3-cleanup-negative',
    args: [
      '--import',
      preload,
      'tools/coverage/run-browser.mjs',
      '--tools',
      options.instrumentationDirectory,
      '--browser-tools',
      options.browserDirectory,
      '--chrome',
      process.env.CHROMIUM_PATH,
      '--base',
      options.sourceBase,
      '--workflow',
      'm3',
    ],
  };
  const collected = await collectNodeWorkflow(root, prepared.directory, {
    ...options,
    ...configuration,
    artifactFiles: ['browser-receipt.json'],
    timeoutMs: 300000,
  });
  const receipt = JSON.parse(await readFile(join(collected.directory, 'browser-receipt.json'), 'utf8'));
  const reported = await reportCoverage(root, prepared.directory, {
    ...options,
    workflows: [{ ...configuration, directory: collected.directory, browser: true }],
  });
  await writeFile(
    join(directory, 'observation.json'),
    json({
      prepared,
      collected,
      receipt,
      report: { path: reported.path, functionalState: reported.report.functionalState },
    }),
  );
  assert.equal(collected.state, 'FAIL');
  assert.equal(receipt.state, 'FAIL');
  assert.equal(reported.report.functionalState, 'FAIL');
  assert.ok(receipt.failure);
  const failure = JSON.parse(await readFile(join(receipt.directory, receipt.failure.file), 'utf8'));
  const primary = failure.errors.find((error) => error.message === 'M3_BROWSER_EVIDENCE_UNAVAILABLE');
  assert.ok(primary, 'actual collector persisted primary error must survive unroute rejection');
  assert.match(primary.stack, /verify-m3-browser/);
  assert.equal(primary.m3BrowserFailure.primaryError.message, 'M3_BROWSER_EVIDENCE_UNAVAILABLE');
  assert.equal(primary.m3BrowserFailure.cleanupErrors[0].step, 'page.unroute');
  assert.equal(primary.m3BrowserFailure.cleanupErrors[0].error.message, 'FAULT_INJECTED_M3_UNROUTE');
  assert.match(primary.m3BrowserFailure.cleanupErrors[0].error.stack, /FAULT_INJECTED_M3_UNROUTE/);
  assert.equal(primary.m3BrowserFailure.cleanupErrors[0].error.cause.message, 'FAULT_INJECTED_UNROUTE_CAUSE');
}
