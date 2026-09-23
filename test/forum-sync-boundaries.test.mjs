import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const outputs = [
  'docs/management/agents/forum-snapshot.json',
  'docs/management/dashboard/agent-forum.html',
  'docs/management/dashboard/agent-forum-app.js',
  'docs/management/dashboard/agent-forum.css',
];

for (const scenario of ['complete', 'partial', 'invalid-page', 'missing-previous']) {
  test(`Forum CLI ${scenario} uses bounded API pages and preserves truthful generated state`, async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'alphaforge-forum-cli-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const gitEnvironment = { ...process.env };
    for (const key of Object.keys(gitEnvironment)) if (key.startsWith('GIT_')) delete gitEnvironment[key];
    Object.assign(gitEnvironment, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    for (const args of [
      ['init', '-q'],
      ['remote', 'add', 'origin', 'https://github.com/pdbsy/quantpass-arbitrum-hackathon'],
    ]) {
      const git = spawnSync('git', args, { cwd: temporary, env: gitEnvironment, encoding: 'utf8' });
      assert.equal(git.status, 0, git.stderr);
    }
    const originalOutputs = await Promise.all(outputs.map((path) => readFile(resolve(root, path))));
    const redirects = Object.fromEntries(
      outputs.map((path, index) => [resolve(root, path), join(temporary, `output-${index}`)]),
    );
    const previous = {
      schema_version: 1,
      source: { state: 'OK', error: null, last_sync_at: '2026-09-12T10:00:00.000Z' },
      messages: [{ message_id: 'afm-local-fixture', body: 'previous trusted fixture message' }],
      threads: [{ thread: 'AF-LOCAL-FIXTURE' }],
    };
    const snapshotPath = redirects[resolve(root, outputs[0])];
    if (scenario !== 'missing-previous') await writeFile(snapshotPath, JSON.stringify(previous));
    const callsPath = join(temporary, 'calls.jsonl');
    const fakeApiPath = join(temporary, 'fixture-api.mjs');
    await writeFile(
      fakeApiPath,
      `
      const endpoint = process.argv[2];
      const scenario = ${JSON.stringify(scenario)};
      if (scenario === 'invalid-page' || scenario === 'missing-previous') {
        console.log(JSON.stringify({ malformed: true }));
      } else if (scenario === 'partial' && endpoint.includes('/pulls?')) {
        const page = Number(new URL(endpoint, 'https://api.github.com/').searchParams.get('page'));
        console.log(JSON.stringify(Array.from({ length: 100 }, (_, index) => {
          const number = (page - 1) * 100 + index + 1;
          return {
            number, html_url: 'https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/' + number,
            title: '[Macbeth01][M3-01-PHASE1-CLOSEOUT] Local fixture', body: '',
            created_at: '2026-09-12T10:00:00.000Z', updated_at: '2026-09-12T10:00:00.000Z',
            user: { login: 'fixture' },
            head: { ref: 'macbeth01/m3-phase1-closeout', repo: { full_name: 'pdbsy/quantpass-arbitrum-hackathon' } },
          };
        })));
      } else console.log('[]');
    `,
    );
    const hookPath = join(temporary, 'boundary-hook.mjs');
    // Keep the actual CLI, parser, pagination, failure handling and renderer intact.
    // Redirect only output I/O to private files and gh reads to a real fixture child.
    await writeFile(
      hookPath,
      `
      import assert from 'node:assert/strict';
      import cp from 'node:child_process';
      import { appendFileSync } from 'node:fs';
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const redirects = ${JSON.stringify(redirects)};
      const originalRead = fs.readFile;
      const originalWrite = fs.writeFile;
      const originalExec = cp.execFileSync;
      fs.readFile = (path, ...args) => originalRead(redirects[path] ?? path, ...args);
      fs.writeFile = (path, ...args) => {
        assert.ok(Object.hasOwn(redirects, path), 'unexpected output write');
        return originalWrite(redirects[path], ...args);
      };
      cp.execFileSync = (file, args, options) => {
        if (file !== 'gh') {
          assert.equal(file, 'git');
          assert.deepEqual(args, ['remote', 'get-url', 'origin']);
          return originalExec(file, args, { ...options, cwd: ${JSON.stringify(temporary)}, env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
        }
        assert.equal(args[0], 'api');
        assert.equal(args[2], '--jq');
        assert.match(args[1], /^repos\\/pdbsy\\/quantpass-arbitrum-hackathon\\//);
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args[1]) + '\\n');
        return originalExec(process.execPath, [${JSON.stringify(fakeApiPath)}, args[1]], {
          ...options, env: { ...process.env, NODE_OPTIONS: '' },
        });
      };
      syncBuiltinESMExports();
    `,
    );
    const child = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(hookPath).href, 'tools/sync-agent-forum.mjs'],
      {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, ['complete', 'partial'].includes(scenario) ? 0 : 1, child.stderr);
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    const html = await readFile(redirects[resolve(root, outputs[1])], 'utf8');
    if (scenario === 'complete' || scenario === 'partial') {
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, '');
      assert.equal(snapshot.source.state, scenario === 'complete' ? 'OK' : 'PARTIAL');
      assert.equal(
        snapshot.source.error,
        scenario === 'complete' ? null : 'Collection cap reached; some GitHub sources may be missing',
      );
      assert.ok(Number.isFinite(Date.parse(snapshot.source.last_sync_at)));
      assert.deepEqual(snapshot.messages, []);
      assert.deepEqual(snapshot.threads, []);
      assert.equal(calls.length, scenario === 'complete' ? 1 : 40);
      assert.match(child.stdout, /Agent Forum synced: 0 messages across 0 threads/);
      if (scenario === 'partial')
        assert.ok(calls.some((endpoint) => endpoint.includes('/pulls?state=all&per_page=100&page=2')));
    } else {
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, /Agent Forum sync failed; previous trusted snapshot retained/);
      assert.doesNotMatch(child.stdout, /Agent Forum synced:/);
      assert.equal(calls.length, 1);
      assert.equal(snapshot.source.state, 'ERROR');
      assert.equal(snapshot.source.error, 'GitHub source unavailable');
      assert.equal(
        snapshot.source.last_sync_at,
        scenario === 'missing-previous' ? null : previous.source.last_sync_at,
      );
      assert.deepEqual(snapshot.messages, scenario === 'missing-previous' ? [] : previous.messages);
      assert.deepEqual(snapshot.threads, scenario === 'missing-previous' ? [] : previous.threads);
    }
    assert.ok(html.includes(JSON.stringify(snapshot).replaceAll('<', '\\u003c')));
    for (let index = 0; index < outputs.length; index++) {
      assert.deepEqual(await readFile(resolve(root, outputs[index])), originalOutputs[index]);
    }
  });
}
