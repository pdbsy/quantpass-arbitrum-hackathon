import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  browserDigest,
  browserHelperBootstrap,
  browserManifestDigest,
  verifyBrowserSource,
} from './browser-evidence.mjs';
import { shouldTransformBrowserPath } from './browser.mjs';

const prototypePath = 'apps/web/prototype/AlphaForge_v3_EN.html';
const workflows = Object.freeze({
  legacy: 'tools/verify-ui-browser.mjs',
  management: 'tools/verify-management-browser.mjs',
});

export function driverForBrowserWorkflow(workflow) {
  const driver = workflows[workflow];
  if (!driver) throw new Error(`UNKNOWN_BROWSER_WORKFLOW:${workflow}`);
  return driver;
}

async function copyRuntimeRoot(root, outputDirectory, nodeModulesDirectory) {
  const runtimeRoot = resolve(outputDirectory, 'runtime-root');
  await cp(root, runtimeRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (source) => !source.includes(`${sep}.git${sep}`) && source !== outputDirectory,
  });
  if (!nodeModulesDirectory && !(await exists(resolve(runtimeRoot, 'node_modules'))))
    nodeModulesDirectory = resolve(process.cwd(), 'node_modules');
  if (nodeModulesDirectory && !(await exists(resolve(runtimeRoot, 'node_modules'))))
    await cp(resolve(nodeModulesDirectory), resolve(runtimeRoot, 'node_modules'), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  return runtimeRoot;
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    try {
      await (await import('node:fs/promises')).stat(path);
      return true;
    } catch {
      return false;
    }
  }
}

function sourceEntry(manifest, path) {
  const alias = manifest.aliases?.[path];
  return { canonical: alias?.canonical || path, alias };
}

async function materializeManagement({ root, manifest, generated }) {
  const candidates = [
    ...Object.keys(manifest.sources).filter(
      (path) => path.startsWith('docs/management/dashboard/') && shouldTransformBrowserPath(path),
    ),
    ...Object.keys(manifest.aliases || {}).filter((path) => path.startsWith('docs/management/dashboard/')),
  ];
  for (const path of candidates) {
    const item = sourceEntry(manifest, path);
    const generatedEntry = generated[item.canonical];
    assert.ok(generatedEntry, `missing generated management source: ${path}`);
    verifyBrowserSource({ root, manifest, generated, path });
    await writeFile(resolve(root, path), generatedEntry.code);
  }
  return { root, paths: candidates };
}

async function materializeWeb({ root, manifest, generated }) {
  const source = await readFile(resolve(root, prototypePath), 'utf8');
  const { importUserUI } = await import(pathToFileURL(resolve(root, 'tools/import-user-ui.mjs')).href);
  await importUserUI(source, resolve(root, 'apps/web'), resolve(root, 'build/ui-import'));
  const { build } = await import('vite');
  const webRoot = resolve(root, 'apps/web');
  await build({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    logLevel: 'error',
    plugins: [
      {
        name: 'alphaforge-exact-browser-generated',
        enforce: 'pre',
        transform(code, id) {
          const absolute = id.split('?')[0];
          if (!absolute.startsWith(root + sep)) return null;
          const path = relative(root, absolute).split(sep).join('/');
          if (!shouldTransformBrowserPath(path)) return null;
          const item = sourceEntry(manifest, path);
          assert.ok(manifest.sources[item.canonical], `unregistered first-party web source: ${path}`);
          const generatedEntry = generated[item.canonical];
          assert.ok(generatedEntry, `missing generated web source: ${path}`);
          verifyBrowserSource({ root, manifest, generated, path, source: code });
          // Vite may normalize/mutate a map object during build. Keep the
          // prepared generated graph immutable for the hook and replay index.
          return { code: generatedEntry.code, map: structuredClone(generatedEntry.map) };
        },
      },
    ],
    build: { outDir: resolve(webRoot, 'dist'), emptyOutDir: true, sourcemap: false },
  });
  const prototypeEntry = generated[prototypePath];
  assert.ok(prototypeEntry?.code, 'missing generated prototype');
  verifyBrowserSource({ root, manifest, generated, path: prototypePath });
  await writeFile(resolve(webRoot, 'dist/user-ui.js'), prototypeEntry.code);
  return { root, webRoot: resolve(webRoot, 'dist'), paths: [prototypePath] };
}

