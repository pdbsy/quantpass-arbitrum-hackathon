import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { qualifiedBrowserBootstrap } from './helpers/qualified-browser-bootstrap.mjs';
import { runM3BrowserJourneys } from '../tools/verify-m3-browser.mjs';

const root = resolve(import.meta.dirname, '..');
const approvedBrowserTool =
  process.env.AF_PLAYWRIGHT_PATH ||
  (process.env.AF_QUALIFIED_BROWSER_TOOLS && join(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs'));

async function executeDriver(options, timeoutMs) {
  const child = spawn(process.execPath, [join(root, 'tools/verify-ui-browser.mjs')], {
    ...options,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let error;
  let retired = false;
  let timer;
  let escalation;
  let deadline;
  let settled = false;
  const clearTimers = () => {
    clearTimeout(timer);
    clearTimeout(escalation);
    clearTimeout(deadline);
  };
  const terminateOnce = () => {
    if (retired) return;
    retired = true;
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: 5_000,
        killSignal: 'SIGKILL',
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (failure) {
        if (failure.code !== 'ESRCH') throw failure;
      }
    }
  };
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  try {
    return await new Promise((done) => {
      const finish = (status, signal) => {
        if (settled) return;
        settled = true;
        clearTimers();
        done({ stdout, stderr, status, signal, error });
      };
      child.once('error', (failure) => {
        error ??= failure;
        try {
          terminateOnce();
        } catch (cleanup) {
          error = new AggregateError([error, cleanup]);
        }
        finish(null, null);
      });
      child.once('close', (status, signal) => {
        retired = true;
        finish(status, signal);
      });
      timer = setTimeout(() => {
        error = new Error('Browser driver exceeded its outer execution budget');
        const force = () => {
          try {
            terminateOnce();
          } catch (cleanup) {
            error = new AggregateError([error, cleanup], 'Timeout cleanup failed');
          }
        };
        // The approved Playwright browser owns a separate process group. Allow
        // its native signal handlers and our shim to close that browser first.
        if (process.platform === 'win32') force();
        else {
          try {
            if (!retired && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          } catch (failure) {
            error = new AggregateError([error, failure]);
          }
          if (!settled) escalation = setTimeout(force, 5_000);
        }
        if (!settled)
          deadline = setTimeout(() => {
            force();
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            finish(null, null);
          }, 6_000);
      }, timeoutMs);
    });
  } finally {
    clearTimers();
    terminateOnce();
  }
}

async function reservePort(port = 0) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  const actual = server.address().port;
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  return actual;
}

test(
  'real legacy browser journey reports success only after cleanup and preserves injected failures',
  { concurrency: 2 },
  async (t) => {
    const tool = approvedBrowserTool;
    const chrome = process.env.CHROMIUM_PATH;
    assert.ok(
      tool && existsSync(tool),
      'Approved AF_PLAYWRIGHT_PATH is required; qualification is NOT_RUN without it',
    );
    assert.ok(
      chrome && existsSync(chrome),
      'Approved CHROMIUM_PATH is required; qualification is NOT_RUN without it',
    );
    const bootstrap = await qualifiedBrowserBootstrap(root, ['tools/verify-ui-browser.mjs']);
    await Promise.all(
      [
        ['FAULT_INJECTED closed page diagnostics', false, false],
        ['FAULT_INJECTED browser close rejection after original failure', false, true],
        ['real successful journey', true, false],
        ['FAULT_INJECTED cleanup failure after real successful journey', true, true],
        ['FAULT_INJECTED timeout after native browser launch', false, false, true],
      ].map(([name, journey, failClose, hang]) =>
        t.test(name, async (t) => {
          const directory = await mkdtemp(join(tmpdir(), 'alphaforge-browser-failure-'));
          t.after(() => rm(directory, { recursive: true, force: true }));
          const port = await reservePort();
          const backend = join(directory, 'backend.mjs');
          const toolShim = join(directory, 'playwright-boundary.mjs');
          await mkdir(join(directory, 'apps/web/dist'), { recursive: true });
          if (journey) {
            assert.ok(
              existsSync(join(root, 'apps/web/dist/index.html')),
              'Build the exact candidate UI first',
            );
            await cp(join(root, 'apps/web/dist'), join(directory, 'apps/web/dist'), { recursive: true });
          }
          await writeFile(
            backend,
            `import { buildApp as actual } from ${JSON.stringify(pathToFileURL(join(root, 'apps/server/src/app.ts')).href)};
         import { writeFileSync } from 'node:fs';
         import { basename } from 'node:path';
         export async function buildApp(options) {
           const result = await actual(options);
           result.app.addHook('onClose', async () => {
             writeFileSync(${JSON.stringify(join(directory, 'app-closed'))}, 'closed');
             writeFileSync(${JSON.stringify(directory)} + '/' + basename(options.dbPath) + '.closed', 'closed');
           });
           return result;
         }`,
          );
          await writeFile(
            toolShim,
            `import { chromium as actual } from ${JSON.stringify(pathToFileURL(resolve(tool)).href)};
         import { writeFileSync } from 'node:fs';
         let launchIndex = 0;
         export const chromium = { async launch(options) {
           const id = ++launchIndex;
           const browser = await actual.launch(options);
           browser.once('disconnected', () => writeFileSync(${JSON.stringify(join(directory, 'browser-disconnected'))}, 'closed'));
           process.once('SIGTERM', () => {
             const deadline = setTimeout(() => process.exit(125), 3_000);
             browser.close().then(() => { clearTimeout(deadline); process.exit(124); }, () => { clearTimeout(deadline); process.exit(125); });
           });
           const newContext = browser.newContext.bind(browser);
           browser.newContext = async (...args) => {
             const context = await newContext(...args);
             context.setDefaultTimeout(10000);
             context.setDefaultNavigationTimeout(10000);
             if (${JSON.stringify(bootstrap)}) await context.addInitScript({ content: ${JSON.stringify(bootstrap)} });
             const newPage = context.newPage.bind(context);
             context.newPage = async (...args) => {
              const page = await newPage(...args);
               if (${Boolean(hang)}) page.goto = async () => {
                 writeFileSync(${JSON.stringify(join(directory, 'timeout-ready'))}, 'ready');
                 await new Promise(() => {});
               };
               else if (!${journey}) page.goto = async () => {
                 await page.close();
                 writeFileSync(${JSON.stringify(join(directory, 'page-closed'))}, String(page.isClosed()));
                 throw new Error('FAULT_INJECTED_ORIGINAL_BROWSER_FAILURE');
               };
               return page;
             };
             return context;
           };
           const close = browser.close.bind(browser);
           browser.close = async () => {
             await close();
             writeFileSync(${JSON.stringify(join(directory, 'browser-closed'))}, String(!browser.isConnected()));
             writeFileSync(${JSON.stringify(directory)} + '/browser-' + id + '.closed', String(!browser.isConnected()));
             if (${failClose}) throw new Error('FAULT_INJECTED_BROWSER_CLOSE_FAILURE');
           };
           return browser;
         }};`,
          );
          const child = await executeDriver(
            {
              cwd: directory,
              env: {
                ...process.env,
                AF_PLAYWRIGHT_PATH: toolShim,
                AF_BACKEND_APP: backend,
                AF_BROWSER_PORT: String(port),
                CHROMIUM_PATH: resolve(chrome),
              },
              stdio: ['ignore', 'pipe', 'pipe'],
            },
            hang ? 5_000 : journey ? 240_000 : 30_000,
          );
          if (hang) {
            assert.equal(await readFile(join(directory, 'timeout-ready'), 'utf8'), 'ready');
            assert.match(child.error?.message ?? '', /outer execution budget/);
            assert.equal(
              existsSync(join(directory, 'browser-disconnected')),
              true,
              'timeout must close the actual detached browser',
            );
            await reservePort(port);
            assert.doesNotMatch(child.stdout, /PASSED/);
            return;
          }
          assert.equal(child.error, undefined, `${child.error?.message}\n${child.stderr}`);
          assert.equal(child.signal, null, child.stderr);
          assert.equal(child.status, journey && !failClose ? 0 : 1, child.stderr);
          if (!journey) assert.equal(await readFile(join(directory, 'page-closed'), 'utf8'), 'true');
          assert.equal(await readFile(join(directory, 'browser-closed'), 'utf8'), 'true');
          assert.equal(existsSync(join(directory, 'app-closed')), true, 'actual app onClose must execute');
          await reservePort(port);
          const evidenceRoot = join(directory, '.checks/AF-UI01');
          const runs = await readdir(evidenceRoot);
          assert.equal(runs.length, 1);
          const resultFile = join(evidenceRoot, runs[0], 'result.json');
          assert.equal(
            existsSync(resultFile),
            true,
            'FAILED report must survive a closed-page diagnostic failure',
          );
          const result = JSON.parse(await readFile(resultFile, 'utf8'));
          if (journey) {
            for (const marker of [
              'ledger.sqlite.closed',
              'storage-ledger.sqlite.closed',
              'browser-1.closed',
              'browser-2.closed',
            ])
              assert.ok(existsSync(join(directory, marker)), marker + ' confirms each owned resource closed');
          }
          if (journey)
            assert.ok(result.checks.length >= 17, 'the actual full journey must finish its assertions');
          if (journey && !failClose) {
            assert.equal(result.status, 'PASSED');
            assert.equal(JSON.parse(child.stdout).status, 'PASSED');
          } else {
            const expected = journey
              ? /FAULT_INJECTED_BROWSER_CLOSE_FAILURE/
              : /FAULT_INJECTED_ORIGINAL_BROWSER_FAILURE/;
            assert.equal(result.status, 'FAILED');
            assert.match(result.error, expected);
            assert.match(child.stderr, expected);
            if (!journey) assert.doesNotMatch(child.stderr, /Error: FAULT_INJECTED_BROWSER_CLOSE_FAILURE/);
            assert.doesNotMatch(child.stdout, /PASSED/);
          }
        }),
      ),
    );
  },
);

test('FAULT_INJECTED real M3 page rejects missing serialized evidence and removes its handlers', async (t) => {
  assert.ok(approvedBrowserTool, 'Approved browser tool is required');
  assert.ok(process.env.CHROMIUM_PATH, 'Approved browser executable is required');
  const directory = await mkdtemp(join(tmpdir(), 'alphaforge-m3-evidence-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { chromium } = await import(pathToFileURL(resolve(approvedBrowserTool)).href);
  const { createServer: createViteServer } = await import('vite');
  const server = await createViteServer({
    root: join(root, 'apps/web'),
    configFile: join(root, 'apps/web/vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    const origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ executablePath: resolve(process.env.CHROMIUM_PATH), headless: true });
    const context = await browser.newContext();
    context.setDefaultTimeout(10000);
    const bootstrap = await qualifiedBrowserBootstrap(root, ['tools/verify-m3-browser.mjs']);
    if (bootstrap) await context.addInitScript({ content: bootstrap });
    const page = await context.newPage();
    const goto = page.goto.bind(page);
    page.goto = async (...args) => {
      const result = await goto(...args);
      await page.locator('[data-m3-fixture-controls]').waitFor();
      // Change only the public serialized DOM input, never the driver or fixture state.
      await page.evaluate(`(() => {
        const controls = document.querySelector('[data-m3-fixture-controls]');
        const remove = () => controls.removeAttribute('data-m3-fixture-evidence');
        new MutationObserver(remove).observe(controls, { attributes: true, attributeFilter: ['data-m3-fixture-evidence'] });
        remove();
      })()`);
      return result;
    };
    await assert.rejects(
      runM3BrowserJourneys(page, { origin, evidenceDirectory: directory }),
      /M3_BROWSER_EVIDENCE_UNAVAILABLE/,
    );
    assert.equal(page.listenerCount('pageerror'), 0);
    assert.equal(page.listenerCount('console'), 0);
    assert.equal(existsSync(join(directory, 'result.json')), false);
    assert.equal(page.isClosed(), false, 'the exported journey leaves ownership with its caller');
  } finally {
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => browser?.close()),
      Promise.resolve().then(() => server.close()),
    ]);
    const failure = cleanup.find((result) => result.status === 'rejected');
    assert.equal(failure, undefined, failure?.reason?.message);
  }
});
