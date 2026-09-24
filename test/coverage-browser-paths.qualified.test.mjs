import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { prepareCoverage } from '../tools/coverage/prepare.mjs';
import { collectBrowserCoverage } from '../tools/coverage/browser.mjs';
import { collectNodeWorkflow } from '../tools/coverage/collect.mjs';
import { reportCoverage } from '../tools/coverage/report.mjs';
import { collectManagementBrowserCoverage } from '../tools/coverage/browser-legacy.mjs';
import { loadCoverageTools } from '../tools/coverage/toolchain.mjs';
import { replayBrowserCoverage } from '../tools/coverage/browser-evidence.mjs';
const repository = resolve(import.meta.dirname, '..');
const instrumentationDirectory = process.env.AF_QUALIFIED_COVERAGE_TOOLS;
const browserDirectory = process.env.AF_QUALIFIED_BROWSER_TOOLS;
assert.ok(
  instrumentationDirectory && browserDirectory && process.env.CHROMIUM_PATH,
  'qualified browser inputs required',
);

async function fixture(t, external = false, managementMode = null) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-browser-paths-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tools'), { recursive: true });
  cpSync(join(repository, 'tools/coverage'), join(root, 'tools/coverage'), { recursive: true });
  copyFileSync(join(repository, 'tools/html-source-ranges.mjs'), join(root, 'tools/html-source-ranges.mjs'));
  cpSync(join(repository, 'node_modules'), join(root, 'node_modules'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  mkdirSync(join(root, 'planning'));
  for (const file of ['coverage-toolchain.lock.json', 'coverage-instrumentation.package-lock.json'])
    copyFileSync(join(repository, 'planning', file), join(root, 'planning', file));
  for (const chunk of JSON.parse(readFileSync(join(repository, 'planning/coverage-toolchain.lock.json')))
    .instrumentation.installedFileChunks)
    copyFileSync(join(repository, chunk.path), join(root, chunk.path));
  mkdirSync(join(root, 'apps/web/prototype'), { recursive: true });
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\noutputs/\n');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'apps/web/vite.config.ts'), 'export default {};\n');
  writeFileSync(
    join(root, 'apps/web/index.html'),
    '<!doctype html><title>Coverage fixture</title><link rel="stylesheet" href="/user-ui.css"><script src="/user-ui.js"></script>',
  );
  writeFileSync(
    join(root, 'apps/web/prototype/AlphaForge_v3_EN.html'),
    '<style>body{color:black}</style><script>globalThis.choose = x => x ? 7 : 9;</script>',
  );
  writeFileSync(
    join(root, 'tools/verify-m3-browser.mjs'),
    `
import assert from 'node:assert/strict';
export async function runM3BrowserJourneys(page,{origin}) {
 page.setDefaultTimeout(8000);
 await page.goto(origin);
 await page.waitForFunction(()=>typeof globalThis.choose==='function');
 assert.equal(await page.evaluate(()=>globalThis.choose(false)),9);
 ${
   external
     ? `
 await page.evaluate(async()=>{
   await fetch('https://blocked.invalid/coverage-boundary').then(()=>{throw new Error('unexpected external success');},()=>{});
   const socket=new WebSocket('wss://blocked.invalid/coverage-boundary');
   await new Promise(resolve=>{socket.onclose=resolve;socket.onerror=resolve;});
 });`
     : ''
 }
 return {state:'PASS',checks:['original fixture branch returns nine']};
}
`,
  );
  if (managementMode) {
    mkdirSync(join(root, 'docs/management/dashboard'), { recursive: true });
    writeFileSync(
      join(root, 'docs/management/dashboard/app.js'),
      'globalThis.choose = value => value ? 7 : 9;\n',
    );
    writeFileSync(
      join(root, 'tools/verify-management-browser.mjs'),
      `import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.AF_PLAYWRIGHT_PATH).href);
const browsers = [];
const pages = [];
try {
  for (let index = 0; index < 2; index++) {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
    browsers.push(browser);
    const page = await (await browser.newContext()).newPage();
    pages.push(page);
    await page.addScriptTag({ content: readFileSync('docs/management/dashboard/app.js', 'utf8') });
    assert.equal(await page.evaluate('choose(true)'), 7);
  }
  if (${JSON.stringify(managementMode)} === 'sequential') {
    await browsers[0].close();
    assert.equal(browsers[0].isConnected(), false);
    assert.equal(browsers[1].isConnected(), true);
    assert.equal(await pages[1].evaluate('choose(false)'), 9);
  }
  if (${JSON.stringify(managementMode)} === 'invalid-graph')
    await pages[0].evaluate('globalThis.__coverage__ = { foreign: {} }');
} finally {
  const results = await Promise.allSettled(browsers.map(browser => browser.close()));
  // Save observations before the test-only emergency cleanup. A leaked browser
  // must fail the test even though this fallback keeps the host clean after RED.
  writeFileSync('closure.json', JSON.stringify({
    connected: browsers.map(browser => browser.isConnected()),
    errors: results.filter(result => result.status === 'rejected').map(result => result.reason.message),
  }));
  for (const browser of browsers) if (browser.isConnected()) {
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => {});
  }
  for (const browser of browsers) await browser.close().catch(() => {});
  await assert.rejects(chromium.launch({ executablePath: process.env.CHROMIUM_PATH }), /lifecycle is finished/);
  for (const browser of browsers) await assert.rejects(browser.newContext(), /closing or finished/);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw failures[0].reason;
}
`,
    );
  }
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Coverage fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'browser boundary fixture');
  const options = { sourceBase: git('rev-parse', 'HEAD'), instrumentationDirectory, browserDirectory };
  const prepared = await prepareCoverage(root, options);
  return {
    root,
    options,
    prepared,
    manifest: JSON.parse(readFileSync(join(prepared.directory, 'manifest.json'))),
    generated: JSON.parse(readFileSync(join(prepared.directory, 'generated.json'))),
    tools: await loadCoverageTools(root, options),
  };
}

