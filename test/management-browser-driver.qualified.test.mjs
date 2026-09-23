import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { verifyInstallation } from '../tools/coverage/toolchain.mjs';
import { qualifiedBrowserBootstrap } from './helpers/qualified-browser-bootstrap.mjs';

const repository = resolve(import.meta.dirname, '..');
// Always execute the actual driver, even though its working directory is a private fixture.
const driver = resolve(repository, 'tools/verify-management-browser.mjs');
const defaultChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-management-driver-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/management'), { recursive: true });
  cpSync(resolve(repository, 'docs/management/dashboard'), join(root, 'docs/management/dashboard'), {
    recursive: true,
  });
  for (const name of ['task-board.html', 'task-board.js', 'task-board.css'])
    copyFileSync(resolve(repository, 'docs', name), join(root, 'docs', name));
  writeFileSync(join(root, '.gitignore'), '.checks/\n');
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  git('init', '-q');
  git('-c', 'user.name=AlphaForge fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.');
  git(
    '-c',
    'user.name=AlphaForge fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'Local browser fixture',
  );
  const head = git('rev-parse', 'HEAD');
  const sourceHash = digest(driver);
  t.after(() => assert.equal(digest(driver), sourceHash, 'the real driver must remain unchanged'));
  return { root, env, head, receipt: join(root, '.checks/pr11/management-browser.json') };
}

async function runDriver(f, env) {
  const child = spawn(process.execPath, [driver], {
    cwd: f.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let cleanupRetired = false;
  const terminateOnce = () => {
    if (cleanupRetired) return;
    // Retire the numeric process identity before attempting cleanup, including ESRCH
    // and other failures. A later finally must never target a potentially reused PID.
    cleanupRetired = true;
    if (!child.pid) return;
    if (process.platform === 'win32') {
      if (child.exitCode === null && child.signalCode === null)
        execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          timeout: 5_000,
          killSignal: 'SIGKILL',
        });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  child.stdout.on('data', (data) => (stdout += data));
  child.stderr.on('data', (data) => (stderr += data));
  let rejectCompletion;
  const completion = new Promise((done, reject) => {
    rejectCompletion = reject;
    child.once('error', reject);
    child.once('close', (status, signal) => done({ status, signal }));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      terminateOnce();
    } catch (error) {
      // Return cleanup failures through the awaited test, never as timer exceptions.
      rejectCompletion(error);
    }
  }, 100_000);
  try {
    const result = await completion;
    assert.equal(timedOut, false, `driver timed out\n${stderr}`);
    assert.equal(result.signal, null, stderr);
    return { ...result, stdout, stderr };
  } finally {
    clearTimeout(timer);
    terminateOnce();
  }
}

function browserModule() {
  const directory = process.env.AF_QUALIFIED_BROWSER_TOOLS;
  assert.ok(directory, 'AF_QUALIFIED_BROWSER_TOOLS is required; missing tools are not a PASS');
  const root = realpathSync(resolve(directory));
  const lock = JSON.parse(readFileSync(resolve(repository, 'planning/coverage-toolchain.lock.json')));
  assert.equal(process.versions.node, lock.node);
  verifyInstallation(root, lock.browser.installedFiles);
  return pathToFileURL(join(root, 'index.mjs')).href;
}

async function observeRealBrowser(f, mode) {
  const realModule = browserModule();
  const bootstrap = await qualifiedBrowserBootstrap(repository, ['tools/verify-management-browser.mjs']);
  const observer = join(f.root, '.checks/driver-observer.mjs');
  const observation = join(f.root, '.checks/driver-observation.json');
  mkdirSync(dirname(observer), { recursive: true });
  // This wrapper delegates launch, page creation and navigation to real Playwright.
  // It never replaces the driver's console listener, assertions, or error collection.
  writeFileSync(
    observer,
    `import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Server} from 'node:http';
import {chromium as realChromium} from ${JSON.stringify(realModule)};
const observation = {mode: ${JSON.stringify(mode)}, consoleMessages: [], closed: false};
const coverageBootstrap = ${JSON.stringify(bootstrap)};
const save = () => writeFileSync(${JSON.stringify(observation)}, JSON.stringify(observation));
const originalListen = Server.prototype.listen;
Server.prototype.listen = function(...args) {
  this.once('close', () => { observation.serverClosed = true; save(); });
  return originalListen.apply(this, args);
};
export const chromium = {launch: async (options) => {
  observation.executablePath = options.executablePath;
  save();
  const browser = await realChromium.launch(options);
  observation.version = browser.version();
  const close = browser.close.bind(browser);
  browser.close = async (...args) => {
    await close(...args);
    observation.closed = !browser.isConnected();
    save();
    if (observation.mode.endsWith('close-error')) throw new Error('FIXTURE_BROWSER_CLOSE_FAILURE');
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    if (coverageBootstrap) await page.addInitScript({content: coverageBootstrap});
    page.on('console', message => {
      observation.consoleMessages.push({type: message.type(), text: message.text()});
      save();
    });
    if (observation.mode.startsWith('csp')) {
      const goto = page.goto.bind(page);
      let injected = false;
      page.goto = async (...navigation) => {
        const response = await goto(...navigation);
        if (!injected) {
          injected = true;
          const violation = page.waitForEvent('console', {
            predicate: message => /Executing inline script violates/.test(message.text()),
            timeout: 10000,
          });
          const securityViolation = page.evaluate(() => new Promise(resolveViolation => {
            globalThis.document.addEventListener('securitypolicyviolation', event => {
              resolveViolation({directive: event.effectiveDirective, blocked: event.blockedURI});
            }, {once: true});
            const script = globalThis.document.createElement('script');
            script.textContent = 'globalThis.__alphaForgeForbiddenInline = true';
            globalThis.document.body.append(script);
          }));
          const [message, event] = await Promise.all([violation, securityViolation]);
          observation.violation = {text: message.text(), ...event};
          observation.markerAbsent = await page.evaluate(() =>
            !Object.hasOwn(globalThis, '__alphaForgeForbiddenInline'));
          save();
          assert.equal(observation.markerAbsent, true);
          assert.equal(event.blocked, 'inline');
          assert.match(event.directive, /^script-src/);
        }
        return response;
      };
    }
    return page;
  };
  return browser;
}};
`,
  );
  return { observer, observation };
}

// Regression: missing prerequisites must fail closed before any PASS receipt is written.
test('management driver rejects missing and empty Playwright paths without publishing PASS', async (t) => {
  const f = fixture(t);
  for (const value of [undefined, '']) {
    const env = { ...f.env };
    delete env.AF_PLAYWRIGHT_PATH;
    if (value !== undefined) env.AF_PLAYWRIGHT_PATH = value;
    const child = await runDriver(f, env);
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /AF_PLAYWRIGHT_PATH is required/);
    assert.equal(child.stdout, '');
    assert.equal(existsSync(f.receipt), false);
  }
});

