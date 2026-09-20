import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { browserManifestDigest, browserCoverageSources, writeBrowserArtifact } from './browser-evidence.mjs';

const snapshotExpression = 'JSON.stringify(globalThis.__coverage__ ?? {})';
const resetExpression = `(() => {
  for (const coverage of Object.values(globalThis.__coverage__ ?? {})) {
    for (const key of ['s', 'f']) for (const id of Object.keys(coverage[key])) coverage[key][id] = 0;
    for (const counts of Object.values(coverage.b)) counts.fill(0);
  }
})()`;

export function createBrowserCoverageLifecycle({
  manifest,
  outputDirectory,
  loaded,
  workflow = 'M3_PRODUCT',
}) {
  mkdirSync(outputDirectory, { recursive: true });
  const binding = {
    candidateCommit: manifest.candidateCommit,
    candidateTree: manifest.candidateTree,
    toolDigest: manifest.toolDigest,
    manifestSha256: browserManifestDigest(manifest),
  };
  const pages = new Map();
  const artifacts = [];
  const observations = [];
  let sequence = 0;
  let finished = false;
  function save(kind, data) {
    const ref = writeBrowserArtifact(outputDirectory, kind, data);
    artifacts.push(ref);
    return ref;
  }
  function start(state, reason) {
    assert.ok(!finished && !state.active, 'browser interval already active or finished');
    state.active = {
      ...binding,
      id: `browser-${randomUUID()}`,
      pageId: state.pageId,
      sequence: sequence++,
      workflow,
      kind: 'BROWSER_PAGE_INTERVAL',
      reason,
    };
    save('started', state.active);
  }
  function complete(state, extra) {
    assert.ok(state.active, 'browser interval has no start');
    const row = { ...state.active, ...extra };
    save('complete', row);
    observations.push(row);
    state.active = null;
  }
  function incomplete(state, reason, error, raw) {
    if (!state.active) return;
    complete(state, {
      complete: false,
      empty: true,
      sources: {},
      reason,
      ...(raw ? { raw } : {}),
      ...(error ? { error: { name: error.name, message: error.message } } : {}),
    });
  }
  async function capture(page, reason) {
    const state = pages.get(page);
    if (!state) return;
    await state.ready;
    if (state.setupError && !page.isClosed()) throw state.setupError;
    if (!state.active) return;
    const interval = state.active;
    let serialized;
    try {
      assert.ok(!page.isClosed(), 'browser page closed before flush');
      serialized = await page.evaluate(snapshotExpression);
      if (state.active !== interval) return { captured: false };
    } catch (error) {
      // A navigation can destroy the document before the old realm answers. This is
      // an incomplete lower-bound interval; the caller must still perform its real
      // navigation or close operation.
      if (state.active === interval) incomplete(state, reason, error);
      return { captured: false, transportError: error };
    }
    let raw;
    try {
      raw = save('raw', serialized);
      const value = JSON.parse(serialized);
      const sources = browserCoverageSources(manifest, value, loaded);
      // The retained raw bytes precede mutation of the real counter objects.
      try {
        await page.evaluate(resetExpression);
        if (state.active !== interval) return { captured: false, raw };
      } catch (error) {
        if (state.active === interval) incomplete(state, reason, error, raw);
        return { captured: false, transportError: error, raw };
      }
      complete(state, {
        complete: true,
        empty: Object.keys(value).length === 0,
        sources,
        reason,
        raw,
        loadedSources: [...loaded].sort(),
      });
      return { captured: true, raw };
    } catch (error) {
      // Once raw bytes exist, parse/graph/map failures are evidence failures and
      // must stop the workflow rather than being reclassified as transport loss.
      if (state.active === interval) incomplete(state, reason, error, raw);
      throw error;
    }
  }
  function registerPage(page) {
    if (pages.has(page)) return false;
    const state = {
      pageId: `page-${randomUUID()}`,
      active: null,
      transitioning: false,
      expectedNavigation: false,
      setupError: null,
    };
    pages.set(page, state);
    start(state, 'page-created');
    // Chromium's loader identity changes for a new document, but remains stable
    // for hash/history navigation. URL comparisons cannot distinguish those cases.
    state.ready = (async () => {
      const session = await page.context().newCDPSession(page);
      const { frameTree } = await session.send('Page.getFrameTree');
      let loaderId = frameTree.frame.loaderId;
      session.on('Page.frameNavigated', ({ frame }) => {
        if (finished || frame.parentId || frame.loaderId === loaderId) return;
        loaderId = frame.loaderId;
        if (state.expectedNavigation) {
          state.expectedNavigation = false;
          return;
        }
        incomplete(state, 'UNFLUSHED_NAVIGATION');
        if (!page.isClosed()) start(state, 'document-navigation');
      });
      await session.send('Page.enable');
    })().catch((error) => {
      state.setupError = error;
      incomplete(state, 'DOCUMENT_TRACKING_UNAVAILABLE', error);
    });
    for (const method of ['goto', 'reload']) {
      const original = page[method].bind(page);
      page[method] = async (...args) => {
        assert.ok(!state.transitioning, 'overlapping browser navigation');
        state.transitioning = true;
        try {
          await capture(page, `before-${method}`);
          start(state, method);
          state.expectedNavigation = true;
          return await original(...args);
        } catch (error) {
          incomplete(state, `${method}-failed`, error);
          throw error;
        } finally {
          state.expectedNavigation = false;
          state.transitioning = false;
        }
      };
    }
    const close = page.close.bind(page);
    page.close = async (...args) => {
      await capture(page, 'before-close');
      return close(...args);
    };
    page.on('close', () => incomplete(state, 'UNFLUSHED_CLOSE'));
    page.on('crash', () => incomplete(state, 'PAGE_CRASH'));
    return true;
  }
  async function flush(page, reason) {
    await capture(page, reason);
    if (!page.isClosed() && !pages.get(page).active) start(pages.get(page), `after-${reason}`);
  }
  async function finish() {
    assert.ok(!finished, 'browser collection already finished');
    const errors = [];
    for (const page of pages.keys()) {
      try {
        await capture(page, 'workflow-complete');
      } catch (error) {
        errors.push(error);
      }
    }
    finished = true;
    const index = writeBrowserArtifact(outputDirectory, 'index', { ...binding, artifacts });
    const result = { observations, artifacts, index };
    if (errors.length) {
      const error = new AggregateError(errors, 'browser coverage flush failed');
      error.browserCoverage = result;
      throw error;
    }
    return result;
  }
  return { registerPage, flush, finish };
}
