import test from 'node:test';
import assert from 'node:assert/strict';

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
