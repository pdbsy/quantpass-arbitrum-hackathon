/* global window, document */
import assert from 'node:assert/strict';

// Persisted inputs and HTTP responses are external boundaries. Actions below use
// the shipped controls; no obsolete renderer or private controller is invoked.
export async function verifyRecoveryJourneys(parent) {
  const origin = new URL(parent.url()).origin;
  const page = await parent.context().newPage();
  const errors = [];
  const checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function reloadRecoveryPage() {
    const persisted = await page.evaluate(() => localStorage.getItem('alphaforge.prototype.v3'));
    let response = await page.reload();
    // The full driver shares the server's real per-IP request budget, including
    // document/asset loads. A throttled document is JSON, not a broken UI page.
    if (response?.status() === 429) {
      assert.deepEqual(await response.json(), { error: 'RATE_LIMITED' });
      const retryAfter = response.headers()['retry-after'];
      assert.match(retryAfter ?? '', /^[1-9][0-9]*$/, '429 must specify its real wait');
      const seconds = Number(retryAfter);
      assert.ok(seconds <= 60, 'retry must stay within the configured local window');
      await page.waitForTimeout(seconds * 1000 + 100);
      response = await page.reload();
      assert.equal(response?.status(), 200, 'only one retry is allowed after the real deadline');
      assert.equal(
        await page.evaluate(() => localStorage.getItem('alphaforge.prototype.v3')),
        persisted,
        'throttled navigation must not change the persisted recovery fixture',
      );
      checks.push(
        'A real HTTP 429 document reload honors Retry-After once and preserves the exact persisted recovery fixture',
      );
    }
    assert.equal(response?.status(), 200, 'recovery reload must serve the actual UI');
  }
  try {
    await page.goto(`${origin}/#/account/settings`);
    const pristine = await page.evaluate(() => {
      window.AF.store.reset();
      return window.AF.store.read();
    });
    for (const raw of [
      null,
      false,
      7,
      { ...pristine, passes: null },
      { ...pristine, passes: { trend: null } },
    ]) {
      await page.evaluate((raw) => localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(raw)), raw);
      await reloadRecoveryPage();
      const state = await page.evaluate(() => ({
        state: window.AF.store.read(),
        recovery: window.AF.store.recovery,
      }));
      assert.match(state.recovery, /could not be read/);
      assert.equal(state.state.idle, 1000000);
      assert.equal(state.state.netFunding, 1000000);
      assert.deepEqual(state.state.allocated, pristine.allocated);
      assert.deepEqual(state.state.pending, []);
      assert.deepEqual(state.state.passes, pristine.passes);
    }
    checks.push(
      'Persisted null, primitive and invalid Pass records recover explicitly to a balanced demo ledger',
    );

    await page.evaluate((pristine) => {
      const state = structuredClone(pristine);
      state.posts = Array.from({ length: 100 }, (_, i) => ({
        id: `local-limit-${i}`,
        title: `Research note ${i}`,
        body: 'A valid locally persisted research note for boundary review.',
        excerpt: 'Persisted research note',
        author: 'Local researcher',
        category: 'Research Notes',
        date: '2026-09-12T00:00:00.000Z',
        local: true,
        replies: [],
      }));
      state.comments = Array.from({ length: 300 }, (_, i) => ({
        id: `reply-limit-${i}`,
        post: 'local-limit-0',
        body: `Persisted reply ${i}`,
        author: 'Local researcher',
        at: 'Demo sample',
        local: true,
      }));
      state.draft = { title: '', body: 'A saved body without a title.', category: 'Research Notes' };
      localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(state));
    }, pristine);
    await reloadRecoveryPage();
    await page.goto(`${origin}/#/account/notes`);
    assert.equal(await page.locator('.journal-row').count(), 100);
    assert.match(await page.locator('.draft-note').textContent(), /Untitled/i);
    await page.locator('[data-action="compose"]').first().click();
    await page.locator('#compose-title').fill('A further valid research note');
    await page
      .locator('#compose-body')
      .fill('This valid note must be rejected at the local note count boundary.');
    const beforePost = await page.evaluate(() => window.AF.store.read());
    await page.locator('#compose-form [type="submit"]').click();
    assert.match(await page.locator('#compose-error').textContent(), /100-note local limit/);
    assert.deepEqual(await page.evaluate(() => window.AF.store.read()), beforePost);
    await page.locator('#close-dialog').click();
    await page.goto(`${origin}/#/forum/post/local-limit-0`);
    await page.locator('#comment-form [name="body"]').fill('A valid additional local reply');
    const beforeReply = await page.evaluate(() => window.AF.store.read());
    await page.locator('#comment-form [type="submit"]').click();
    assert.match(await page.locator('#comment-error').textContent(), /local reply limit/);
    assert.deepEqual(await page.evaluate(() => window.AF.store.read()), beforeReply);
    checks.push(
      'Valid persisted 100-note and 300-reply limits reject real forms without partial state changes',
    );

    await page.evaluate(
      (pristine) => localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(pristine)),
      pristine,
    );
    await reloadRecoveryPage();
    for (const [route, search] of [
      ['market', 'market-search'],
      ['forum', 'forum-search'],
      ['home', 'strategy-search'],
    ]) {
      await page.goto(`${origin}/#/${route}`);
      await page.locator('h1').first().focus();
      await page.keyboard.press('/');
      assert.equal(await page.evaluate(() => document.activeElement.id), search);
    }
    await page.goto(`${origin}/`);
    assert.match(await page.title(), /Good strategies/);
    await page.locator('.skip').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
    for (const reducedMotion of ['reduce', 'no-preference']) {
      await page.emulateMedia({ reducedMotion });
      await page.locator('[data-scroll="how-it-works"]').click();
      await page.waitForFunction(
        () => Math.abs(document.querySelector('#how-it-works').getBoundingClientRect().top) < 150,
      );
    }
    await page.locator('#press-button').click();
    await page.goto(`${origin}/#/market`);
    await page.waitForFunction(() => window.AF.store.read().samplePass);
    assert.equal(new URL(page.url()).hash, '#/market');
    await page.goto(`${origin}/#/forum/post/`);
    assert.match(await page.locator('main').textContent(), /not found|no longer|not here/i);
    checks.push(
      'Keyboard search and skip links focus visible controls; detached press completion preserves the current route',
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/#/account/settings`);
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      await page.locator('[data-action="profile"]').first().click();
      const box = await page.locator('#app-dialog').boundingBox();
      // Native dialog padding is part of the dialog, and must not count as backdrop.
      await page.mouse.click(box.x + 2, box.y + 2);
      assert.equal(await page.locator('#app-dialog[open]').count(), 1);
      const x =
        edge === 'left' ? box.x - 4 : edge === 'right' ? box.x + box.width + 4 : box.x + box.width / 2;
      const y =
        edge === 'top' ? box.y - 4 : edge === 'bottom' ? box.y + box.height + 4 : box.y + box.height / 2;
      await page.mouse.click(x, y);
      assert.equal(await page.locator('#app-dialog[open]').count(), 0);
    }
    await page.locator('[data-action="design"]').click();
    assert.match(await page.locator('dialog[open]').textContent(), /scope|prototype/i);
    await page.goto(`${origin}/#/market`);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    const comparisons = page.locator('[data-compare]');
    for (let i = 0; i < 3; i++) await comparisons.nth(i).check();
    await comparisons.nth(3).click();
    assert.equal(await comparisons.nth(3).isChecked(), false);
    assert.match(await page.locator('#toast').textContent(), /Compare up to 3/);
    await comparisons.nth(2).uncheck();
    await page.locator('[data-action="compare-open"]').click();
    await page.locator('[data-close-on-route]').first().click();
    await page.locator('#trade-panel').waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    checks.push(
      'Native backdrop edges, Escape, route changes and bounded comparison controls preserve modal state',
    );

    await page.goto(`${origin}/#/rankings`);
    await page.locator('[data-save="trend"]').click();
    assert.equal(await page.locator('[data-save="trend"]').getAttribute('aria-pressed'), 'true');
    await page.goto(`${origin}/#/account/saved`);
    await page.locator('[data-save="trend"]').click();
    assert.equal(await page.locator('[data-save="trend"]').count(), 0);
    await page.goto(`${origin}/#/trade/trend`);
    await page.locator('[data-pass-side="sell"]').click();
    await page.locator('[data-pass-side="buy"]').click();
    assert.equal(await page.locator('#pass-qty').inputValue(), '10');
    await page.setViewportSize({ width: 390, height: 844 });
    const chart = page.locator('[data-v3-chart="price"]');
    await chart.focus();
    await page.keyboard.press('ArrowRight');
    const box = await chart.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.doesNotMatch(await page.locator('#price-readout').textContent(), /NaN|undefined/);
    checks.push(
      'Ranking bookmarks update the account; market side switches and mobile chart input use current controls',
    );
    await page.evaluate((pristine) => {
      const state = structuredClone(pristine);
      state.allocated.trend = 2500;
      state.idle -= 2500;
      localStorage.setItem('alphaforge.prototype.v3', JSON.stringify(state));
    }, pristine);
    await reloadRecoveryPage();
    await page.locator('[data-trade-pane="pass"]').click();
    await page.locator('[data-trade-pane="funds"]').first().click();
    await page.locator('[data-release="trend"]').click();
    await page.locator('#cash-amount').fill('25.01');
    const beforeRelease = await page.evaluate(() => window.AF.store.read());
    await page.locator('#cash-form [type="submit"]').click();
    assert.match(await page.locator('#cash-error').textContent(), /cannot exceed the current allocation/);
    assert.deepEqual(await page.evaluate(() => window.AF.store.read()), beforeRelease);
    await page.locator('#close-dialog').click();
    await page.goto(`${origin}/#/account/funds`);
    await page.locator('[data-cash="withdraw"]').click();
    await page.locator('#cash-amount').fill('1');
    await page.locator('#cash-form [type="submit"]').click();
    await page.locator('[data-action="commit"]').click();
    await page.locator('#close-dialog').click();
    const queued = await page.evaluate(() => window.AF.store.read());
    assert.equal(queued.pending.length, 1);
    assert.equal(queued.pending[0].amount, 100);
    assert.equal(queued.netFunding, beforeRelease.netFunding);
    await page.locator('[data-withdraw-confirm]').click();
    await page.locator('[data-action="commit"]').click();
    await page.locator('#close-dialog').click();
    const withdrawn = await page.evaluate(() => window.AF.store.read());
    assert.equal(withdrawn.netFunding, beforeRelease.netFunding - 100);
    assert.equal(withdrawn.idle, beforeRelease.idle - 100);
    assert.deepEqual(withdrawn.allocated, beforeRelease.allocated);
    assert.deepEqual(withdrawn.pending, []);
    assert.equal(await page.locator('[data-withdraw-confirm]').count(), 0);
    checks.push(
      'Excess release is rejected atomically; reviewed withdrawal confirmation debits funding exactly once',
    );
    assert.deepEqual(errors, []);
    return checks;
  } finally {
    await page.close();
  }
}