test('browser collector uses the reviewed executable fallback and retains local transformed source counters', async (t) => {
  const f = await fixture(t);
  const result = await collectBrowserCoverage({ ...f, outputDirectory: join(f.root, 'outputs/direct') });
  assert.equal(result.workflowResult.state, 'PASS');
  const replay = replayBrowserCoverage({
    manifest: f.manifest,
    outputDirectory: result.directory,
    index: result.index,
  });
  assert.ok(
    replay.observations.some(
      (row) => row.complete && row.sources['apps/web/prototype/AlphaForge_v3_EN.html'],
    ),
  );
  const altered = structuredClone(f.generated);
  altered['apps/web/prototype/AlphaForge_v3_EN.html'].code += '\n';
  await assert.rejects(
    collectBrowserCoverage({ ...f, generated: altered, outputDirectory: join(f.root, 'outputs/invalid') }),
    (error) => {
      assert.match(error.errors[0].message, /changed generated source/);
      assert.ok(error.browserCoverage.failure);
      assert.equal(error.browserCoverage.index, undefined);
      return true;
    },
  );
});

test('direct browser collection retains a replayable failure when HTTP and WebSocket leave loopback', async (t) => {
  const f = await fixture(t, true);
  await assert.rejects(
    collectBrowserCoverage({ ...f, outputDirectory: join(f.root, 'outputs/direct-blocked') }),
    (error) => {
      const { directory, failure, index } = error.browserCoverage;
      const raw = JSON.parse(readFileSync(join(directory, failure.file)));
      assert.deepEqual(raw.blockedRequests, ['https://blocked.invalid', 'wss://blocked.invalid']);
      assert.ok(raw.errors.some((row) => /unexpected browser network activity/.test(row.message)));
      assert.ok(
        replayBrowserCoverage({ manifest: f.manifest, outputDirectory: directory, index }).observations
          .length,
      );
      return true;
    },
  );
});

