import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { qualifiedBrowserBootstrap } from './helpers/qualified-browser-bootstrap.mjs';
import { verifyPrototypeBoundaries } from './helpers/prototype-browser-boundaries.mjs';
import { verifyLegacyApiJourneys } from './helpers/product-recovery-journeys.mjs';

const root = resolve(import.meta.dirname, '..');

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

async function executeDriver(directory, env) {
  const child = spawn(process.execPath, [join(root, 'tools/verify-ui-browser.mjs')], {
    cwd: directory,
    env: { ...process.env, ...env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((done) => {
    let failure;
    let escalation;
    let deadline;
    let settled = false;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(deadline);
      done({ status, signal, stdout, stderr, failure });
    };
    const force = () => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (process.platform === 'win32')
          execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            timeout: 5_000,
            stdio: 'ignore',
          });
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') failure = new AggregateError([failure, error].filter(Boolean));
      }
    };
    const timer = setTimeout(() => {
      failure = new Error('Original legacy driver exceeded 240 seconds');
      if (process.platform === 'win32') force();
      else child.kill('SIGTERM');
      escalation = setTimeout(force, 5_000);
      deadline = setTimeout(() => {
        force();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, null);
      }, 6_000);
    }, 240_000);
    child.once('error', (error) => {
      failure = error;
      finish(null, null);
    });
    child.once('close', finish);
  });
}

