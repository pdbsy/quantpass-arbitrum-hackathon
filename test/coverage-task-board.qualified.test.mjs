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
import { prepareLegacyRuntime, collectManagementBrowserCoverage } from '../tools/coverage/browser-legacy.mjs';
import { replayBrowserCoverage } from '../tools/coverage/browser-evidence.mjs';
import { loadCoverageTools } from '../tools/coverage/toolchain.mjs';
import { mergeObserved } from '../tools/coverage/evidence.mjs';
import { collectNodeWorkflow } from '../tools/coverage/collect.mjs';
import { reportCoverage } from '../tools/coverage/report.mjs';

const repository = resolve(import.meta.dirname, '..');
const instrumentationDirectory = process.env.AF_QUALIFIED_COVERAGE_TOOLS;
const browserDirectory = process.env.AF_QUALIFIED_BROWSER_TOOLS;
assert.ok(
  instrumentationDirectory && browserDirectory && process.env.CHROMIUM_PATH,
  'qualified tools and explicit Chromium required',
);
const board = 'docs/task-board.js';

async function fixture(t, failDriver = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-task-board-coverage-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }).trim();
  mkdirSync(join(root, 'tools'), { recursive: true });
  cpSync(join(repository, 'tools/coverage'), join(root, 'tools/coverage'), { recursive: true });
  copyFileSync(join(repository, 'tools/html-source-ranges.mjs'), join(root, 'tools/html-source-ranges.mjs'));
  for (const directory of ['docs', 'planning', 'node_modules']) mkdirSync(join(root, directory));
  for (const name of ['task-board.js', 'task-board.html', 'task-board.css'])
    copyFileSync(join(repository, 'docs', name), join(root, 'docs', name));
  for (const name of ['coverage-toolchain.lock.json', 'coverage-instrumentation.package-lock.json'])
    copyFileSync(join(repository, 'planning', name), join(root, 'planning', name));
  for (const chunk of JSON.parse(readFileSync(join(repository, 'planning/coverage-toolchain.lock.json')))
    .instrumentation.installedFileChunks)
    copyFileSync(join(repository, chunk.path), join(root, chunk.path));
  writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\noutputs/\n');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(
    join(root, 'tools/verify-management-browser.mjs'),
    `
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.AF_PLAYWRIGHT_PATH));
const resources=new Map([['/task-board.html','text/html'],['/task-board.js','text/javascript'],['/task-board.css','text/css']]);
const server=createServer((request,response)=>{
 const type=resources.get(request.url);
 if(!type){response.writeHead(404);response.end();return;}
 response.setHeader('content-type',type);
 response.end(readFileSync(resolve('docs',request.url.slice(1))));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
 const context=await browser.newContext();
 const origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
 const page=await context.newPage();
 await page.goto(origin+'/task-board.html');
 assert.equal(await page.locator('[data-task]:visible').count(),41);
 await page.locator('#task-search').fill('SUPPLY-001');
 assert.ok(await page.locator('[data-task]:visible').count()>0);
 await page.locator('#task-search').fill('no-such-task-exact-fixture');
 assert.equal(await page.locator('[data-task]:visible').count(),0);
 await page.locator('#reset-filter').click();
 assert.equal(await page.locator('[data-task]:visible').count(),41);
 assert.equal(await page.locator('#task-search').evaluate(node=>node===document.activeElement),true);
 await page.locator('#phase-filter').selectOption('P0');
 await page.locator('#status-filter').selectOption('done');
 await page.locator('#risk-filter').selectOption('critical');
 const cards=await page.locator('[data-task]:visible').evaluateAll(nodes=>nodes.map(node=>({...node.dataset})));
 assert.ok(cards.length>0&&cards.every(card=>card.phase==='P0'&&card.status==='done'&&card.risk==='critical'));
} finally {
 try{await browser?.close();}finally{await new Promise(done=>server.close(done));}
}
if (${failDriver}) throw new Error('EXPECTED_DRIVER_FAILURE');
`,
  );
  git('init', '-q');
  git('config', 'user.name', 'Coverage fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'task board fixture');
  const options = { instrumentationDirectory, browserDirectory, sourceBase: git('rev-parse', 'HEAD') };
  const prepared = await prepareCoverage(root, options);
  const manifest = JSON.parse(readFileSync(join(prepared.directory, 'manifest.json')));
  const generated = JSON.parse(readFileSync(join(prepared.directory, 'generated.json')));
  return { root, manifest, generated, prepared, options, tools: await loadCoverageTools(root, options) };
}

test('management runtime materializes the exact task board graph and rejects altered generated bytes', async (t) => {
  const f = await fixture(t);
  const before = readFileSync(join(f.root, board));
  const prepared = await prepareLegacyRuntime({
    ...f,
    workflow: 'management',
    outputDirectory: join(f.root, 'outputs/runtime'),
    nodeModulesDirectory: join(f.root, 'node_modules'),
  });
  assert.equal(readFileSync(join(prepared.runtimeRoot, board), 'utf8'), f.generated[board].code);
  assert.deepEqual(readFileSync(join(f.root, board)), before);
  const altered = structuredClone(f.generated);
  altered[board].code += '\n';
  await assert.rejects(
    prepareLegacyRuntime({
      ...f,
      generated: altered,
      workflow: 'management',
      outputDirectory: join(f.root, 'outputs/altered'),
      nodeModulesDirectory: join(f.root, 'node_modules'),
    }),
    /changed generated source/,
  );
  const remapped = structuredClone(f.generated);
  remapped[board].map.sources = ['foreign.js'];
  await assert.rejects(
    prepareLegacyRuntime({
      ...f,
      generated: remapped,
      workflow: 'management',
      outputDirectory: join(f.root, 'outputs/remapped'),
      nodeModulesDirectory: join(f.root, 'node_modules'),
    }),
    /changed source map/,
  );
});

