/* global document */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { runM3BrowserJourneys } from '../tools/verify-m3-browser.mjs';
import {
  scenario,
  prepareWeb,
  runUi,
  openM3,
  injectInlinePolicy,
  bounded,
  serializeError,
} from './helpers/browser-policy-inputs.mjs';

// Regression: dropping the native CSP console listener would let a tainted
// journey produce PASS. Both tests require its final assertion, not an earlier failure.
function assertPolicyAssertion(error, policy, driver) {
  assert.equal(error?.code, 'ERR_ASSERTION');
  assert.equal(error.name, 'AssertionError');
  assert.deepEqual(error.expected, []);
  assert.deepEqual(error.actual, [policy.console]);
  const assertionFrame = error.stack.split('\n').find((line) => /^\s+at /.test(line));
  assert.match(
    assertionFrame,
    new RegExp(driver.replaceAll('.', '\\.') + ':'),
    'the original driver final assertion must reject, not a nested helper',
  );
  assert.equal(policy.event.originalPolicy, policy.header);
  assert.match(policy.header, /script-src/);
  assert.match(policy.event.effectiveDirective, /^script-src/);
  assert.equal(policy.event.blockedURI, 'inline');
  assert.equal(policy.markerPresent, false);
  assert.equal(policy.event.disposition, 'enforce');
}

test(
  'UI CLI rejects a native CSP violation at its final assertion and closes owned resources',
  { timeout: 360_000 },
  async (t) => {
    await scenario(t, 'ui-csp', async (s) => {
      await prepareWeb(s, true);
      const child = await runUi(s);
      s.receipt.child = child;
      assert.equal(child.error, undefined, child.stderr);
      assert.equal(child.status, 1, child.stderr);
      assert.equal(child.signal, null);
      assert.doesNotMatch(child.stdout, /PASSED/);
      const policy = JSON.parse(await readFile(join(s.directory, 'policy.json'), 'utf8'));
      const error = JSON.parse(await readFile(join(s.directory, 'original-error.json'), 'utf8'));
      Object.assign(s.receipt, { policy, originalError: error });
      assertPolicyAssertion(error, policy, 'verify-ui-browser.mjs');
      const runs = await readdir(join(s.directory, '.checks/AF-UI01'));
      assert.equal(runs.length, 1);
      const result = JSON.parse(
        await readFile(join(s.directory, '.checks/AF-UI01', runs[0], 'result.json'), 'utf8'),
      );
      s.receipt.driver = result;
      assert.equal(result.status, 'FAILED');
      assert.ok(result.error.includes(policy.console));
      assert.equal(await readFile(join(s.directory, 'browser-disconnected'), 'utf8'), 'closed');
      assert.equal(await readFile(join(s.directory, 'app-closed'), 'utf8'), 'closed');
      await s.verifyPortReleased();
      s.receipt.cleanup.driverBrowserDisconnected = true;
      s.receipt.cleanup.driverBackendClosed = true;
      s.receipt.cleanup.driverPortReleased = true;
    });
  },
);

