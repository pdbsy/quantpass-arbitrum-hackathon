/* global window */
import assert from 'node:assert/strict';

const RECIPIENT = '0x9999999999999999999999999999999999999999';
const cases = [
  { kind: 'pass', outcome: 'reject', keepOpen: true },
  { kind: 'pass', outcome: 'success' },
  { kind: 'pass', outcome: 'reject' },
  { kind: 'vault', outcome: 'success' },
  { kind: 'vault', outcome: 'reject' },
  { kind: 'approval', outcome: 'success' },
  { kind: 'approval', outcome: 'reject' },
  { kind: 'approval', outcome: 'success', secondApproval: true },
];

async function exercise(parent, origin, scenario) {
  const page = await parent.context().newPage();
  const errors = [];
  const blocked = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let signalReady;
  const fixtureReady = new Promise((resolve) => {
    signalReady = resolve;
  });
  try {
    await page.exposeFunction('__fixtureReadySignal', () => signalReady());
    await page.addInitScript(
      ({ kind, outcome }) => {
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
            window.__releaseConfirm = release;
            window.__confirmCalls = 0;
            const delayFirst = async (method, args) => {
              const call = ++window.__confirmCalls;
              if (call === 1) {
                window.__confirmEntered = true;
                await gate;
                if (outcome === 'reject') {
                  window.__confirmResolved = true;
                  throw new Error('DEV_CONFIRM_REJECTED');
                }
              }
              try {
                const result = await runtime[method](...args);
                if (call === 1) window.__confirmResolved = true;
                return result;
              } catch (error) {
                if (call === 1) window.__confirmResolved = true;
                throw error;
              }
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
              reviewAction: (...args) => runtime.reviewAction(...args),
              confirmAction: (...args) =>
                kind === 'vault' ? delayFirst('confirmAction', args) : runtime.confirmAction(...args),
              reviewPassTransfer: (...args) => runtime.reviewPassTransfer(...args),
              confirmPassTransfer: (...args) =>
                kind === 'pass'
                  ? delayFirst('confirmPassTransfer', args)
                  : runtime.confirmPassTransfer(...args),
              reviewDepositApprovals: (...args) => runtime.reviewDepositApprovals(...args),
              confirmDepositApproval: (...args) =>
                kind === 'approval'
                  ? delayFirst('confirmDepositApproval', args)
                  : runtime.confirmDepositApproval(...args),
            };
            window.__fixtureRequests = fixture.providerRequests;
            void window.__fixtureReadySignal();
          })
          .catch((error) => {
            window.__fixtureError = String(error);
          });
      },
      { kind: scenario.kind, outcome: scenario.outcome },
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
        await page.locator('dialog[open] [data-pass-confirm]').waitFor();
      } else {
        const action = scenario.kind === 'vault' ? 'withdraw' : 'deposit';
        await page.locator(`[data-chain-action="${action}"]:not([disabled])`).waitFor();
        await page.locator(`[data-chain-action="${action}"]`).click();
        await page.locator('dialog[open] [name="chainAmount"]').fill(amount);
        await page.locator('dialog[open] [data-chain-review]').click();
        if (scenario.kind === 'vault') await page.locator('dialog[open] [data-chain-confirm]').waitFor();
        else await page.locator('dialog[open] [data-chain-approve="af-usdc"]').waitFor();
      }
    }

    await review('1');
    const confirmSelector =
      scenario.kind === 'pass'
        ? 'dialog[open] [data-pass-confirm]'
        : scenario.kind === 'vault'
          ? 'dialog[open] [data-chain-confirm]'
          : 'dialog[open] [data-chain-approve="af-usdc"]';
    await page.locator(confirmSelector).click();
    await page.waitForFunction(() => window.__confirmEntered === true);
    if (scenario.secondApproval) {
      await page.locator('dialog[open] [data-chain-approve="pass"]').click();
      await page
        .locator('dialog[open] [data-product-dialog-error]')
        .filter({ hasText: 'DEPOSIT_APPROVAL_REVIEW_REQUIRED' })
        .waitFor();
      assert.equal(await page.evaluate(() => window.__confirmCalls), 1);
      assert.equal(
        await page.evaluate(
          () => window.__fixtureRequests.filter((request) => request.method === 'eth_sendTransaction').length,
        ),
        0,
      );
      await page.evaluate(() => window.__releaseConfirm());
      await page.locator('dialog[open]').waitFor({ state: 'hidden' });
      const sends = await page.evaluate(() =>
        window.__fixtureRequests.filter((request) => request.method === 'eth_sendTransaction'),
      );
      assert.equal(sends.length, 1);
      assert.equal(sends[0].params[0].to, '0x3333333333333333333333333333333333333333');
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, []);
      return;
    }
    if (scenario.keepOpen) {
      await page.evaluate(() => window.__releaseConfirm());
      await page
        .locator('dialog[open] [data-product-dialog-error]')
        .filter({ hasText: /DEV_CONFIRM_REJECTED.*Do not retry automatically/ })
        .waitFor();
      assert.equal(await page.locator(confirmSelector).isDisabled(), true);
      assert.equal(
        await page.evaluate(
          () => window.__fixtureRequests.filter((request) => request.method === 'eth_sendTransaction').length,
        ),
        0,
      );
      await page.locator('dialog[open] [data-close]').click();
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, []);
      return;
    }
    await page.locator('dialog[open] [data-close]').click();
    assert.equal(await page.locator('dialog[open]').count(), 0);

    await review('2');
    const freshDialog = await page.locator('dialog[open]').textContent();
    assert.match(freshDialog, scenario.kind === 'pass' ? /2000000000000000000 Pass base units/ : /2000000/);
    await page.evaluate(() => window.__releaseConfirm());
    await page.waitForFunction(() => window.__confirmResolved === true);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('dialog[open]').count(), 1, 'old confirm cannot close the new review');
    assert.equal(await page.locator('dialog[open]').textContent(), freshDialog);
    const sends = await page.evaluate(
      () => window.__fixtureRequests.filter((request) => request.method === 'eth_sendTransaction').length,
    );
    assert.equal(sends, scenario.outcome === 'success' ? 1 : 0);
    if (scenario.outcome === 'success')
      assert.equal(
        await page.evaluate(() => window.AF.m3OnchainRuntime.snapshot.transaction.status),
        'SUBMITTED',
      );
    await page.locator('dialog[open] [data-close]').click();
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  } finally {
    await page.close();
  }
}

export async function verifyM3LateConfirmIsolation(page, origin) {
  const checks = [];
  for (const scenario of cases) {
    await exercise(page, origin, scenario);
    checks.push(
      scenario.secondApproval
        ? 'Second token approval while the first is pending requires a fresh review and makes no extra send'
        : scenario.keepOpen
          ? 'Active Pass confirmation rejection stays visible, disables retry and sends no wallet request'
          : `Slow ${scenario.kind} ${scenario.outcome} after Cancel preserves the new review and exact wallet send count`,
    );
  }
  return checks;
}
