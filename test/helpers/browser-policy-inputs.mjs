/* global document */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importUserUI } from '../../tools/import-user-ui.mjs';
import { qualifiedBrowserBootstrap } from './qualified-browser-bootstrap.mjs';

const root = resolve(import.meta.dirname, '../..');
const browserTool =
  process.env.AF_PLAYWRIGHT_PATH ||
  (process.env.AF_QUALIFIED_BROWSER_TOOLS && join(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs'));
export const serializeError = (error) =>
  error && {
    name: error.name,
    code: error.code,
    message: error.message,
    stack: error.stack,
    actual: error.actual,
    expected: error.expected,
  };
const save = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');

export async function bounded(promise, milliseconds, onTimeout = async () => {}) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('POLICY_SCENARIO_TIMEOUT_NOT_TARGET_SUCCESS'));
          Promise.resolve()
            .then(onTimeout)
            .catch(() => {});
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function scenario(t, name, run) {
  assert.equal(process.versions.node, '24.21.0', 'BLOCKED: approved Node runtime required');
  assert.ok(browserTool && existsSync(browserTool), 'NOT_RUN: approved browser tool required');
  assert.ok(
    process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH),
    'NOT_RUN: approved Chrome required',
  );
  const output = join(root, '.checks/browser-policy-inputs');
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, name + '-'));
  t.diagnostic(`Retained policy evidence: ${directory}`);
  const sourceHashes = {};
  for (const file of ['tools/verify-ui-browser.mjs', 'tools/verify-m3-browser.mjs']) {
    sourceHashes[file] = createHash('sha256')
      .update(await readFile(join(root, file)))
      .digest('hex');
  }
  const s = {
    directory,
    nonce: 'af-policy-' + randomUUID(),
    cleanup: [],
    receipt: {
      name,
      classification:
        name === 'm3-other-origin' ? 'CONTROLLED_SECOND_LOOPBACK_NAVIGATION' : 'CONTROLLED_NATIVE_CSP_INPUT',
      state: 'NOT_RUN',
      sourceHashes,
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      node: process.versions.node,
      nodeExecutable: process.execPath,
      browserTool: resolve(browserTool),
      chrome: resolve(process.env.CHROMIUM_PATH),
      cleanup: {},
    },
  };
  let primary;
  try {
    await run(s);
  } catch (error) {
    primary = error;
    s.receipt.harnessError = serializeError(error);
  }
  const cleanupErrors = [];
  for (const [label, close] of s.cleanup.reverse()) {
    try {
      await bounded(Promise.resolve().then(close), 10_000);
      s.receipt.cleanup[label] = 'CLOSED';
    } catch (error) {
      cleanupErrors.push(error);
      s.receipt.cleanup[label] = serializeError(error);
    }
  }
  s.receipt.state = !primary && !cleanupErrors.length ? 'EXPECTED_NEGATIVE_PASS' : 'FAILED';
  await save(join(directory, 'policy-receipt.json'), s.receipt);
  if (primary) throw primary;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Policy scenario cleanup failed');
}

