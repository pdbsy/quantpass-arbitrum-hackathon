import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

async function assertPortReleased(port) {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
}

test('original browser CLIs reject missing tools and launch failures through their real default inputs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'alphaforge-browser-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Drivers execute at their original source paths. Their writable cwd, backend
  // module graph, dependency installation and SQLite files belong to this fixture.
  for (const path of ['apps', 'packages', 'node_modules', 'package.json'])
    await cp(join(root, path), join(directory, path), {
      recursive: true,
      filter: (path) => path !== join(root, 'apps/web/dist') && !/\.sqlite(?:-\w+)?$/.test(path),
    });
  await mkdir(join(directory, 'apps/web/dist'), { recursive: true });
  const optionalTool = resolve(
    process.env.AF_PLAYWRIGHT_PATH ||
      (process.env.AF_QUALIFIED_BROWSER_TOOLS && join(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs')) ||
      join(root, '.checks/browser-tools/node_modules/playwright-core/index.mjs'),
  );
  const env = { ...process.env };
  for (const name of [
    'AF_BACKEND_APP',
    'AF_PLAYWRIGHT_PATH',
    'AF_BROWSER_PORT',
    'AF_M3_BROWSER_PORT',
    'AF_M3_BROWSER_EVIDENCE_ROOT',
    'CHROMIUM_PATH',
  ])
    delete env[name];
  const execute = (driver, overrides = {}) => {
    const child = spawnSync(process.execPath, [join(root, `tools/${driver}`)], {
      cwd: directory,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      timeout: 20_000,
      killSignal: 'SIGKILL',
    });
    assert.equal(child.error, undefined, `${child.error?.message}\n${child.stderr}`);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 1, child.stderr);
    assert.doesNotMatch(child.stdout, /"(?:state|status)":\s*"PASS(?:ED)?"/);
    return child;
  };
  for (const driver of ['verify-m3-browser.mjs', 'verify-ui-browser.mjs']) {
    await t.test(`${driver}: default optional tool is absent`, () => {
      const child = execute(driver);
      assert.match(child.stderr, /ERR_MODULE_NOT_FOUND/);
      assert.ok(child.stderr.includes(join(directory, '.checks/browser-tools/node_modules/playwright-core')));
      assert.equal(existsSync(join(directory, '.checks/AF-UI01')), false);
      assert.equal(existsSync(join(directory, '.checks/M3-04-PHASE1-PRODUCT')), false);
    });
  }
  const prerequisite = !existsSync(optionalTool) && 'NOT_RUN: approved optional browser tool is absent';
  await t.test(
    'M3 default evidence root rejects invalid port before server launch',
    { skip: prerequisite },
    async () => {
      const child = execute('verify-m3-browser.mjs', {
        AF_PLAYWRIGHT_PATH: optionalTool,
        AF_M3_BROWSER_PORT: 'not-a-port',
      });
      assert.match(child.stderr, /INVALID_AF_M3_BROWSER_PORT/);
      assert.doesNotMatch(child.stderr, /EADDRINUSE|browserType\.launch/);
      const evidence = join(directory, '.checks/M3-04-PHASE1-PRODUCT');
      const runs = await readdir(evidence);
      assert.equal(runs.length, 1);
      assert.equal(existsSync(join(evidence, runs[0], 'result.json')), false);
    },
  );
  for (const [driver, port] of [
    ['verify-m3-browser.mjs', 4197],
    ['verify-ui-browser.mjs', 4195],
  ]) {
    await t.test(
      `${driver}: default port and native launch failure release the server`,
      { skip: prerequisite },
      async (t) => {
        try {
          await assertPortReleased(port);
        } catch (error) {
          if (error.code !== 'EADDRINUSE') throw error;
          t.skip(`BLOCKED: fixed default port ${port} is occupied`);
          return;
        }
        const child = execute(driver, {
          AF_PLAYWRIGHT_PATH: optionalTool,
          CHROMIUM_PATH: join(directory, 'missing-chromium-executable'),
        });
        assert.match(child.stderr, /browserType\.launch/);
        assert.match(child.stderr, /missing-chromium-executable/);
        assert.doesNotMatch(child.stderr, /INVALID_AF_M3_BROWSER_PORT|EADDRINUSE/);
        await assertPortReleased(port);
        if (driver === 'verify-ui-browser.mjs') {
          const evidence = join(directory, '.checks/AF-UI01');
          const runs = await readdir(evidence);
          assert.equal(runs.length, 1);
          const report = JSON.parse(await readFile(join(evidence, runs[0], 'result.json'), 'utf8'));
          assert.equal(report.status, 'FAILED');
          assert.match(report.error, /missing-chromium-executable/);
          assert.equal(existsSync(join(evidence, runs[0], 'failure.png')), false);
        } else {
          const evidence = join(directory, '.checks/M3-04-PHASE1-PRODUCT');
          for (const run of await readdir(evidence))
            assert.equal(existsSync(join(evidence, run, 'result.json')), false);
        }
      },
    );
  }
});