for (const mode of ['default-pass', 'default-fail', 'explicit-fail'])
  test(`browser CLI receipt and report bind actual local routing outcome: ${mode}`, async (t) => {
    const failing = mode !== 'default-pass';
    const f = await fixture(t, failing);
    const configuration = {
      id: 'm3-browser',
      args: [
        'tools/coverage/run-browser.mjs',
        '--tools',
        instrumentationDirectory,
        '--browser-tools',
        browserDirectory,
        '--chrome',
        process.env.CHROMIUM_PATH,
        '--base',
        f.options.sourceBase,
        ...(mode === 'explicit-fail' ? ['--workflow', 'm3'] : []),
      ],
    };
    const run = await collectNodeWorkflow(f.root, f.prepared.directory, {
      ...f.options,
      ...configuration,
      timeoutMs: 30000,
      artifactFiles: ['browser-receipt.json'],
    });
    assert.equal(run.state, failing ? 'FAIL' : 'PASS');
    const receipt = JSON.parse(readFileSync(join(run.directory, 'browser-receipt.json')));
    assert.equal(receipt.workflow, 'm3');
    assert.equal(receipt.candidateCommit, f.manifest.candidateCommit);
    assert.equal(receipt.manifestSha256, f.prepared.manifestSha256);
    if (failing) {
      const failure = JSON.parse(readFileSync(join(receipt.directory, receipt.failure.file)));
      assert.deepEqual(failure.blockedRequests, ['https://blocked.invalid', 'wss://blocked.invalid']);
      assert.ok(failure.errors.some((error) => /unexpected browser network activity/.test(error.message)));
    }
    const result = await reportCoverage(f.root, f.prepared.directory, {
      ...f.options,
      workflows: [{ ...configuration, directory: run.directory, browser: true }],
    });
    assert.equal(result.report.functionalState, failing ? 'FAIL' : 'PASS');
    assert.equal(result.report.methodAdmission, 'PENDING_INDEPENDENT_REVIEW');
  });

for (const mode of ['parallel', 'sequential', 'invalid-graph'])
  test(`legacy shim closes every real browser and finishes one replayable collection: ${mode}`, async (t) => {
    const f = await fixture(t, false, mode);
    const result = await collectManagementBrowserCoverage({
      ...f,
      outputDirectory: join(f.root, 'outputs/multi-browser'),
      executablePath: process.env.CHROMIUM_PATH,
      browserPath: join(browserDirectory, 'index.mjs'),
    });
    const closure = JSON.parse(readFileSync(join(result.runtimeRoot, 'closure.json')));
    assert.deepEqual(
      closure.connected,
      [false, false],
      'each actual browser must close without the test fallback: ' + result.child.stderr.toString(),
    );
    assert.equal(result.status, mode === 'invalid-graph' ? 'FAIL' : 'PASS');
    assert.equal(result.summary.status, mode === 'invalid-graph' ? 'FAIL' : 'PASS');
    const replay = replayBrowserCoverage({
      manifest: f.manifest,
      outputDirectory: result.directory,
      index: result.collection.index,
    });
    assert.deepEqual(
      replay.observations,
      [...result.collection.observations].sort((left, right) => left.sequence - right.sequence),
    );
    assert.equal(new Set(replay.observations.map((row) => row.pageId)).size, 2);
    const sums = [0, 0];
    for (const row of replay.observations) {
      const coverage = row.sources['docs/management/dashboard/app.js']?.coverage;
      if (coverage) for (let index = 0; index < 2; index++) sums[index] += coverage.b['0'][index];
    }
    assert.deepEqual(sums, mode === 'invalid-graph' ? [1, 0] : mode === 'sequential' ? [2, 1] : [2, 0]);
    if (mode === 'invalid-graph') {
      assert.ok(closure.errors.length);
      assert.ok(replay.observations.some((row) => !row.complete && Object.keys(row.sources).length === 0));
    } else assert.deepEqual(closure.errors, []);
  });
