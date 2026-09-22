import test from 'node:test';
import assert from 'node:assert/strict';

import { buildForumSnapshot, parseAgentMessages } from '../tools/agent-forum.mjs';
import { renderForumPage } from '../tools/build-agent-forum.mjs';
import { createFailureSnapshot, parseGithubRemote } from '../tools/sync-agent-forum.mjs';

test('forum renderer injects each asset once and makes snapshot JSON script-safe', () => {
  const html = renderForumPage(
    '<main>__AF_SNAPSHOT__</main><script>__AF_APP__</script>',
    'globalThis.rendered = true;',
    {
      schema_version: 1,
      source: { state: 'OK', error: null, last_sync_at: '2026-09-12T10:00:00.000Z' },
      messages: [{ body: '</script><img src=x onerror=alert(1)>' }],
      threads: [],
    },
  );
  assert.doesNotMatch(html, /__AF_(?:SNAPSHOT|APP)__/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.match(html, /\\u003c\/script>\\u003cimg/);
  assert.match(html, /globalThis\.rendered = true/);
  assert.throws(() => renderForumPage('__AF_SNAPSHOT____AF_SNAPSHOT____AF_APP__', '', {}));
});

test('GitHub collector accepts only the configured repository remote', () => {
  assert.equal(
    parseGithubRemote('git@github.com:pdbsy/quantpass-arbitrum-hackathon.git'),
    'pdbsy/quantpass-arbitrum-hackathon',
  );
  assert.equal(
    parseGithubRemote('https://github.com/pdbsy/quantpass-arbitrum-hackathon.git'),
    'pdbsy/quantpass-arbitrum-hackathon',
  );
  assert.throws(() => parseGithubRemote('git@github.com:pdbsy/quantpass.git'));
  assert.throws(() => parseGithubRemote('git@github.com:other/repo.git'));
  assert.throws(() => parseGithubRemote('https://evil.example/pdbsy/quantpass-arbitrum-hackathon.git'));
});

test('failed sync preserves last trusted messages and records only a bounded generic error', () => {
  const previous = {
    schema_version: 1,
    source: { state: 'OK', error: null, last_sync_at: '2026-09-12T10:00:00.000Z' },
    messages: [{ message_id: 'afm-1', body: 'trusted' }],
    threads: [{ thread: 'AF-AGENT-SETUP' }],
  };
  const failed = createFailureSnapshot(previous, 'GitHub source unavailable');
  assert.equal(failed.source.state, 'ERROR');
  assert.equal(failed.source.error, 'GitHub source unavailable');
  assert.equal(failed.source.last_sync_at, previous.source.last_sync_at);
  assert.deepEqual(failed.messages, previous.messages);
  assert.deepEqual(failed.threads, previous.threads);
  assert.throws(() => createFailureSnapshot(previous, 'x'.repeat(201)));
});

test('PR11-P5 GitHub collector paginates comments beyond 100 and exposes hard bounds', async () => {
  const { collectGithubForum } = await import('../tools/sync-agent-forum.mjs');
  for (const count of [150, 600]) {
    const calls = [];
    const result = await collectGithubForum('pdbsy/quantpass-arbitrum-hackathon', async (endpoint) => {
      calls.push(endpoint);
      const url = new URL(endpoint, 'https://api.github.com/');
      const page = Number(url.searchParams.get('page'));
      if (url.pathname.endsWith('/pulls')) return [{ number: 11, comments: [], reviews: [] }];
      if (url.pathname.endsWith('/reviews')) return [];
      return Array.from({ length: count }, (_, n) => ({ body: `comment-${n}` })).slice(
        (page - 1) * 100,
        page * 100,
      );
    });
    assert.equal(result.pulls[0].comments.length, Math.min(count, 499));
    assert.equal(result.partial, count > 499);
    assert.ok(calls.some((path) => path.includes('comments?per_page=100&page=2')));
    assert.ok(result.calls <= 40);
  }
});

test('PR11-P5 bounded PR pagination and request budget report PARTIAL rather than silent OK', async () => {
  const { collectGithubForum } = await import('../tools/sync-agent-forum.mjs');
  const result = await collectGithubForum('pdbsy/quantpass-arbitrum-hackathon', async (endpoint) => {
    const url = new URL(endpoint, 'https://api.github.com/');
    if (!url.pathname.endsWith('/pulls')) return [];
    const page = Number(url.searchParams.get('page'));
    return Array.from({ length: 201 }, (_, n) => ({ number: n + 1 })).slice((page - 1) * 100, page * 100);
  });
  assert.equal(result.pulls.length, 200);
  assert.equal(result.partial, true);
  assert.equal(result.calls, 40);
});

test('a missing or malformed previous Forum snapshot cannot invent trusted messages after sync failure', () => {
  for (const previous of [undefined, null, {}, { source: {}, messages: {}, threads: 'bad' }]) {
    const failure = createFailureSnapshot(previous, 'GitHub source unavailable');
    assert.deepEqual(failure, {
      schema_version: 1,
      source: { state: 'ERROR', error: 'GitHub source unavailable', last_sync_at: null },
      messages: [],
      threads: [],
    });
  }
});

test('Forum collection rejects malformed or oversized pages without declaring partial results complete', async () => {
  const { collectGithubForum } = await import('../tools/sync-agent-forum.mjs');
  for (const page of [null, {}, Array.from({ length: 101 }, (_, index) => ({ number: index + 1 }))]) {
    let calls = 0;
    await assert.rejects(
      collectGithubForum('pdbsy/quantpass-arbitrum-hackathon', async () => {
        calls++;
        return page;
      }),
      /Invalid bounded GitHub page/,
    );
    assert.equal(calls, 1);
  }
});

test('Forum rejects a complete header block without Body and never replaces a newer message with stale content', () => {
  const url = 'https://github.com/pdbsy/quantpass-arbitrum-hackathon/pull/22';
  const headers = `[AGENT-MESSAGE]
Schema-Version: 1
Agent: Macbeth01
To: Macbeth02
Type: NOTICE
Thread: M3-01-PHASE1-CLOSEOUT
Reply-To: NONE
Related-PR: ${url}`;
  const record = {
    source_type: 'PR_COMMENT',
    source_url: `${url}#issuecomment-1`,
    pr_url: url,
    pr_number: 22,
    github_author: 'pdbsy',
    pr_author: 'pdbsy',
    pr_head_ref: 'macbeth01/m3-phase1-closeout',
    pr_title: '[Macbeth01][M3-01-PHASE1-CLOSEOUT] Local fixture',
    pr_head_repo: 'pdbsy/quantpass-arbitrum-hackathon',
    created_at: '2026-09-22T01:00:00.000Z',
    updated_at: '2026-09-22T03:00:00.000Z',
    text: `${headers}\nBody:\nCurrent instruction\n[/AGENT-MESSAGE]`,
  };
  assert.throws(
    () => parseAgentMessages({ ...record, text: `${headers}\n[/AGENT-MESSAGE]` }),
    /missing required fields/,
  );
  const older = {
    ...record,
    updated_at: '2026-09-22T02:00:00.000Z',
    text: record.text.replace('Current instruction', 'Stale instruction'),
  };
  for (const records of [
    [record, older],
    [older, record],
  ]) {
    const snapshot = buildForumSnapshot(records, { syncedAt: '2026-09-22T04:00:00.000Z' });
    assert.equal(snapshot.source.state, 'OK');
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.messages[0].body, 'Current instruction');
    assert.equal(snapshot.messages[0].updated_at, record.updated_at);
    assert.equal(snapshot.threads[0].last_updated_at, record.updated_at);
  }
});
