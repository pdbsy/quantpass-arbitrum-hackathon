import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBrowserCoverageLifecycle } from '../tools/coverage/browser-lifecycle.mjs';
import { replayBrowserCoverage } from '../tools/coverage/browser-evidence.mjs';

// The page double controls only CDP/realm timing. The lifecycle, persisted artifacts,
// and independent raw replay are real; no assertion infers hits from the double.
function fixture(t, { setupError, closed = false } = {}) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'alphaforge-lifecycle-boundary-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const manifest = {
    candidateCommit: '1'.repeat(40),
    candidateTree: '2'.repeat(40),
    toolDigest: '3'.repeat(64),
    sources: {},
  };
  const session = new EventEmitter();
  let readyResolve;
  const ready = new Promise((resolve) => (readyResolve = resolve));
  session.send = async (method) => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { loaderId: 'initial' } } };
    assert.equal(method, 'Page.enable');
    readyResolve();
  };
  const page = new EventEmitter();
  page.closed = closed;
  page.isClosed = () => page.closed;
  page.context = () => ({
    newCDPSession: async () => {
      if (setupError) throw setupError;
      return session;
    },
  });
  page.evaluate = async (expression) => (expression.startsWith('JSON.stringify') ? '{}' : undefined);
  page.goto = async () => {
    throw new Error('NAVIGATION_FAILED');
  };
  page.reload = page.goto;
  page.close = async () => {
    page.closed = true;
    page.emit('close');
  };
  const tracker = createBrowserCoverageLifecycle({ manifest, outputDirectory, loaded: new Set() });
  const replay = (result) => {
    const actual = replayBrowserCoverage({ manifest, outputDirectory, index: result.index });
    assert.deepEqual(actual.observations, result.observations);
    assert.ok(actual.observations.every((row) => Object.keys(row.sources).length === 0));
    return actual.observations;
  };
  return { tracker, page, session, ready, replay };
}

test('closed unregistered pages cannot create fictitious lifecycle evidence', async (t) => {
  const f = fixture(t, { closed: true });
  await f.tracker.flush(f.page, 'unknown');
  const rows = f.replay(await f.tracker.finish());
  assert.deepEqual(rows, []);
});

for (const closed of [false, true])
  test(`CDP setup failure retains incomplete evidence when page closed=${closed}`, async (t) => {
    const failure = new Error('CDP_UNAVAILABLE');
    const f = fixture(t, { closed, setupError: failure });
    f.tracker.registerPage(f.page);
    if (closed) {
      const rows = f.replay(await f.tracker.finish());
      assert.equal(rows.length, 1);
      assert.equal(rows[0].complete, false);
      assert.equal(rows[0].reason, 'DOCUMENT_TRACKING_UNAVAILABLE');
    } else {
      await assert.rejects(f.tracker.finish(), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], failure);
        const rows = f.replay(error.browserCoverage);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].complete, false);
        return true;
      });
    }
  });

for (const stage of ['snapshot', 'reset'])
  for (const failure of [false, true])
    test(`${stage} completion after document loss cannot complete the obsolete interval (reject=${failure})`, async (t) => {
      const f = fixture(t);
      let enteredResolve;
      const entered = new Promise((resolve) => (enteredResolve = resolve));
      let release;
      const gate = new Promise((resolve, reject) => (release = failure ? reject : resolve));
      f.page.evaluate = async (expression) => {
        const snapshot = expression.startsWith('JSON.stringify');
        if (snapshot === (stage === 'snapshot')) {
          enteredResolve();
          await gate;
        }
        return snapshot ? '{}' : undefined;
      };
      f.tracker.registerPage(f.page);
      await f.ready;
      const pending = f.tracker.flush(f.page, 'pending');
      await entered;
      f.page.closed = true;
      f.page.emit('crash');
      release(failure ? new Error('REALM_GONE') : undefined);
      await pending;
      const rows = f.replay(await f.tracker.finish());
      assert.equal(rows.length, 1);
      assert.equal(rows[0].reason, 'PAGE_CRASH');
      assert.equal(rows[0].complete, false);
    });

test('reset failure preserves raw bytes but contributes zero before a later successful interval', async (t) => {
  const f = fixture(t);
  let once = true;
  f.page.evaluate = async (expression) => {
    if (expression.startsWith('JSON.stringify')) return '{}';
    if (once) {
      once = false;
      throw new Error('RESET_LOST');
    }
  };
  f.tracker.registerPage(f.page);
  await f.tracker.flush(f.page, 'checkpoint');
  const rows = f.replay(await f.tracker.finish());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].complete, false);
  assert.ok(rows[0].raw);
  assert.equal(rows[0].error.message, 'RESET_LOST');
  assert.equal(rows[1].complete, true);
});

test('subframes, repeated loaders and post-finish CDP events cannot invent document intervals', async (t) => {
  const f = fixture(t);
  f.tracker.registerPage(f.page);
  await f.ready;
  f.session.emit('Page.frameNavigated', { frame: { loaderId: 'child', parentId: 'parent' } });
  f.session.emit('Page.frameNavigated', { frame: { loaderId: 'initial' } });
  const result = await f.tracker.finish();
  assert.equal(f.replay(result).length, 1);
  f.session.emit('Page.frameNavigated', { frame: { loaderId: 'late' } });
  assert.equal(f.replay(result).length, 1);
});

test('navigation received after page close cannot reopen its interval', async (t) => {
  const f = fixture(t);
  f.tracker.registerPage(f.page);
  await f.ready;
  f.page.closed = true;
  f.session.emit('Page.frameNavigated', { frame: { loaderId: 'late-document' } });
  await f.tracker.flush(f.page, 'closed');
  const rows = f.replay(await f.tracker.finish());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'UNFLUSHED_NAVIGATION');
  assert.equal(rows[0].complete, false);
});

test('navigation failure remains a caller-visible failure and leaves its started interval incomplete', async (t) => {
  const f = fixture(t);
  f.tracker.registerPage(f.page);
  await assert.rejects(f.page.goto('about:blank'), /NAVIGATION_FAILED/);
  const rows = f.replay(await f.tracker.finish());
  assert.deepEqual(
    rows.map((row) => row.complete),
    [true, false],
  );
  assert.equal(rows[1].reason, 'goto-failed');
});

test('invalid persisted graph cannot be downgraded to a successful browser finish', async (t) => {
  const f = fixture(t);
  f.page.evaluate = async () => '{"unregistered":{}}';
  f.tracker.registerPage(f.page);
  await assert.rejects(f.tracker.finish(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0].message, /unregistered browser graph/);
    const rows = f.replay(error.browserCoverage);
    assert.equal(rows[0].complete, false);
    assert.ok(rows[0].raw);
    return true;
  });
});