test('real task board interactions contribute only replay-verified original graph counters', async (t) => {
  const f = await fixture(t);
  const result = await collectManagementBrowserCoverage({
    ...f,
    outputDirectory: join(f.root, 'outputs/browser'),
    executablePath: process.env.CHROMIUM_PATH,
    browserPath: resolve(browserDirectory, 'index.mjs'),
    nodeModulesDirectory: join(f.root, 'node_modules'),
  });
  assert.equal(result.status, 'PASS', result.child.stderr.toString());
  const replay = replayBrowserCoverage({
    manifest: f.manifest,
    outputDirectory: result.directory,
    index: result.collection.index,
  });
  const observations = replay.observations.filter((row) => row.complete && row.sources[board]);
  assert.ok(observations.length > 0, 'visible task board behavior must yield its original source counters');
  const merged = mergeObserved(f.manifest, replay.observations);
  assert.deepEqual(merged.coverage[board].branchMap, f.manifest.sources[board].coverage.branchMap);
  assert.ok(
    Object.values(merged.coverage[board].b)
      .flat()
      .every((count) => count > 0),
  );
  assert.ok(Object.values(merged.coverage[board].f).every((count) => count > 0));
  assert.ok(observations.every((row) => row.sources[board].sha256 === f.manifest.sources[board].sha256));
});

for (const mode of ['reviewed-environment', 'missing-default-module', 'hooked-driver-failure'])
  test(`management collector binds executable fallbacks and actual child outcomes: ${mode}`, async (t) => {
    const f = await fixture(t, mode === 'hooked-driver-failure');
    const keys = ['AF_PLAYWRIGHT_PATH', 'AF_CHROME_PATH', 'NODE_OPTIONS'];
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const cwd = process.cwd();
    const hook = join(f.root, 'outputs', 'reviewed-node-hook.mjs');
    if (mode === 'hooked-driver-failure')
      writeFileSync(hook, f.generated['tools/coverage/node-hook.mjs'].code);
    try {
      process.chdir(f.root);
      process.env.AF_CHROME_PATH = process.env.CHROMIUM_PATH;
      process.env.NODE_OPTIONS = '';
      if (mode === 'missing-default-module') delete process.env.AF_PLAYWRIGHT_PATH;
      else process.env.AF_PLAYWRIGHT_PATH = resolve(browserDirectory, 'index.mjs');
      const result = await collectManagementBrowserCoverage({
        ...f,
        outputDirectory: join(f.root, 'outputs', mode),
        ...(mode === 'hooked-driver-failure' ? { nodeHook: hook } : {}),
      });
      assert.equal(result.status, mode === 'reviewed-environment' ? 'PASS' : 'FAIL');
      if (mode === 'missing-default-module') {
        assert.equal(result.child.code, 1);
        assert.equal(result.collection, null);
        assert.match(result.child.stderr.toString(), /ERR_MODULE_NOT_FOUND/);
      } else {
        assert.ok(
          replayBrowserCoverage({
            manifest: f.manifest,
            outputDirectory: result.directory,
            index: result.collection.index,
          }).observations.length,
        );
        if (mode === 'hooked-driver-failure') {
          assert.equal(result.nodeChild.exitCode, 1);
          assert.match(result.child.stderr.toString(), /EXPECTED_DRIVER_FAILURE/);
        }
      }
    } finally {
      process.chdir(cwd);
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });

for (const failDriver of [false, true])
  test(`management child receipt replays actual ${failDriver ? 'FAIL' : 'PASS'} without claiming method admission`, async (t) => {
    const f = await fixture(t, failDriver);
    const configuration = {
      id: 'management-browser',
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
        '--workflow',
        'management',
      ],
    };
    const run = await collectNodeWorkflow(f.root, f.prepared.directory, {
      ...f.options,
      ...configuration,
      timeoutMs: 30000,
      artifactFiles: ['browser-receipt.json'],
    });
    const state = failDriver ? 'FAIL' : 'PASS';
    assert.equal(run.state, state);
    const receipt = JSON.parse(readFileSync(join(run.directory, 'browser-receipt.json')));
    assert.equal(receipt.state, state);
    assert.equal(receipt.nodeChild.exitCode, failDriver ? 1 : 0);
    assert.equal(receipt.workflow, 'management');
    const measured = await reportCoverage(f.root, f.prepared.directory, {
      ...f.options,
      workflows: [{ ...configuration, directory: run.directory, browser: true }],
    });
    assert.equal(measured.report.functionalState, state);
    assert.equal(measured.report.methodAdmission, 'PENDING_INDEPENDENT_REVIEW');
    assert.equal(measured.report.independentAttestation, false);
    assert.equal(measured.report.files.find((row) => row.path === board).summary.branches.pct, 100);
  });
