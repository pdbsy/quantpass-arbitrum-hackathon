/* global window, document */
import assert from 'node:assert/strict';

// Exercise the documented AF.m3OnchainRuntime port, including its optional legacy
// capabilities. This checks product-ui contracts, not the concrete runtime or chain.
export async function verifyRuntimePortJourneys(parent) {
  const origin = new URL(parent.url()).origin;
  const checks = [];
  for (const scenario of [
    'connect-error',
    'action-disabled-after-render',
    'approval-required',
    'allowance-lost',
    'allowance-invalid',
    'action-mismatch',
    'legacy-ready',
    'pass-unsupported',
    'pass-disabled-after-render',
    'pass-recipient-mismatch',
    'pass-amount-mismatch',
  ]) {
    const page = await parent.context().newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.addInitScript((scenario) => {
        const owner = '0x1111111111111111111111111111111111111111';
        const vault = '0x2222222222222222222222222222222222222222';
        const pass = '0x4444444444444444444444444444444444444444';
        window.runtimeBoundaryCalls = [];
        const snapshot = {
          wallet: { status: 'CONNECTED', address: owner },
          network: { status: 'CORRECT', chainId: 46630 },
          transaction: { status: 'IDLE' },
          onchain: {
            deployment: 'CONFIGURED',
            health: 'LIVE',
            readiness: 'FINALITY_UNKNOWN',
            owner: 'OWNER',
            vaultClosed: false,
            vaultAddress: vault,
            passAddress: pass,
            writeMode: 'INJECTED_MOCK',
            passTransferMode: 'INJECTED_MOCK',
            exitPath: 'SIMULATION',
            supportedActions: ['deposit', 'withdraw', 'close'],
            depositAuthorization: {
              spender: vault,
              afUsdcAllowanceBaseUnits: '1',
              passAllowanceBaseUnits: '1000000000000',
              approvalCapability: 'UNAVAILABLE',
            },
          },
        };
        const runtime = {
          snapshot,
          async connect() {
            window.runtimeBoundaryCalls.push('connect');
            throw 'Untrusted provider detail';
          },
          async refresh() {
            if (scenario === 'pass-disabled-after-render') snapshot.onchain.passTransferMode = 'DISABLED';
            if (scenario === 'action-disabled-after-render') snapshot.onchain.writeMode = 'DISABLED';
            if (scenario === 'allowance-lost') delete snapshot.onchain.depositAuthorization;
            if (scenario === 'allowance-invalid')
              snapshot.onchain.depositAuthorization.passAllowanceBaseUnits = '01';
          },
          subscribe() {
            return () => {};
          },
          async reviewAction(request) {
            window.runtimeBoundaryCalls.push('reviewAction');
            return {
              operationId: 'boundary-review',
              owner,
              request: scenario === 'action-mismatch' ? { ...request, usdcBaseUnits: '2' } : request,
            };
          },
          async confirmAction() {
            window.runtimeBoundaryCalls.push('confirmAction');
            throw Error('BOUNDARY_MUST_NOT_CONFIRM');
          },
        };
        if (scenario !== 'pass-unsupported') {
          runtime.reviewPassTransfer = async (request) => {
            window.runtimeBoundaryCalls.push('reviewPassTransfer');
            return {
              operationId: 'boundary-transfer',
              owner,
              token: pass,
              request:
                scenario === 'pass-recipient-mismatch'
                  ? { ...request, recipient: owner }
                  : { ...request, passBaseUnits: '2' },
            };
          };
          runtime.confirmPassTransfer = async () => {
            window.runtimeBoundaryCalls.push('confirmPassTransfer');
            throw Error('BOUNDARY_MUST_NOT_CONFIRM');
          };
        }
        window.AF = { m3OnchainRuntime: runtime };
      }, scenario);
      await page.goto(`${origin}/#/trade/trend`);
      await page.locator('[data-product-login="alice"]').click();
      await page.waitForFunction(() =>
        /^(READY|EMPTY)$/.test(document.querySelector('[data-product-state]')?.textContent ?? ''),
      );
      if (scenario === 'connect-error') {
        await page.locator('[data-chain-connect]').click();
        await page.waitForFunction(
          () => document.querySelector('[data-product-state]')?.textContent === 'ERROR',
        );
        assert.match(await page.locator('[role="alert"]').first().textContent(), /REQUEST_FAILED/);
        assert.doesNotMatch(await page.locator('body').textContent(), /Untrusted provider detail/);
      } else if (scenario.startsWith('pass-')) {
        if (scenario === 'pass-disabled-after-render')
          await page.evaluate(() => window.AF.m3OnchainRuntime.refresh());
        await page.locator('[data-pass-transfer]').click();
        if (scenario === 'pass-unsupported' || scenario === 'pass-disabled-after-render') {
          assert.match(
            await page.locator('[role="alert"]').first().textContent(),
            /PASS_TRANSFER_UNAVAILABLE/,
          );
          assert.equal(await page.locator('dialog[open]').count(), 0);
        } else {
          await page.locator('[name="passRecipient"]').fill('0x9999999999999999999999999999999999999999');
          await page.locator('[name="passAmount"]').fill('0.000000000000000001');
          await page.locator('[data-pass-review]').click();
          await page.waitForFunction(() =>
            document
              .querySelector('[data-product-dialog-error]')
              ?.textContent.includes('PASS_TRANSFER_REVIEW_MISMATCH'),
          );
          assert.equal(await page.locator('[data-pass-confirm]').count(), 0);
        }
      } else if (scenario === 'action-disabled-after-render') {
        await page.evaluate(() => window.AF.m3OnchainRuntime.refresh());
        await page.locator('[data-chain-action="deposit"]').click();
        assert.match(await page.locator('[role="alert"]').first().textContent(), /CHAIN_ACTION_UNAVAILABLE/);
        assert.equal(await page.locator('dialog[open]').count(), 0);
      } else {
        await page.locator('[data-chain-action="deposit"]').click();
        await page.locator('[name="chainAmount"]').fill(scenario === 'approval-required' ? '1' : '0.000001');
        if (scenario.startsWith('allowance-'))
          await page.evaluate(() => window.AF.m3OnchainRuntime.refresh());
        await page.locator('[data-chain-review]').click();
        if (scenario === 'legacy-ready') {
          await page.locator('[data-chain-confirm]').waitFor();
          assert.match(await page.locator('dialog[open]').textContent(), /1 AF-USDC base units/);
          await page.locator('dialog[open] [data-close]').click();
        } else {
          const expected =
            scenario === 'approval-required'
              ? 'DEPOSIT_APPROVAL_REQUIRED_UNSUPPORTED'
              : scenario === 'action-mismatch'
                ? 'CHAIN_ACTION_REVIEW_MISMATCH'
                : 'DEPOSIT_ALLOWANCES_UNAVAILABLE';
          await page.waitForFunction(
            (expected) =>
              document.querySelector('[data-product-dialog-error]')?.textContent.includes(expected),
            expected,
          );
          assert.equal(await page.locator('[data-chain-confirm]').count(), 0);
        }
      }
      const calls = await page.evaluate(() => window.runtimeBoundaryCalls);
      assert.equal(
        calls.some((call) => call.startsWith('confirm')),
        false,
      );
      if (scenario === 'approval-required' || scenario.startsWith('allowance-'))
        assert.equal(calls.includes('reviewAction'), false);
      assert.deepEqual(errors, []);
      checks.push(`Runtime port ${scenario}: visible contract outcome, no confirmation or transaction`);
    } finally {
      await page.close();
    }
  }
  return checks;
}