for (const mode of ['m3-csp', 'm3-other-origin']) {
  // Regression: routeLocal must block another origin, propagate the navigation
  // failure, then remove exactly its handlers so caller-owned Page remains usable.
  test(
    `${mode}: original M3 journey rejects native policy input and restores caller ownership`,
    { timeout: 180_000 },
    async (t) => {
      await scenario(t, mode, async (s) => {
        await prepareWeb(s, false);
        const resources = await openM3(s);
        const { page, origin, otherURL, requestCount, policyURL } = resources;
        const originalGoto = page.goto;
        const goto = originalGoto.bind(page);
        const baseline = { console: page.listeners('console'), pageerror: page.listeners('pageerror') };
        const registered = [];
        const removed = [];
        const originalRoute = page.route;
        const originalUnroute = page.unroute;
        page.route = async (...args) => {
          const result = await originalRoute.apply(page, args);
          registered.push(args);
          return result;
        };
        page.unroute = async (...args) => {
          const result = await originalUnroute.apply(page, args);
          removed.push(args);
          return result;
        };
        let policy;
        let navigationError;
        let requested;
        let injected = false;
        const failedRequests = [];
        const onFailed = (request) =>
          failedRequests.push({
            url: request.url(),
            failure: request.failure(),
            mainDocument: request.isNavigationRequest() && request.frame() === page.mainFrame(),
          });
        page.on('requestfailed', onFailed);
        page.goto = async (...args) => {
          if (injected) return goto(...args);
          injected = true;
          requested = args[0];
          if (mode === 'm3-other-origin') {
            try {
              return await goto(otherURL, args[1]);
            } catch (error) {
              navigationError = error;
              throw error;
            }
          }
          const response = await goto(...args);
          const policyResponse = page.waitForResponse(policyURL);
          await page.evaluate((url) => {
            const iframe = document.createElement('iframe');
            iframe.id = 'alphaforge-policy-frame';
            iframe.src = url;
            document.body.append(iframe);
          }, policyURL);
          const frameResponse = await policyResponse;
          const frame = await (await page.locator('#alphaforge-policy-frame').elementHandle()).contentFrame();
          await frame.waitForLoadState();
          policy = await injectInlinePolicy(frame, page, s.nonce);
          Object.assign(policy, {
            header: frameResponse.headers()['content-security-policy'],
            url: frame.url(),
            classification: 'CONTROLLED_SAME_ORIGIN_POLICY_RESPONSE',
          });
          s.receipt.policy = policy;
          await page.locator('#alphaforge-policy-frame').evaluate((element) => element.remove());
          return response;
        };
        let failure;
        try {
          await bounded(runM3BrowserJourneys(page, { origin, evidenceDirectory: s.directory }), 100_000, () =>
            page.close(),
          );
        } catch (error) {
          failure = error;
        } finally {
          page.goto = originalGoto;
          page.route = originalRoute;
          page.unroute = originalUnroute;
          page.off('requestfailed', onFailed);
        }
        s.receipt.originalError = serializeError(failure);
        s.receipt.requested = requested;
        s.receipt.failedRequests = failedRequests;
        assert.ok(failure, 'original journey must reject');
        assert.equal(
          existsSync(join(s.directory, 'result.json')),
          false,
          'original journey must not write PASS',
        );
        if (mode === 'm3-csp') {
          assertPolicyAssertion(failure, policy, 'verify-m3-browser.mjs');
          assert.equal(policy.url, policyURL);
        } else {
          assert.equal(failure, navigationError, 'same native navigation rejection must propagate');
          assert.equal(failure.name, 'Error');
          assert.match(failure.message, /net::ERR_BLOCKED_BY_CLIENT/);
          assert.deepEqual(failedRequests, [
            { url: otherURL, failure: { errorText: 'net::ERR_BLOCKED_BY_CLIENT' }, mainDocument: true },
          ]);
        }
        assert.equal(requestCount(), 0, 'guarded second-origin request must not reach the server');
        assert.deepEqual(page.listeners('console'), baseline.console);
        assert.deepEqual(page.listeners('pageerror'), baseline.pageerror);
        assert.equal(registered.length, 1);
        assert.equal(removed.length, 1);
        assert.equal(removed[0][0], registered[0][0]);
        assert.equal(removed[0][1], registered[0][1]);
        assert.equal(page.isClosed(), false);
        const response = await goto(otherURL);
        assert.equal(response.status(), 200);
        assert.equal(await page.textContent('body'), s.nonce);
        assert.equal(requestCount(), 1, 'same top-level request reaches server once after finally');
        Object.assign(s.receipt.cleanup, {
          listenersRestored: true,
          originalRouteRemoved: true,
          callerPageOpen: true,
          postFinallyDocumentRequests: requestCount(),
        });
      });
    },
  );
}