async function runCapabilityJourney(t, mode) {
  const canonical = mode === 'canonical';
  const successful = canonical || mode === 'legacy';
  const tool =
    process.env.AF_PLAYWRIGHT_PATH ||
    (process.env.AF_QUALIFIED_BROWSER_TOOLS && join(process.env.AF_QUALIFIED_BROWSER_TOOLS, 'index.mjs'));
  const chrome = process.env.CHROMIUM_PATH;
  assert.ok(
    tool && existsSync(tool),
    'Approved AF_PLAYWRIGHT_PATH is required; otherwise qualification is NOT_RUN',
  );
  assert.ok(
    chrome && existsSync(chrome),
    'Approved CHROMIUM_PATH is required; otherwise qualification is NOT_RUN',
  );
  assert.ok(existsSync(join(root, 'apps/web/dist/index.html')), 'Build the exact candidate UI first');
  const bootstrap = await qualifiedBrowserBootstrap(root, ['tools/verify-ui-browser.mjs']);
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'alphaforge-legacy-capability-')));
  try {
    await cp(join(root, 'apps/web/dist'), join(directory, 'apps/web/dist'), { recursive: true });
    const port = await reservePort();
    const shim = join(directory, 'tool.mjs');
    await writeFile(
      shim,
      `
      import {chromium as actual} from ${JSON.stringify(pathToFileURL(resolve(tool)).href)};
      import {appendFileSync,existsSync,readFileSync} from 'node:fs';
      let launchIndex=0;
      let labelObserved=false;
      const browsers=new Set();
      process.once('SIGTERM',()=>{
        const deadline=setTimeout(()=>process.exit(125),3000);
        Promise.allSettled([...browsers].map(browser=>browser.close())).then(results=>{
          clearTimeout(deadline);process.exit(results.every(result=>result.status==='fulfilled')?124:125);
        });
      });
      async function paceInput(url) {
        const path=process.env.AF_BROWSER_INPUT_BUDGET+'.'+new URL(url).port;
        if (!existsSync(path)) return;
        const budget=JSON.parse(readFileSync(path,'utf8'));
        if (budget.windowRequests>=350 && !Number.isFinite(budget.safeAfterAt)) throw new Error('INPUT_WINDOW_NOT_QUALIFIED');
        const before=Date.now();
        const waitMs=budget.safeAfterAt-before;
        if (budget.windowRequests>=350 && waitMs>0) {
          await new Promise(done=>setTimeout(done,waitMs));
          appendFileSync('input-pacing.jsonl',JSON.stringify({...budget,requestedWaitMs:waitMs,actualWaitMs:Date.now()-before})+'\\n');
        }
      }
      export const chromium={async launch(options) {
        const id=++launchIndex;
        const browser=await actual.launch(options);
        browsers.add(browser);
        browser.once('disconnected',()=>{browsers.delete(browser);appendFileSync('browser-closed.jsonl',JSON.stringify({id,disconnected:true})+'\\n');});
        const newContext=browser.newContext.bind(browser);
        browser.newContext=async (...args)=>{
          const context=await newContext(...args);
          context.setDefaultTimeout(10000);
          context.setDefaultNavigationTimeout(10000);
          if (${JSON.stringify(bootstrap)}) await context.addInitScript({content:${JSON.stringify(bootstrap)}});
          const newPage=context.newPage.bind(context);
          context.newPage=async (...args)=>{
            const page=await newPage(...args);
            const goto=page.goto.bind(page);
            const reload=page.reload.bind(page);
            page.reload=async (...args)=>{await paceInput(page.url());return reload(...args);};
            page.goto=async (...args)=>{
              await paceInput(args[0]);
              const response=await goto(...args);
              if (!labelObserved && String(args[0]).includes('/#/account/')) {
                const label=page.getByText(${JSON.stringify(canonical ? 'Canonical account and strategy relationships' : 'Legacy API capability:')},{exact:false});
                await label.waitFor();
                appendFileSync('legacy-ui.jsonl',JSON.stringify({url:page.url(),text:await label.innerText()})+'\\n');
                labelObserved=true;
              }
              return response;
            };
            return page;
          };
          return context;
        };
        return browser;
      }};
    `,
    );
    const child = await executeDriver(directory, {
      AF_PLAYWRIGHT_PATH: shim,
      AF_BACKEND_APP: join(root, 'test/helpers/legacy-only-capability-fixture.mjs'),
      AF_BROWSER_PORT: String(port),
      AF_BROWSER_INPUT_BUDGET: join(directory, 'input-budget.json'),
      AF_BROWSER_CAPABILITY_MODE: mode,
      CHROMIUM_PATH: resolve(chrome),
    });
    await writeFile(join(directory, 'driver-execution.json'), JSON.stringify(child, null, 2));
    assert.equal(child.failure, undefined, child.stderr);
    assert.equal(child.signal, null, child.stderr);
    const evidenceParent = join(directory, '.checks/AF-UI01');
    const runs = await readdir(evidenceParent);
    assert.equal(runs.length, 1);
    const evidence = join(evidenceParent, runs[0]);
    const result = JSON.parse(await readFile(join(evidence, 'result.json'), 'utf8'));
    t.diagnostic(
      JSON.stringify({
        scope: 'ORIGINAL_FULL_DRIVER',
        mode,
        status: result.status,
        error: result.error,
        checks: result.checks,
      }),
    );
    const observations = (await readFile(join(evidence, 'ledger.sqlite.legacy-observations.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    const probes = observations.filter((item) => item.event === 'capability-probe');
    assert.equal(probes.length, 1);
    const expectedStatus =
      canonical || mode === 'malformed-200'
        ? 200
        : mode === 'legacy'
          ? 404
          : mode === 'connection-reset'
            ? null
            : Number(mode);
    assert.equal(probes[0].status, expectedStatus);
    assert.equal(probes[0].method, 'GET');
    assert.equal(probes[0].headers.secFetchMode, null, 'This is the real Node APIRequestContext probe');
    assert.equal(probes[0].aliceVaults.length, 1);
    const core = probes[0].aliceVaults[0];
    assert.equal(core.strategyId, 'core-flow-demo');
    assert.equal(core.idle, '8000000');
    assert.equal(core.withdrawalsPaid, '1600000000');
    assert.equal(core.passes, '1000');
    const legacyClaim =
      'Legacy backend capability explicitly detected; no claim of second-strategy or v1 support';
    assert.equal(result.checks.includes(legacyClaim), mode === 'legacy');
    assert.equal(
      result.checks.some((check) => typeof check === 'string' && check.startsWith('Canonical v1 catalogue/')),
      canonical,
    );
    assert.match(
      await readFile(join(directory, 'legacy-ui.jsonl'), 'utf8'),
      canonical ? /Canonical account/ : /Legacy API capability/,
    );
    const closed = observations.find((item) => item.event === 'closed');
    assert.deepEqual(closed, { event: 'closed', publicListening: false, upstreamListening: false });
    assert.equal(
      JSON.parse((await readFile(join(directory, 'browser-closed.jsonl'), 'utf8')).trim().split('\n')[0])
        .disconnected,
      true,
    );
    for (const listener of observations.filter((item) => item.event === 'listening')) {
      await reservePort(listener.publicPort);
      await reservePort(listener.upstreamPort);
    }
    const db = new DatabaseSync(join(evidence, 'ledger.sqlite'), { readOnly: true });
    try {
      const rows = db.prepare('SELECT strategy_id, state_json FROM vaults WHERE owner_id = ?').all('alice');
      assert.equal(rows.length, canonical ? 2 : 1);
      assert.equal(
        JSON.parse(rows.find((row) => row.strategy_id === 'core-flow-demo').state_json).idle,
        '8000000',
      );
      if (canonical)
        assert.equal(
          JSON.parse(rows.find((row) => row.strategy_id === 'satellite-flow-demo').state_json).idle,
          '3000000',
        );
    } finally {
      db.close();
    }
    assert.equal(child.status, successful ? 0 : 1, child.stderr);
    assert.equal(result.status, successful ? 'PASSED' : 'FAILED');
    if (!successful) {
      assert.equal(result.capabilityProfile, undefined);
      assert.equal(result.unsupportedChecks, undefined);
      assert.doesNotMatch(child.stdout, /PASSED|NOT_SUPPORTED/);
      return;
    }
    if (canonical) {
      assert.equal(result.capabilityProfile, undefined);
      assert.equal(result.unsupportedChecks, undefined);
      for (const kind of ['claim', 'command'])
        assert.ok(
          result.checks.includes(`${kind} completion after Cancel preserves the newly opened browser dialog`),
        );
      assert.deepEqual(result, { status: 'PASSED', checks: result.checks });
    } else {
      assert.equal(result.capabilityProfile, 'legacy-only');
      assert.deepEqual(result.unsupportedChecks.map((item) => item.name).sort(), [
        'canonical-optional-detail',
        'v1-command-rate-limit-retry',
        'v1-late-confirm-claim-and-command',
        'v1-snapshot-receipt-recovery',
      ]);
      for (const item of result.unsupportedChecks) {
        assert.deepEqual(item, {
          name: item.name,
          status: 'NOT_SUPPORTED',
          execution: 'NOT_RUN',
          requiredCapability: 'v1',
          equivalentCoverage: false,
        });
        assert.equal(
          result.checks.some((check) =>
            typeof check === 'string'
              ? check.includes(item.name)
              : check.name === item.name || check.status === 'NOT_SUPPORTED',
          ),
          false,
        );
      }
      assert.equal(
        result.checks.some(
          (check) => typeof check === 'string' && /completion after Cancel|NOT_SUPPORTED/.test(check),
        ),
        false,
      );
    }
    const stdout = JSON.parse(child.stdout);
    assert.deepEqual(stdout, { ...result, evidence });
    const storageLog = (
      await readFile(join(evidence, 'storage-ledger.sqlite.legacy-observations.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(storageLog.find((row) => row.event === 'created').initialVaults, []);
    assert.notEqual(
      storageLog.find((row) => row.event === 'created').dbPath,
      observations.find((row) => row.event === 'created').dbPath,
    );
    assert.deepEqual(
      storageLog.find((row) => row.event === 'closed'),
      { event: 'closed', publicListening: false, upstreamListening: false },
    );
    const storage = new DatabaseSync(join(evidence, 'storage-ledger.sqlite'), { readOnly: true });
    try {
      assert.equal(storage.prepare('SELECT count(*) AS count FROM vaults').get().count, 0);
    } finally {
      storage.close();
    }
    const browserCloses = (await readFile(join(directory, 'browser-closed.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(browserCloses.map((row) => row.id).sort(), [1, 2]);
    for (const listener of storageLog.filter((row) => row.event === 'listening')) {
      await reservePort(listener.publicPort);
      await reservePort(listener.upstreamPort);
    }
  } finally {
    if (process.env.AF_BROWSER_INPUTS_EVIDENCE_DIR) {
      const parent = resolve(process.env.AF_BROWSER_INPUTS_EVIDENCE_DIR);
      await mkdir(parent, { recursive: true });
      const saved = await mkdtemp(join(parent, mode + '-run-'));
      await cp(directory, saved, { recursive: true });
      t.diagnostic(`Unmodified original-driver artifacts retained at ${saved}`);
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test('real 404 legacy-only full journey reports four unsupported v1 checks separately', (t) =>
  runCapabilityJourney(t, 'legacy'));
test('real 200 canonical full journey preserves all v1 assertions and receipt shape', (t) =>
  runCapabilityJourney(t, 'canonical'));
test(
  'capability probe rejects HTTP errors, malformed 200 and connection failure without downgrade',
  { concurrency: 2 },
  async (t) => {
    await Promise.all(
      ['401', '403', '429', '500', '503', 'malformed-200', 'connection-reset'].map((mode) =>
        t.test(mode, (t) => runCapabilityJourney(t, mode)),
      ),
    );
  },
);
test('nonboolean capability options cannot authorize omission of supported journeys', async () => {
  for (const v1Supported of [null, 0, 1, 'false', [], {}])
    for (const verify of [verifyPrototypeBoundaries, verifyLegacyApiJourneys])
      await assert.rejects(verify(null, { v1Supported }), { code: 'ERR_ASSERTION' });
});
