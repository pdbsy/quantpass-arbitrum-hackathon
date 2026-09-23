/* global window */
import assert from 'node:assert/strict';

const RECIPIENT = '0x9999999999999999999999999999999999999999';
const cases = [
  { kind: 'pass', cancel: 'back', first: '1' },
  { kind: 'pass', cancel: 'button', first: '1', second: '0.000000000000000001' },
  { kind: 'pass', cancel: 'button', first: '1', second: '0.000000000000000001', rejectFirst: true },
  { kind: 'pass', first: '1', second: '2', rejectFirst: true, keepOpen: true },
  { kind: 'vault', cancel: 'button', first: '1', second: '2' },
  { kind: 'vault', cancel: 'button', first: '1', second: '2', rejectFirst: true },
  { kind: 'vault', first: '1', second: '2', rejectFirst: true, keepOpen: true },
  { kind: 'approval', cancel: 'button', first: '1', second: '2' },
  { kind: 'approval', cancel: 'button', first: '1', second: '2', rejectFirst: true },
  { kind: 'approval', first: '1', second: '2', rejectFirst: true, keepOpen: true },
];

async function exercise(parent, origin, scenario) {
  const page = await parent.context().newPage();
  const pageErrors = [];
  const blocked = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let signalReady;
  const fixtureReady = new Promise((resolve) => {
    signalReady = resolve;
  });
  try {
    await page.exposeFunction('__fixtureReadySignal', () => signalReady());
    await page.addInitScript(
      ({ kind, rejectFirst }) => {
        window.AF = window.AF || {};
        void import('/src/m3-injected-runtime-fixture.ts')
          .then((module) => {
            const fixture = module.createM3InjectedRuntimeFixture();
            fixture.setCorrectNetwork();
            const runtime = fixture.runtime;
            let release;
            const gate = new Promise((resolve) => {
              release = resolve;
            });
            window.__releaseReview = release;
            window.__reviewCalls = 0;
            const delayFirst = async (method, args) => {
              const call = ++window.__reviewCalls;
              if (call === 1) {
                window.__reviewEntered = true;
                await gate;
                if (rejectFirst) {
                  window.__reviewResolved = true;
                  throw new Error('DEV_REVIEW_REJECTED');
                }
              }
              const review = await runtime[method](...args);
              if (call === 1) window.__reviewResolved = true;
              return review;
            };
            window.AF.m3OnchainRuntime = {
              get snapshot() {
                return runtime.snapshot;
              },
              get vaultSelection() {
                return runtime.vaultSelection;
              },
              subscribe: (...args) => runtime.subscribe(...args),
              connect: (...args) => runtime.connect(...args),
              refresh: (...args) => runtime.refresh(...args),
              selectVault: (...args) => runtime.selectVault(...args),
              reviewAction: (...args) =>
                kind === 'vault' ? delayFirst('reviewAction', args) : runtime.reviewAction(...args),
              confirmAction: (...args) => runtime.confirmAction(...args),
              reviewPassTransfer: (...args) =>
                kind === 'pass'
                  ? delayFirst('reviewPassTransfer', args)
                  : runtime.reviewPassTransfer(...args),
              confirmPassTransfer: (...args) => runtime.confirmPassTransfer(...args),
              reviewDepositApprovals: (...args) =>
                kind === 'approval'
                  ? delayFirst('reviewDepositApprovals', args)
                  : runtime.reviewDepositApprovals(...args),
              confirmDepositApproval: (...args) => runtime.confirmDepositApproval(...args),
            };
            window.__fixtureRequests = fixture.providerRequests;
            void window.__fixtureReadySignal();
          })
          .catch((error) => {
            window.__fixtureError = String(error);
          });
      },
      { kind: scenario.kind, rejectFirst: scenario.rejectFirst === true },
    );
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) await route.fallback();
      else {
        blocked.push(url.origin);
        await route.abort('blockedbyclient');
      }
    });
    await page.route('**/src/product-ui.ts*', async (route) => {
      await fixtureReady;
      await route.continue();
    });
    await page.goto(`${origin}/#/home`);
    await page.goto(`${origin}/#/trade/trend`);
    await page.locator('[aria-label="M3 product chain status"]').waitFor();
    assert.equal(await page.evaluate(() => window.__fixtureError), undefined);
    await page.locator('[data-chain-connect]').click();

    async function review(amount) {
      if (scenario.kind === 'pass') {
        await page.locator('[data-pass-transfer]:not([disabled])').waitFor();
        await page.locator('[data-pass-transfer]').click();
        await page.locator('dialog[open] [name="passRecipient"]').fill(RECIPIENT);
        await page.locator('dialog[open] [name="passAmount"]').fill(amount);
        await page.locator('dialog[open] [data-pass-review]').click();
      } else {
        const action = scenario.kind === 'approval' ? 'deposit' : 'withdraw';
        await page.locator(`[data-chain-action="${action}"]:not([disabled])`).waitFor();
        await page.locator(`[data-chain-action="${action}"]`).click();
        await page.locator('dialog[open] [name="chainAmount"]').fill(amount);
        await page.locator('dialog[open] [data-chain-review]').click();
      }
    }

    await review(scenario.first);
    await page.waitForFunction(() => window.__reviewEntered === true);
    if (scenario.keepOpen) {
      await page.evaluate(() => window.__releaseReview());
      await page
        .locator('dialog[open] [data-product-dialog-error]')
        .filter({ hasText: 'DEV_REVIEW_REJECTED' })
        .waitFor();
      const reviewSelector = scenario.kind === 'pass' ? '[data-pass-review]' : '[data-chain-review]';
      assert.equal(await page.locator(`dialog[open] ${reviewSelector}`).isEnabled(), true);
      await page
        .locator(`dialog[open] [name="${scenario.kind === 'pass' ? 'passAmount' : 'chainAmount'}"]`)
        .fill(scenario.second);
      await page.locator(`dialog[open] ${reviewSelector}`).click();
      const confirmSelector =
        scenario.kind === 'pass'
          ? '[data-pass-confirm]'
          : scenario.kind === 'vault'
            ? '[data-chain-confirm]'
            : '[data-chain-approve]';
      await page.locator(`dialog[open] ${confirmSelector}`).first().waitFor();
      const body = await page.locator('dialog[open]').textContent();
      assert.match(
        body,
        scenario.kind === 'pass'
          ? /2000000000000000000 Pass base units/
          : scenario.kind === 'vault'
            ? /2000000 AF-USDC base units/
            : /required 2000000/,
      );
      assert.doesNotMatch(body, /DEV_REVIEW_REJECTED/);
      assert.equal(
        await page.evaluate(
          () => window.__fixtureRequests.filter((request) => request.method === 'eth_sendTransaction').length,
        ),
        0,
      );
      await page.locator('dialog[open] [data-close]').click();
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(blocked, []);
      return;
    }
    if (scenario.cancel === 'back') {
      await page.goBack();
      assert.equal(new URL(page.url()).hash, '#/home');
    } else await page.locator('dialog[open] [data-close]').click();
    assert.equal(await page.locator('dialog[open]').count(), 0);

    if (scenario.second) {
      await review(scenario.second);
      const selector =
        scenario.kind === 'pass'
          ? 'dialog[open] [data-pass-confirm]'
          : scenario.kind === 'vault'
            ? 'dialog[open] [data-chain-confirm]'
            : 'dialog[open] [data-chain-approve]';
      await page.locator(selector).first().waitFor();
    }
    await page.evaluate(() => window.__releaseReview());
    await page.waitForFunction(() => window.__reviewResolved === true);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('dialog[open]').count(), scenario.second ? 1 : 0);
    if (scenario.second) {
      const body = await page.locator('dialog[open]').textContent();
      if (scenario.kind === 'pass') {
        assert.match(body, /Amount1 Pass base units/);
        assert.doesNotMatch(body, /Amount1000000000000000000 Pass base units/);
        assert.doesNotMatch(body, /DEV_REVIEW_REJECTED/);
      } else if (scenario.kind === 'vault') {
        assert.match(body, /2000000 AF-USDC base units/);
        assert.doesNotMatch(body, /Amount1000000 AF-USDC base units/);
      } else {
        assert.match(body, /required 2000000/);
        assert.doesNotMatch(body, /required 1000000/);
      }
      await page.locator('dialog[open] [data-close]').click();
    }
    const sends = await page.evaluate(
      () => window.__fixtureRequests.filter((request) => request.method === 'eth_sendTransaction').length,
    );
    assert.equal(sends, 0, 'cancelled or superseded review cannot send a wallet transaction');
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(blocked, []);
  } finally {
    await page.close();
  }
}

export async function verifyM3LateReviewCancellation(page, origin) {
  const checks = [];
  for (const scenario of cases) {
    await exercise(page, origin, scenario);
    checks.push(
      scenario.keepOpen
        ? `Slow ${scenario.kind} review rejection leaves its current dialog correctable without wallet send`
        : `Slow ${scenario.kind} review cancelled by ${scenario.cancel}${scenario.rejectFirst ? ' with late rejection' : ''} cannot revive an old dialog or override a fresh review`,
    );
  }
  return checks;
}