async function reservePort() {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function writePlaywrightShim({
  root,
  manifest,
  generated,
  outputDirectory,
  workflow,
  browserPath,
  parser,
}) {
  const driverPath = driverForBrowserWorkflow(workflow);
  const helperPaths = [
    driverPath,
    ...Object.keys(manifest.sources).filter((path) => /^tools\/coverage\/browser[^/]*\.mjs$/.test(path)),
  ].filter((path) => manifest.sources[path]);
  const bootstrap = browserHelperBootstrap({ root, manifest, generated, parser, paths: helperPaths });
  const manifestPath = resolve(outputDirectory, 'manifest.json');
  const generatedPath = resolve(outputDirectory, 'generated.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(generatedPath, `${JSON.stringify(generated)}\n`, { flag: 'wx' });
  const lifecyclePath = pathToFileURL(
    resolve(dirname(fileURLToPath(import.meta.url)), 'browser-lifecycle.mjs'),
  ).href;
  const summaryPath = resolve(outputDirectory, `driver-summary-${randomUUID()}.json`);
  const rawDirectory = resolve(outputDirectory, 'raw');
  await mkdir(rawDirectory, { recursive: true });
  const loaded = Object.keys(manifest.sources);
  const content = `import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium as realChromium } from ${JSON.stringify(pathToFileURL(browserPath).href)};
import { createBrowserCoverageLifecycle } from ${JSON.stringify(lifecyclePath)};
const manifest = JSON.parse(readFileSync(${JSON.stringify(manifestPath)}, 'utf8'));
const generated = JSON.parse(readFileSync(${JSON.stringify(generatedPath)}, 'utf8'));
const tracker = createBrowserCoverageLifecycle({ manifest, outputDirectory: ${JSON.stringify(outputDirectory)}, loaded: new Set(${JSON.stringify(loaded)}), workflow: ${JSON.stringify(`LEGACY_${workflow.toUpperCase()}`)} });
const bootstrap = ${JSON.stringify(bootstrap)};
let collection;
let closePromise;
mkdirSync(${JSON.stringify(rawDirectory)}, { recursive: true });
function installContext(context) {
  context.addInitScript({ content: bootstrap });
  const originalNewPage = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await originalNewPage(...args);
    tracker.registerPage(page);
    return page;
  };
  return context;
}
async function wrapBrowser(browser) {
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => installContext(await originalNewContext(...args));
  if (typeof browser.newPage === 'function') {
    const originalNewPage = browser.newPage.bind(browser);
    browser.newPage = async (...args) => {
      const page = await originalNewPage(...args);
      await page.addInitScript({ content: bootstrap });
      tracker.registerPage(page);
      return page;
    };
  }
  const originalClose = browser.close.bind(browser);
  browser.close = async (...args) => {
    if (!closePromise) closePromise = (async () => {
      try { collection = await tracker.finish(); writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({ status: 'PASS', collection }) + '\\n', { flag: 'wx' }); }
      catch (error) { collection = error.browserCoverage; writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({ status: 'FAIL', error: { name: error.name, message: error.message }, collection }) + '\\n', { flag: 'wx' }); throw error; }
      finally { await originalClose(...args); }
    })();
    return closePromise;
  };
  return browser;
}
export const chromium = { launch: async (...args) => wrapBrowser(await realChromium.launch(...args)) };
// ${generatedPath} and ${driverPath} are fixed inputs; generated is read to bind this shim's evidence.
void generated;
`;
  await writeFile(resolve(outputDirectory, 'playwright-shim.mjs'), content, { flag: 'wx' });
  return {
    shimPath: resolve(outputDirectory, 'playwright-shim.mjs'),
    summaryPath,
    manifestPath,
    generatedPath,
    rawDirectory,
  };
}

async function runChild({ root, driver, env, outputDirectory }) {
  const stdoutPath = resolve(outputDirectory, 'driver.stdout.log');
  const stderrPath = resolve(outputDirectory, 'driver.stderr.log');
  const result = await new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [driver], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', rejectResult);
    child.once('close', (code, signal) =>
      resolveResult({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }),
    );
  });
  await writeFile(stdoutPath, result.stdout);
  await writeFile(stderrPath, result.stderr);
  return {
    ...result,
    stdoutArtifact: {
      kind: 'driver-stdout',
      file: relative(outputDirectory, stdoutPath),
      sha256: browserDigest(result.stdout),
      bytes: result.stdout.length,
    },
    stderrArtifact: {
      kind: 'driver-stderr',
      file: relative(outputDirectory, stderrPath),
      sha256: browserDigest(result.stderr),
      bytes: result.stderr.length,
    },
  };
}