// Regression: omitting the override on native macOS must still launch the default browser
// and complete the real dashboard/planning journey with an accurately bound receipt.
test(
  'management driver completes its real journey using the default macOS Chrome path',
  {
    skip: process.platform !== 'darwin' && 'default Chrome installation is a macOS-only contract',
    timeout: 120_000,
  },
  async (t) => {
    assert.ok(existsSync(defaultChrome), 'approved default Chrome installation required');
    const f = fixture(t);
    const observed = await observeRealBrowser(f, 'default');
    const env = { ...f.env, AF_PLAYWRIGHT_PATH: observed.observer };
    delete env.AF_CHROME_PATH;
    const child = await runDriver(f, env);
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'PASS');
    assert.equal(result.head, f.head);
    assert.equal(result.workingTreeClean, true);
    assert.ok(result.checks.includes('Reload, no page errors or CSP violations'));
    assert.ok(result.checks.some((check) => check.startsWith('Active planning task board')));
    assert.deepEqual(JSON.parse(readFileSync(f.receipt)), result);
    const observation = JSON.parse(readFileSync(observed.observation));
    assert.equal(observation.executablePath, defaultChrome);
    assert.equal(observation.closed, true);
    assert.match(observation.version, /^\d+\./);
    t.diagnostic(`Real default Chrome ${observation.version}; fixture receipt matched actual Git HEAD`);
  },
);

// Regression: ignoring a real CSP violation must not let this driver publish a false PASS.
test(
  'management driver rejects a real blocked inline script and leaves no PASS receipt',
  { timeout: 120_000 },
  async (t) => {
    assert.ok(process.env.CHROMIUM_PATH, 'CHROMIUM_PATH is required for the qualified CSP journey');
    const f = fixture(t);
    const observed = await observeRealBrowser(f, 'csp');
    const child = await runDriver(f, {
      ...f.env,
      AF_PLAYWRIGHT_PATH: observed.observer,
      AF_CHROME_PATH: process.env.CHROMIUM_PATH,
    });
    assert.ok(existsSync(observed.observation), `browser never launched\n${child.stderr}`);
    const observation = JSON.parse(readFileSync(observed.observation));
    assert.equal(observation.markerAbsent, true, 'the actual browser must block the inline side effect');
    assert.equal(observation.violation.blocked, 'inline');
    assert.match(observation.violation.directive, /^script-src/);
    assert.ok(observation.consoleMessages.some((message) => message.text === observation.violation.text));
    assert.match(observation.violation.text, /Content Security Policy/i);
    assert.doesNotMatch(observation.violation.text, /frame-ancestors/);
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /AssertionError/);
    assert.match(child.stderr, /operator: 'deepStrictEqual'/);
    assert.match(child.stderr, /expected: \[\]/);
    assert.match(child.stderr, /Executing inline script violates/);
    assert.match(child.stderr, /verify-management-browser\.mjs/);
    assert.equal(child.stdout, '');
    assert.equal(existsSync(f.receipt), false);
    assert.equal(observation.closed, true);
    t.diagnostic(`Real CSP rejection: ${observation.violation.text}`);
  },
);