export async function verifyLegacyApiJourneys(parent, { v1Supported = true, unsupportedChecks = [] } = {}) {
  assert.equal(typeof v1Supported, 'boolean');
  assert.ok(Array.isArray(unsupportedChecks));
  const origin = new URL(parent.url()).origin;
  const checks = [];
  for (const mode of ['legacy', 'optional-detail']) {
    if (mode === 'optional-detail' && !v1Supported) {
      unsupportedChecks.push({
        name: 'canonical-optional-detail',
        status: 'NOT_SUPPORTED',
        execution: 'NOT_RUN',
        requiredCapability: 'v1',
        equivalentCoverage: false,
      });
      continue;
    }
    const page = await parent.context().newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      if (mode === 'legacy') {
        await page.route('**/api/v1/**', (route) =>
          route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } }),
        );
        await page.route('**/api/vaults**', async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          for (const vault of Array.isArray(body) ? body : [body]) {
            if (vault.balances)
              for (const key of ['deposits', 'realizedPnl', 'feesAccrued', 'feesPaid'])
                delete vault.balances[key];
          }
          await route.fulfill({ response, json: body });
        });
      } else {
        await page.route('**/api/v1/product-snapshot**', async (route) => {
          const response = await route.fetch();
          const body = await response.json();
          if (body.details)
            for (const detail of body.details) {
              delete detail.capabilities;
              if (detail.accountStrategy?.vaultId === null) detail.accountStrategy = null;
            }
          await route.fulfill({ response, json: body });
        });
      }
      await page.goto(`${origin}/#/market`);
      await page.locator('[data-product-login="bob"]').click();
      await page.waitForFunction(() =>
        /^(READY|EMPTY)$/.test(document.querySelector('[data-product-state]')?.textContent ?? ''),
      );
      await page.locator('[data-product-status-filter]').selectOption('not_started');
      const ids = await page
        .locator('[data-product-catalogue] [data-product-strategy]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.productStrategy));
      // A not-started relationship remains a catalogue entry even with no vault.
      assert.ok(ids.length > 0);
      const id = ids[0];
      await page.locator(`[data-product-catalogue] [data-product-strategy="${id}"]`).click();
      if (mode === 'optional-detail') {
        await page.locator('[data-product-claim]').waitFor();
        assert.match(
          await page.locator('main').textContent(),
          /Execution: Unavailable · association Unavailable/,
        );
        assert.equal(await page.locator('[data-product-claim]').count(), 1);
      } else {
        // Bob's empty account stays empty for the later loss/retry journey. Use
        // Alice's existing vault; the standalone harness starts with no access.
        await page.locator('[data-product-login="alice"]').click();
        await page.waitForFunction(() =>
          /^(READY|EMPTY)$/.test(document.querySelector('[data-product-state]')?.textContent ?? ''),
        );
        if (await page.locator('[data-product-claim]').count()) {
          await page.locator('[data-product-claim]').click();
          await page.locator('[data-product-confirm]').click();
          await page.waitForFunction(
            () => document.querySelector('[data-product-state]')?.textContent === 'READY',
          );
        }
        await page.goto(`${origin}/#/account/funds`);
        assert.match(await page.locator('main').textContent(), /Legacy API capability/);
        const receipt = page.locator('article.sketch-box').filter({ hasText: id }).first();
        for (const label of ['Total deposits', 'Realized simulation P&L', 'Fees accrued', 'Fees paid']) {
          const row = receipt.locator('.receipt-lines > div').filter({
            has: page
              .locator('span')
              .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
          });
          assert.match(await row.textContent(), /Unavailable$/);
        }
        assert.doesNotMatch(await receipt.textContent(), /NaN|undefined/);
      }
      assert.deepEqual(errors, []);
      checks.push(
        `${mode}: valid API compatibility renders unavailable data explicitly and retains not-started catalogue entries`,
      );
    } finally {
      await page.close();
    }
  }
  await parent.locator('[data-product-login="alice"]').click();
  await parent.waitForFunction(() =>
    /^(READY|EMPTY)$/.test(document.querySelector('[data-product-state]')?.textContent ?? ''),
  );
  return checks;
}