export async function prepareLegacyRuntime({
  root,
  manifest,
  generated,
  outputDirectory,
  workflow,
  nodeModulesDirectory,
}) {
  driverForBrowserWorkflow(workflow);
  const runtimeRoot = await copyRuntimeRoot(resolve(root), resolve(outputDirectory), nodeModulesDirectory);
  if (workflow === 'management') await materializeManagement({ root: runtimeRoot, manifest, generated });
  else await materializeWeb({ root: runtimeRoot, manifest, generated });
  return { runtimeRoot, driver: driverForBrowserWorkflow(workflow) };
}

export async function collectLegacyBrowserCoverage({
  root,
  manifest,
  generated,
  tools,
  outputDirectory,
  workflow = 'legacy',
  executablePath,
  browserPath,
  nodeHook,
  nodeModulesDirectory,
}) {
  const directory = resolve(outputDirectory, `${workflow}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const runtime = await prepareLegacyRuntime({
    root,
    manifest,
    generated,
    outputDirectory: directory,
    workflow,
    nodeModulesDirectory,
  });
  const browserModule =
    browserPath ||
    resolve(process.env.AF_PLAYWRIGHT_PATH || '.checks/browser-tools/node_modules/playwright-core/index.mjs');
  const shim = await writePlaywrightShim({
    root: runtime.runtimeRoot,
    manifest,
    generated,
    outputDirectory: directory,
    workflow,
    browserPath: browserModule,
    parser: tools.parser,
  });
  await mkdir(resolve(directory, 'node-raw'), { recursive: true });
  const manifestSha256 = browserManifestDigest(manifest);
  const generatedSha256 = browserDigest(`${JSON.stringify(generated)}\n`);
  const env = {
    ...process.env,
    AF_PLAYWRIGHT_PATH: shim.shimPath,
    CHROMIUM_PATH: executablePath || process.env.CHROMIUM_PATH,
    AF_CHROME_PATH: executablePath || process.env.AF_CHROME_PATH,
    ...(workflow === 'legacy'
      ? { AF_BACKEND_APP: 'apps/server/src/app.ts', AF_BROWSER_PORT: String(await reservePort()) }
      : {}),
    ...(nodeHook
      ? {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${pathToFileURL(nodeHook).href}`.trim(),
          AF_COVERAGE_ROOT: runtime.runtimeRoot,
          AF_COVERAGE_PREPARED: directory,
          AF_COVERAGE_RAW: resolve(directory, 'node-raw'),
          AF_COVERAGE_MANIFEST_SHA: manifestSha256,
          AF_COVERAGE_GENERATED_SHA: generatedSha256,
          AF_COVERAGE_WORKFLOW: `BROWSER_${workflow.toUpperCase()}`,
        }
      : {}),
  };
  const child = await runChild({
    root: runtime.runtimeRoot,
    driver: runtime.driver,
    env,
    outputDirectory: directory,
  });
  let summary;
  try {
    summary = JSON.parse(await readFile(shim.summaryPath, 'utf8'));
  } catch {
    summary = { status: 'FAIL', collection: null };
  }
  const status = child.code === 0 && child.signal === null && summary.status === 'PASS' ? 'PASS' : 'FAIL';
  return {
    directory,
    runtimeRoot: runtime.runtimeRoot,
    workflow,
    driver: runtime.driver,
    child,
    summary,
    status,
    workflowResult: { status, exitCode: child.code, signal: child.signal },
    collection: summary.collection,
  };
}

export const collectManagementBrowserCoverage = (options) =>
  collectLegacyBrowserCoverage({ ...options, workflow: 'management' });
