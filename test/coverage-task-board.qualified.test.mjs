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

const repository = resolve(import.meta.dirname, '..');
const instrumentationDirectory = process.env.AF_QUALIFIED_COVERAGE_TOOLS;
const browserDirectory = process.env.AF_QUALIFIED_BROWSER_TOOLS;
assert.ok(
  instrumentationDirectory && browserDirectory && process.env.CHROMIUM_PATH,
  'qualified tools and explicit Chromium required',
);
const board = 'docs/task-board.js';

async function fixture(t) {
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
  return { root, manifest, generated, tools: await loadCoverageTools(root, options) };
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
