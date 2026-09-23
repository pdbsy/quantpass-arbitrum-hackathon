import assert from 'node:assert/strict';

export async function verifyProductLateConfirmIsolation(parent, origin) {
  const page = await parent.context().newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const checks = [];
  try {
    await page.goto(`${origin}/#/market`);
    await page.locator('[data-product-login="bob"]').click();
    await page
      .locator('[data-product-state]')
      .filter({ hasText: /READY|EMPTY/ })
      .waitFor();
    await page.locator('[data-product-strategy="satellite-flow-demo"]').first().click();
    await page.locator('[data-product-claim="satellite-flow-demo"]').click();

    for (const kind of ['claim', 'command']) {
      if (kind === 'command') {
        await page.locator('[data-product-command="deposit"]').first().click();
        await page.locator('dialog[open] [name="amount"]').fill('1');
        await page.locator('dialog[open] [data-product-review]').click();
      }
      let signalEntered;
      const entered = new Promise((resolve) => {
        signalEntered = resolve;
      });
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let posts = 0;
      const pattern = kind === 'claim' ? '**/api/v1/vaults' : '**/api/v1/vaults/*/commands';
      await page.route(pattern, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posts += 1;
        signalEntered();
        await gate;
        await route.continue();
      });
      await page.locator('dialog[open] [data-product-confirm]').click();
      await Promise.race([
        entered,
        new Promise((_, reject) => setTimeout(() => reject(Error(`NO_${kind.toUpperCase()}_POST`)), 10000)),
      ]);
      await page.locator('dialog[open] [data-close]').click();
      await page.locator('nav a[href="#/trade/trend"]').click();
      await page.locator('[data-asset="0"]').first().click();
      assert.match(await page.locator('dialog[open]').textContent(), /RESEARCH RELATION/);
      release();
      await page.locator('[data-product-state]').filter({ hasText: 'READY' }).waitFor();
      // The status publish precedes the awaiting click handler's final dialog check.
      await page.waitForTimeout(150);
      assert.equal(await page.locator('dialog[open]').count(), 1, `${kind} completion closed a newer dialog`);
      assert.match(await page.locator('dialog[open]').textContent(), /RESEARCH RELATION/);
      assert.equal(posts, 1, `${kind} sends only the original local API request`);
      assert.deepEqual(pageErrors, []);
      checks.push(`${kind} completion after Cancel preserves the newly opened browser dialog`);
      await page.locator('#close-dialog').click();
      await page.locator('nav a[href="#/market"]').click();
      await page.locator('[data-product-strategy="satellite-flow-demo"]').first().click();
    }
    await page.locator('[data-product-login="alice"]').click();
    await page.locator('[data-product-state]').filter({ hasText: 'READY' }).waitFor();
    return checks;
  } finally {
    await page.close();
  }
}
