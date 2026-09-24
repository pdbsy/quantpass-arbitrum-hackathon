import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyBrowserSource, browserHelperBootstrap, writeBrowserArtifact } from './browser-evidence.mjs';
import { createBrowserCoverageLifecycle } from './browser-lifecycle.mjs';

const prototypePath = 'apps/web/prototype/AlphaForge_v3_EN.html';
const driverPath = 'tools/verify-m3-browser.mjs';

export function shouldTransformBrowserPath(path) {
  return (
    /\.(?:js|mjs|cjs|ts|tsx)$/.test(path) &&
    !path.startsWith('node_modules/') &&
    !path.includes('/node_modules/')
  );
}

export async function collectBrowserCoverage({
  root,
  manifest,
  generated,
  tools,
  outputDirectory,
  executablePath,
  port = 0,
}) {
  root = resolve(root);
  assert.equal(manifest.schemaVersion, 1);
  for (const key of ['candidateCommit', 'candidateTree']) assert.match(manifest[key], /^[a-f0-9]{40}$/);
  assert.match(manifest.toolDigest, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535, 'invalid browser coverage port');
  const directory = resolve(outputDirectory, `browser-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  let browser;
  let server;
  let tracker;
  let collection;
  let workflowResult;
  const failures = [];
  const blockedRequests = [];
  const loaded = new Set();
  try {
    const prototype = verifyBrowserSource({ root, manifest, generated, path: prototypePath });
    const html = readFileSync(resolve(root, prototypePath), 'utf8');
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(css, 'bound prototype stylesheet unavailable');
    const helperPaths = Object.keys(manifest.sources).filter(
      (path) => path === driverPath || /^tools\/coverage\/browser[^/]*\.mjs$/.test(path),
    );
    assert.ok(helperPaths.includes(driverPath), 'M3 workflow missing from prepared sources');
    const bootstrap = browserHelperBootstrap({
      root,
      manifest,
      generated,
      parser: tools.parser,
      paths: helperPaths,
    });
    for (const path of helperPaths) loaded.add(path);
    const { createServer } = await import('vite');
    server = await createServer({
      root: resolve(root, 'apps/web'),
      configFile: resolve(root, 'apps/web/vite.config.ts'),
      logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true },
      plugins: [
        {
          name: 'alphaforge-exact-browser-coverage',
          enforce: 'pre',
          configureServer(vite) {
            vite.middlewares.use((request, response, next) => {
              const pathname = request.url?.split('?')[0];
              if (pathname !== '/user-ui.js' && pathname !== '/user-ui.css') return next();
              try {
                verifyBrowserSource({ root, manifest, generated, path: prototypePath });
                response.statusCode = 200;
                response.setHeader(
                  'content-type',
                  pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
                );
                if (pathname.endsWith('.js')) loaded.add(prototypePath);
                response.end(pathname.endsWith('.js') ? prototype.code : css);
              } catch (error) {
                failures.push(error);
                next(error);
              }
            });
          },
          transform(code, id) {
            const absolute = id.split('?')[0];
            if (!absolute.startsWith(root + sep)) return null;
            const path = relative(root, absolute).split(sep).join('/');
            if (!shouldTransformBrowserPath(path)) return null;
            try {
              const item = verifyBrowserSource({ root, manifest, generated, path, source: code });
              loaded.add(manifest.aliases?.[path]?.canonical || path);
              return { code: item.code, map: item.map };
            } catch (error) {
              failures.push(error);
              throw error;
            }
          },
        },
      ],
    });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address === 'object' && address.address === '127.0.0.1');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await tools.chromium.launch({
      executablePath: executablePath || process.env.CHROMIUM_PATH,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    await context.addInitScript({ content: bootstrap });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) await route.continue();
      else {
        blockedRequests.push(url.origin);
        await route.abort('blockedbyclient');
      }
    });
    await context.routeWebSocket('**/*', (socket) => {
      const url = new URL(socket.url());
      if (url.origin === origin.replace('http:', 'ws:')) socket.connectToServer();
      else {
        blockedRequests.push(url.origin);
        socket.close();
      }
    });
    tracker = createBrowserCoverageLifecycle({ manifest, outputDirectory: directory, loaded });
    context.on('page', (page) => tracker.registerPage(page));
    const page = await context.newPage();
    verifyBrowserSource({ root, manifest, generated, path: driverPath });
    const { runM3BrowserJourneys } = await import(pathToFileURL(resolve(root, driverPath)).href);
    workflowResult = await runM3BrowserJourneys(page, {
      origin,
      evidenceDirectory: resolve(directory, 'journey'),
    });
    assert.deepEqual(blockedRequests, [], 'unexpected browser network activity');
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      if (tracker) collection = await tracker.finish();
    } catch (error) {
      collection = error.browserCoverage;
      failures.push(error);
    }
    try {
      await browser?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await server?.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    const failure = writeBrowserArtifact(directory, 'failure', {
      candidateCommit: manifest.candidateCommit,
      errors: failures.map((error) => ({
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error.m3BrowserFailure ? { m3BrowserFailure: error.m3BrowserFailure } : {}),
      })),
      blockedRequests,
      index: collection?.index,
    });
    const error = new AggregateError(failures, `browser workflow failed; evidence retained at ${directory}`);
    error.browserCoverage = { directory, ...collection, failure };
    throw error;
  }
  return { directory, ...collection, workflowResult };
}
