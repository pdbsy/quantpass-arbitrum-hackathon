import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asAddress } from '../packages/chain-adapter/src/types.ts';
import { renderM3DepositApprovalDialog, runM3DialogAction } from '../apps/web/src/m3-product-dialog.ts';

test('failed chain review shows its own error and restores the review control', async () => {
  const control = { disabled: false };
  let message = 'stale API error';

  const completed = await runM3DialogAction(
    'review',
    control,
    () => Promise.reject(new Error('INVALID_AF_USDC_AMOUNT')),
    (value) => {
      message = value;
    },
  );

  assert.equal(completed, false);
  assert.equal(control.disabled, false);
  assert.equal(message, 'INVALID_AF_USDC_AMOUNT');

  const corrected = await runM3DialogAction(
    'review',
    control,
    () => Promise.resolve(),
    (value) => {
      message = value;
    },
  );
  assert.equal(corrected, true);
  assert.equal(control.disabled, true);
  assert.equal(message, '');
});

test('failed chain confirmation stays disabled and requires a fresh review', async () => {
  const control = { disabled: false };
  let message = '';
  let attempts = 0;

  const completed = await runM3DialogAction(
    'confirm',
    control,
    () => {
      attempts += 1;
      return Promise.reject(new Error('PROVIDER_RESULT_UNKNOWN'));
    },
    (value) => {
      message = value;
    },
  );

  assert.equal(completed, false);
  assert.equal(attempts, 1);
  assert.equal(control.disabled, true);
  assert.match(message, /PROVIDER_RESULT_UNKNOWN/);
  assert.match(message, /Do not retry automatically/);
  assert.match(message, /new review/);
});

test('deposit approval dialog exposes only exact token-bound finite requirements', () => {
  const owner = asAddress('0x1111111111111111111111111111111111111111');
  const vault = asAddress('0x2222222222222222222222222222222222222222');
  const html = renderM3DepositApprovalDialog({
    owner,
    vaultAddress: vault,
    request: { kind: 'deposit', usdcBaseUnits: '1000001' },
    requirements: [
      {
        kind: 'af-usdc',
        token: asAddress('0x3333333333333333333333333333333333333333'),
        spender: vault,
        requiredRaw: '1000001',
        allowance: '0',
        sufficient: false,
      },
      {
        kind: 'pass',
        token: asAddress('0x4444444444444444444444444444444444444444'),
        spender: vault,
        requiredRaw: '1000001000000000000',
        allowance: '0',
        sufficient: false,
      },
    ],
  });

  assert.match(html, /data-chain-approve="af-usdc"/);
  assert.match(html, /data-chain-approve="pass"/);
  assert.match(html, /required 1000001/);
  assert.match(html, /required 1000001000000000000/);
  assert.equal((html.match(new RegExp(vault, 'g')) ?? []).length, 2);
  assert.doesNotMatch(html, /unlimited|infinite/i);
});

test('non-Error wallet rejection remains a visible failure and never invites blind confirmation retry', async () => {
  for (const phase of ['review', 'confirm'] as const) {
    const control = { disabled: false };
    let message = '';
    let calls = 0;
    const success = await runM3DialogAction(
      phase,
      control,
      () => {
        calls++;
        return Promise.reject({ code: 4001, message: 'untrusted wallet text' });
      },
      (value) => {
        message = value;
      },
    );
    assert.equal(success, false);
    assert.equal(calls, 1);
    assert.match(message, /CHAIN_REQUEST_FAILED/);
    assert.doesNotMatch(message, /untrusted wallet text/);
    assert.equal(control.disabled, phase === 'confirm');
    if (phase === 'confirm') assert.match(message, /Do not retry automatically/);
  }
});