// Every source byte is copied from this checkout. Vite caches, build output and
// SQLite live in this scenario; no edits to the tracked UI or another worker's files.
export async function prepareWeb(s, production) {
  await cp(join(root, 'tsconfig.json'), join(s.directory, 'tsconfig.json'));
  await cp(join(root, 'package.json'), join(s.directory, 'package.json'));
  await cp(join(root, 'apps/web'), join(s.directory, 'apps/web'), {
    recursive: true,
    filter: (path) => !['dist', 'node_modules', '.vite'].includes(path.split(/[\\/]/).at(-1)),
  });
  await cp(join(root, 'packages'), join(s.directory, 'packages'), { recursive: true });
  const source = await readFile(join(root, 'apps/web/prototype/AlphaForge_v3_EN.html'), 'utf8');
  await importUserUI(source, join(s.directory, 'apps/web'), join(s.directory, 'build/ui-import'));
  if (production) {
    // Vite build sets process.env.NODE_ENV. Keep that in a child so the later
    // real development fixture still sees DEV, regardless of test ordering.
    const configuration = {
      root: join(s.directory, 'apps/web'),
      configFile: join(s.directory, 'apps/web/vite.config.ts'),
      logLevel: 'error',
      publicDir: false,
    };
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { build } = await import(${JSON.stringify(import.meta.resolve('vite'))}); await build(${JSON.stringify(configuration)});`,
      ],
      { cwd: s.directory, timeout: 30_000, stdio: 'pipe' },
    );
  }
}

async function listen(server) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return server.address().port;
}
async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
}
async function availablePort(port = 0) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  const actual = server.address().port;
  await closeServer(server);
  return actual;
}

// The only inserted script sets a boolean. Chromium supplies both observations;
// this helper never emits a console message or invokes the driver's listener.
export async function injectInlinePolicy(target, page, nonce) {
  const consolePromise = page.waitForEvent('console', {
    predicate: (message) =>
      /Executing inline script violates|Refused to execute inline script/i.test(message.text()),
    timeout: 10_000,
  });
  const eventPromise = target.evaluate(
    (marker) =>
      new Promise((done, reject) => {
        const listener = (event) => {
          if (event.blockedURI !== 'inline' || !event.effectiveDirective.startsWith('script-src')) return;
          clearTimeout(timer);
          document.removeEventListener('securitypolicyviolation', listener);
          done({
            blockedURI: event.blockedURI,
            effectiveDirective: event.effectiveDirective,
            disposition: event.disposition,
            originalPolicy: event.originalPolicy,
          });
        };
        const timer = setTimeout(() => {
          document.removeEventListener('securitypolicyviolation', listener);
          reject(new Error('NATIVE_CSP_EVENT_NOT_OBSERVED'));
        }, 10_000);
        document.addEventListener('securitypolicyviolation', listener);
        const script = document.createElement('script');
        script.textContent = 'globalThis[' + JSON.stringify(marker) + '] = true';
        document.body.append(script);
      }),
    nonce,
  );
  const [message, event] = await Promise.all([consolePromise, eventPromise]);
  return {
    nonce,
    console: message.text(),
    event,
    markerPresent: await target.evaluate((marker) => Object.hasOwn(globalThis, marker), nonce),
  };
}

export async function openM3(s) {
  const { chromium } = await import(pathToFileURL(resolve(browserTool)).href);
  const { createServer: createViteServer } = await import('vite');
  let requests = 0;
  const targetPath = '/' + s.nonce;
  const other = createServer((request, response) => {
    if (request.url === targetPath) {
      requests++;
      response.setHeader('content-type', 'text/html');
      response.end('<body>' + s.nonce + '</body>');
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  const otherPort = await listen(other);
  s.cleanup.push(['secondServer', () => closeServer(other)]);
  const policyPath = '/policy/' + s.nonce;
  const server = await createViteServer({
    root: join(s.directory, 'apps/web'),
    configFile: join(s.directory, 'apps/web/vite.config.ts'),
    publicDir: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: true },
    plugins: [
      {
        name: 'test-only-same-origin-policy-document',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== policyPath) return next();
            response.setHeader('content-type', 'text/html');
            response.setHeader('Content-Security-Policy', "script-src 'none'");
            response.end('<!doctype html><body>Controlled policy input</body>');
          });
        },
      },
    ],
  });
  s.cleanup.push(['vite', () => server.close()]);
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const browser = await chromium.launch({
    executablePath: resolve(process.env.CHROMIUM_PATH),
    headless: true,
  });
  s.receipt.browserVersion = browser.version();
  s.cleanup.push([
    'browser',
    async () => {
      await browser.close();
      assert.equal(browser.isConnected(), false);
    },
  ]);
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(10_000);
  const bootstrap = await qualifiedBrowserBootstrap(root, ['tools/verify-m3-browser.mjs']);
  if (bootstrap) await context.addInitScript({ content: bootstrap });
  const page = await context.newPage();
  s.receipt.browserObservations = { console: [], pageerror: [] };
  page.on('console', (message) =>
    s.receipt.browserObservations.console.push({ type: message.type(), text: message.text() }),
  );
  page.on('pageerror', (error) => s.receipt.browserObservations.pageerror.push(serializeError(error)));
  s.cleanup.push([
    'pageDiagnostics',
    async () => {
      if (s.receipt.harnessError && !page.isClosed()) {
        await page.screenshot({ path: join(s.directory, 'failure.png') });
        await writeFile(join(s.directory, 'failure.html'), await page.content());
      }
    },
  ]);
  const otherURL = 'http://127.0.0.1:' + otherPort + targetPath;
  Object.assign(s.receipt, { origin, otherURL, policyURL: origin + policyPath });
  return { page, origin, otherURL, policyURL: origin + policyPath, requestCount: () => requests };
}

export async function runUi(s) {
  const port = await availablePort();
  s.verifyPortReleased = () => availablePort(port);
  const backend = join(s.directory, 'backend.mjs');
  const shim = join(s.directory, 'playwright-boundary.mjs');
  const bootstrap = await qualifiedBrowserBootstrap(root, ['tools/verify-ui-browser.mjs']);
  await writeFile(
    backend,
    `import { buildApp as actual } from ${JSON.stringify(pathToFileURL(join(root, 'apps/server/src/app.ts')).href)};
import { writeFileSync } from 'node:fs';
export async function buildApp(options) {
  const result = await actual(options);
  result.app.addHook('onClose', async () => writeFileSync(${JSON.stringify(join(s.directory, 'app-closed'))}, 'closed'));
  return result;
}`,
  );
  await writeFile(
    shim,
    `import { chromium as actual } from ${JSON.stringify(pathToFileURL(resolve(browserTool)).href)};
import { injectInlinePolicy, serializeError } from ${JSON.stringify(import.meta.url)};
import { writeFileSync } from 'node:fs';
const directory = ${JSON.stringify(s.directory)};
process.on('uncaughtExceptionMonitor', error => writeFileSync(directory + '/original-error.json', JSON.stringify(serializeError(error))));
let inserted = false;
export const chromium = { async launch(options) {
  const browser = await actual.launch(options);
  writeFileSync(directory + '/browser-version', browser.version());
  browser.once('disconnected', () => writeFileSync(directory + '/browser-disconnected', 'closed'));
  process.once('SIGTERM', () => {
    const timer = setTimeout(() => process.exit(125), 3000);
    browser.close().then(() => { clearTimeout(timer); process.exit(124); }, () => { clearTimeout(timer); process.exit(125); });
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
      const goto = page.goto.bind(page);
      page.goto = async (...args) => {
        const response = await goto(...args);
        if (!inserted) {
          inserted = true;
          const policy = await injectInlinePolicy(page, page, ${JSON.stringify(s.nonce)});
          policy.header = response.headers()['content-security-policy'];
          policy.url = response.url();
          writeFileSync(directory + '/policy.json', JSON.stringify(policy));
        }
        return response;
      };
      return page;
    };
    return context;
  };
  return browser;
}};`,
  );
  return executeDriver(
    {
      cwd: s.directory,
      env: {
        ...process.env,
        AF_BACKEND_APP: backend,
        AF_PLAYWRIGHT_PATH: shim,
        AF_BROWSER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    300_000,
  );
}

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
