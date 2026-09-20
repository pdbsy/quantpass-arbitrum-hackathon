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
    if (!state?.active) return;
    let serialized;
    try {
      assert.ok(!page.isClosed(), 'browser page closed before flush');
      serialized = await page.evaluate(snapshotExpression);
    } catch (error) {
      // A navigation can destroy the document before the old realm answers. This is
      // an incomplete lower-bound interval; the caller must still perform its real
      // navigation or close operation.
      incomplete(state, reason, error);
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
      } catch (error) {
        incomplete(state, reason, error, raw);
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
      incomplete(state, reason, error, raw);
      throw error;
    }
  }
  function registerPage(page) {
    assert.ok(!pages.has(page), 'browser page already registered');
    const state = { pageId: `page-${randomUUID()}`, active: null, transitioning: false };
    pages.set(page, state);
    start(state, 'page-created');
    for (const method of ['goto', 'reload']) {
      const original = page[method].bind(page);
      page[method] = async (...args) => {
        assert.ok(!state.transitioning, 'overlapping browser navigation');
        state.transitioning = true;
        try {
          await capture(page, `before-${method}`);
          start(state, method);
          return await original(...args);
        } catch (error) {
          incomplete(state, `${method}-failed`, error);
          throw error;
        } finally {
          state.transitioning = false;
        }
      };
    }
    const close = page.close.bind(page);
    page.close = async (...args) => {
      await capture(page, 'before-close');
      return close(...args);
    };
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || state.transitioning || page.isClosed()) return;
      // An unexpected document replacement lost its old JS realm. Never infer its hits.
      incomplete(state, 'UNFLUSHED_NAVIGATION');
      start(state, 'uncontrolled-navigation');
    });
    page.on('close', () => incomplete(state, 'UNFLUSHED_CLOSE'));
    page.on('crash', () => incomplete(state, 'PAGE_CRASH'));
  }
  async function flush(page, reason) {
    await capture(page, reason);
    if (!page.isClosed()) start(pages.get(page), `after-${reason}`);
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