// A late cleanup failure must invalidate success, and must not hide an earlier
// real CSP rejection. The browser is actually closed before injecting the error.
test(
  'management driver refuses PASS on cleanup failure and preserves a prior real CSP rejection',
  { timeout: 180_000 },
  async (t) => {
    assert.ok(process.env.CHROMIUM_PATH, 'CHROMIUM_PATH is required for qualified cleanup journeys');
    for (const mode of ['close-error', 'csp-close-error']) {
      const f = fixture(t);
      const observed = await observeRealBrowser(f, mode);
      const child = await runDriver(f, {
        ...f.env,
        AF_PLAYWRIGHT_PATH: observed.observer,
        AF_CHROME_PATH: process.env.CHROMIUM_PATH,
      });
      const observation = JSON.parse(readFileSync(observed.observation));
      assert.equal(child.status, 1, child.stderr);
      assert.equal(child.stdout, '', 'cleanup failure must never publish a success result');
      assert.equal(existsSync(f.receipt), false, 'cleanup failure must never leave a PASS receipt');
      assert.equal(observation.closed, true, 'real Chrome must be closed');
      assert.equal(observation.serverClosed, true, 'server close must still run after browser close throws');
      if (mode === 'close-error') assert.match(child.stderr, /FIXTURE_BROWSER_CLOSE_FAILURE/);
      else {
        assert.equal(observation.markerAbsent, true);
        assert.equal(observation.violation.blocked, 'inline');
        assert.match(child.stderr, /Executing inline script violates/);
        assert.match(child.stderr, /AssertionError/);
        assert.doesNotMatch(child.stderr, /FIXTURE_BROWSER_CLOSE_FAILURE/);
      }
    }
  },
);

test(
  'management driver closes its real server when the configured Chrome executable is unavailable',
  { timeout: 120_000 },
  async (t) => {
    const f = fixture(t);
    const observed = await observeRealBrowser(f, 'launch-error');
    const missing = join(f.root, 'missing-chrome');
    assert.equal(existsSync(missing), false);
    const child = await runDriver(f, {
      ...f.env,
      AF_PLAYWRIGHT_PATH: observed.observer,
      AF_CHROME_PATH: missing,
    });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /executable doesn't exist/);
    assert.equal(child.stdout, '');
    assert.equal(existsSync(f.receipt), false);
    const observation = JSON.parse(readFileSync(observed.observation));
    assert.equal(observation.executablePath, missing);
    assert.equal(observation.serverClosed, true);
  },
);

test(
  'management driver archives a prior receipt before a failed rerun or missing tool prerequisite',
  { timeout: 180_000 },
  async (t) => {
    const f = fixture(t);
    const archives = join(f.root, '.checks/pr11/history');
    for (const mode of ['close-error', 'missing-tools', 'import-error']) {
      const first = await observeRealBrowser(f, 'default');
      const good = await runDriver(f, {
        ...f.env,
        AF_PLAYWRIGHT_PATH: first.observer,
        AF_CHROME_PATH: process.env.CHROMIUM_PATH,
      });
      assert.equal(good.status, 0, good.stderr);
      const previous = readFileSync(f.receipt);
      assert.equal(JSON.parse(previous).status, 'PASS');
      const before = new Set(existsSync(archives) ? readdirSync(archives) : []);
      const env = { ...f.env, AF_CHROME_PATH: process.env.CHROMIUM_PATH };
      if (mode === 'close-error') env.AF_PLAYWRIGHT_PATH = (await observeRealBrowser(f, mode)).observer;
      else if (mode === 'import-error') env.AF_PLAYWRIGHT_PATH = join(f.root, 'missing-browser-module.mjs');
      else delete env.AF_PLAYWRIGHT_PATH;
      const bad = await runDriver(f, env);
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(
        bad.stderr,
        mode === 'close-error'
          ? /FIXTURE_BROWSER_CLOSE_FAILURE/
          : mode === 'missing-tools'
            ? /AF_PLAYWRIGHT_PATH is required/
            : /ERR_MODULE_NOT_FOUND/,
      );
      assert.equal(bad.stdout, '');
      assert.equal(existsSync(f.receipt), false, 'a previous PASS must not remain as the current receipt');
      const added = readdirSync(archives).filter((name) => !before.has(name));
      assert.equal(added.length, 1);
      assert.match(added[0], /^management-browser-[a-f0-9-]+\.json$/);
      assert.deepEqual(
        readFileSync(join(archives, added[0])),
        previous,
        'archive preserves the exact prior evidence',
      );
      for (const name of before) assert.ok(existsSync(join(archives, name)), 'earlier history remains');
    }
  },
);
