import assert from 'node:assert/strict';

export async function verifyM3FixtureNonOwnerTransfer(parent, origin) {
  const page = await parent.context().newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === origin) await route.fallback();
      else await route.abort('blockedbyclient');
    });
    await page.goto(`${origin}/?m3Fixture=1#/trade/trend`);
    const controls = page.locator('[data-m3-fixture-controls]');
    await controls.waitFor();
    await page.locator('[data-m3-fixture="network"]').click();
    await page.locator('[data-chain-connect]').click();
    await page.locator('[data-pass-transfer]:not([disabled])').waitFor();
    await page.locator('[data-m3-fixture="non-owner"]').click();
    await page.locator('[data-chain-connect]').click();
    await page.locator('[data-pass-transfer]:not([disabled])').waitFor();
    const before = JSON.parse(await controls.getAttribute('data-m3-fixture-evidence'));
    assert.equal(before.snapshot.onchain.owner, 'NON_OWNER');
    assert.equal(before.snapshot.onchain.passBalanceBaseUnits, '0');
    assert.equal(before.snapshot.onchain.writeMode, 'DISABLED');
    assert.equal(await page.locator('[data-chain-action="deposit"]').isDisabled(), true);
    await page.locator('[data-pass-transfer]').click();
    await page
      .locator('dialog[open] [name="passRecipient"]')
      .fill('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await page.locator('dialog[open] [name="passAmount"]').fill('0.000000000000000001');
    await page.locator('dialog[open] [data-pass-review]').click();
    await page.locator('dialog[open] [data-pass-confirm]').click();
    await page.locator('dialog[open]').waitFor({ state: 'hidden' });
    const after = JSON.parse(await controls.getAttribute('data-m3-fixture-evidence'));
    assert.equal(after.snapshot.transaction.status, 'SUBMISSION_AMBIGUOUS');
    assert.equal(after.snapshot.transaction.txHash, undefined);
    assert.equal(after.snapshot.onchain.passBalanceBaseUnits, '0');
    const sends = after.providerRequests.filter((request) => request.method === 'eth_sendTransaction');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].params[0].from, '0x9999999999999999999999999999999999999999');
    assert.equal(sends[0].params[0].to, '0x4444444444444444444444444444444444444444');
    assert.deepEqual(errors, []);
    return 'Unfunded non-owner Pass transfer through DEV controls has no receipt or balance change and retains uncertain submission';
  } finally {
    await page.close();
  }
}
