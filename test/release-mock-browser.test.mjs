/* global window, document */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserHarness } from '../tools/testing/alphaforge-release-mock/browser.mjs';
import { OWNER_A, OWNER_B } from '../tools/testing/alphaforge-release-mock/session.mjs';

async function browserCase(name, run, options) {
  const h = await createBrowserHarness(options);
  try {
    await h.check(name, () => run(h));
  } finally {
    await h.close();
  }
}

test('built public page logs in, previews all required owner actions and logout removes personal view', async () =>
  browserCase('public-previews', async (h) => {
    await h.goto();
    await h.login();
    const { page } = h;
    for (const kind of [
      'APPROVE_USDC',
      'APPROVE_PASS',
      'DEPOSIT',
      'ALLOCATE',
      'DEALLOCATE',
      'WITHDRAW',
      'AUTHORIZE',
      'STOP',
      'REVOKE',
    ]) {
      const fields =
        kind === 'AUTHORIZE'
          ? {
              executor: h.s.executor,
              expiresAt: '1100',
              liquidationWindow: '60',
              maxOrder: '1.000001',
              maxTotal: '3.000003',
              maxSlippageBps: '40',
            }
          : ['STOP', 'REVOKE'].includes(kind)
            ? {}
            : { amount: '1.000001' };
      await h.preview(kind, fields);
      const preview = JSON.parse(await page.locator('.review pre').innerText());
      assert.equal(preview.kind, kind);
      if (fields.amount) assert.equal(preview.amountUsdc, '1000001');
      await page.getByRole('button', { name: '取消预览', exact: true }).click();
    }
    assert.equal(h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length, 0);
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.getByRole('button', { name: '连接钱包并登录', exact: true }).waitFor();
    assert.equal(
      await page
        .locator('.vault-card')
        .innerText()
        .then((v) => v.includes(OWNER_A)),
      false,
    );
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.blockedRequests, []);
  }));

for (const outcome of ['CANCEL', 'UNKNOWN', 'TIMEOUT', 'HASH'])
  test(`mock wallet ${outcome} has explicit cancellation or persistent no-resend state`, async () =>
    browserCase('wallet-' + outcome, async (h) => {
      await h.goto();
      await h.login();
      await h.page.evaluate((value) => {
        window.__releaseMockWallet.state.outcome = value;
      }, outcome);
      await h.preview('DEPOSIT', { amount: '0.000001' });
      if (outcome === 'HASH')
        await h.page.getByRole('button', { name: '在 owner 钱包中确认', exact: true }).dblclick();
      else await h.page.getByRole('button', { name: '在 owner 钱包中确认', exact: true }).click();
      await h.page.waitForFunction(() => window.__releaseMockWallet.state.sends === 1);
      assert.equal(h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length, 1);
      if (outcome === 'CANCEL') {
        await h.page.getByRole('status').filter({ hasText: '你已取消钱包确认' }).waitFor();
        assert.equal(
          await h.page.evaluate(
            () => Object.keys(localStorage).filter((k) => k.startsWith('alphaforge-testnet-intent:')).length,
          ),
          0,
        );
      } else {
        await h.page.locator('.review h3').filter({ hasText: '待核验交易' }).waitFor();
        if (outcome === 'HASH')
          await h.page.waitForFunction(() => {
            const entry = Object.entries(localStorage).find(([key]) =>
              key.startsWith('alphaforge-testnet-intent:'),
            );
            return entry && JSON.parse(entry[1]).hash !== null;
          });
        else
          await h.page
            .getByRole('status')
            .filter({ hasText: outcome === 'UNKNOWN' ? '提交结果未知' : '操作未完成' })
            .waitFor();
        const before = h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length;
        await h.page.reload();
        await h.login();
        await h.page.locator('.review h3').filter({ hasText: '待核验交易' }).waitFor();
        assert.equal(await h.page.getByRole('button', { name: '预览待签交易', exact: true }).count(), 0);
        assert.equal(h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length, before);
        const pending = await h.page.evaluate(() =>
          JSON.parse(
            Object.entries(localStorage).find(([k]) => k.startsWith('alphaforge-testnet-intent:'))[1],
          ),
        );
        assert.equal(pending.kind, 'DEPOSIT');
        assert.equal(pending.hash === null, outcome !== 'HASH');
      }
      assert.equal(h.s.broadcasts, 0);
      assert.deepEqual(h.errors, []);
    }));

test('all nine owner actions reach the closed mock wallet with exactly the reviewed unsigned envelope', async () => {
  for (const kind of [
    'APPROVE_USDC',
    'APPROVE_PASS',
    'DEPOSIT',
    'ALLOCATE',
    'DEALLOCATE',
    'WITHDRAW',
    'AUTHORIZE',
    'STOP',
    'REVOKE',
  ])
    await browserCase('mock-submit-' + kind, async (h) => {
      await h.goto();
      await h.login();
      const fields =
        kind === 'AUTHORIZE'
          ? {
              executor: h.s.executor,
              expiresAt: '1100',
              liquidationWindow: '60',
              maxOrder: '1.000001',
              maxTotal: '3.000003',
              maxSlippageBps: '40',
            }
          : ['STOP', 'REVOKE'].includes(kind)
            ? {}
            : { amount: '1.000001' };
      await h.preview(kind, fields);
      const preview = JSON.parse(await h.page.locator('.review pre').innerText());
      assert.equal(preview.kind, kind);
      const reviewed = readFileSync(join(h.s.directory, 'api.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .findLast((record) => record.url.endsWith('/prepare')).response.transaction;
      await h.page.getByRole('button', { name: '在 owner 钱包中确认', exact: true }).click();
      await h.page.getByRole('status').filter({ hasText: '交易哈希已记录' }).waitFor();
      const sends = h.s.walletRequests.filter((request) => request.method === 'eth_sendTransaction');
      assert.equal(sends.length, 1, kind);
      assert.equal(reviewed.kind, kind);
      const envelope = Object.fromEntries(
        ['from', 'to', 'data', 'value', 'chainId'].map((key) => [key, reviewed[key]]),
      );
      assert.deepEqual(sends[0].params, [envelope]);
      assert.equal(sends[0].params[0].from, OWNER_A);
      assert.equal(sends[0].params[0].chainId, '0xb626');
      assert.equal(sends[0].params[0].value, '0x0');
      assert.equal(h.s.broadcasts, 0);
      assert.deepEqual(h.errors, []);
    });
});

test('owner and chain change invalidate mounted personal data; reconnect uses current identity only', async () =>
  browserCase('identity-races', async (h) => {
    await h.goto();
    await h.login();
    await h.page.evaluate((owner) => window.__releaseMockWallet.changeOwner(owner), OWNER_B);
    await h.page.getByRole('button', { name: '连接钱包并登录', exact: true }).waitFor();
    assert.equal(await h.page.getByRole('heading', { name: 'mock-owner-a', exact: true }).count(), 0);
    await h.page.getByRole('button', { name: '连接钱包并登录', exact: true }).click();
    await h.page.getByRole('heading', { name: '尚无已配置的 Vault', exact: true }).waitFor();
    await h.page.evaluate(() => window.__releaseMockWallet.changeChain('0x1237'));
    await h.page.getByRole('button', { name: '连接钱包并登录', exact: true }).click();
    await h.page.getByRole('status').filter({ hasText: '请切换到 Robinhood Testnet' }).waitFor();
    await h.page.evaluate(
      ({ owner }) => {
        window.__releaseMockWallet.changeOwner(owner);
        window.__releaseMockWallet.changeChain('0xb626');
      },
      { owner: OWNER_A },
    );
    await h.login();
    assert.deepEqual(h.errors, []);
  }));

async function assertOwnerReauthentication(page) {
  await page.locator('[data-testnet-identity-error][role="alert"]').waitFor();
  assert.equal(await page.locator('main').getAttribute('data-testnet-phase'), 'DISCONNECTED');
  assert.equal(await page.locator('.vault-card .metrics').count(), 0);
  for (const name of ['我的 Vault', 'mock-owner-a', 'mock-owner-b'])
    assert.equal(await page.getByRole('heading', { name, exact: true }).count(), 0);
  assert.equal(await page.locator('.review').count(), 0);
  assert.equal(await page.getByRole('button', { name: '预览待签交易', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '在 owner 钱包中确认', exact: true }).count(), 0);
  await page.getByRole('button', { name: /重新登录|连接钱包并登录/ }).waitFor();
}
async function manuallyRestoreOwnerA(h) {
  await h.page.getByRole('button', { name: /重新登录|连接钱包并登录/ }).click();
  await h.page.locator('.vault-card h2').filter({ hasText: 'mock-owner-a' }).waitFor();
  assert.equal(await h.page.locator('main').getAttribute('data-testnet-phase'), 'READY');
}

test('another tab changes the shared authenticated cookie while the first wallet remains A', async () =>
  browserCase('cross-tab-cookie-owner', async (h) => {
    await h.goto();
    await h.login();
    await h.page.evaluate(() => {
      window.__releaseMockWallet.state.outcome = 'UNKNOWN';
    });
    await h.preview('DEPOSIT', { amount: '0.000001' });
    await h.page.getByRole('button', { name: '在 owner 钱包中确认', exact: true }).click();
    await h.page.getByRole('status').filter({ hasText: '提交结果未知' }).waitFor();
    const pending = await h.page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(([key]) => key.startsWith('alphaforge-testnet-intent:')),
      ),
    );
    const other = await h.context.newPage();
    await other.goto(h.origin);
    await other.evaluate((owner) => {
      window.__releaseMockWallet.state.owner = owner;
    }, OWNER_B);
    await other.getByRole('button', { name: '连接钱包并登录', exact: true }).click();
    await other.getByRole('heading', { name: '尚无已配置的 Vault', exact: true }).waitFor();
    assert.equal(await h.page.evaluate(() => window.__releaseMockWallet.state.owner), OWNER_A);
    const logins = h.s.walletRequests.filter((r) => r.method === 'personal_sign').length;
    await h.page.getByRole('button', { name: '刷新链上状态', exact: true }).click();
    await assertOwnerReauthentication(h.page);
    assert.equal(h.s.walletRequests.filter((r) => r.method === 'personal_sign').length, logins);
    assert.deepEqual(
      await h.page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([key]) => key.startsWith('alphaforge-testnet-intent:')),
        ),
      ),
      pending,
    );
    await manuallyRestoreOwnerA(h);
    await h.page.locator('.review h3').filter({ hasText: '待核验交易' }).waitFor();
    assert.equal(h.s.walletRequests.filter((r) => r.method === 'personal_sign').length, logins + 1);
    assert.equal(h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length, 1);
    assert.deepEqual(
      await h.page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(([key]) => key.startsWith('alphaforge-testnet-intent:')),
        ),
      ),
      pending,
    );
  }));

for (const kind of ['MISSING', 'MALFORMED', 'MISMATCH'])
  test(`successful Vault envelope with ${kind} owner clears claims and requires manual login`, async () =>
    browserCase('vault-envelope-' + kind, async (h) => {
      await h.goto();
      await h.login();
      const logins = h.s.walletRequests.filter((r) => r.method === 'personal_sign').length;
      h.faults.vaultOwner = kind;
      await h.page.getByRole('button', { name: '刷新链上状态', exact: true }).click();
      await assertOwnerReauthentication(h.page);
      assert.equal(h.s.walletRequests.filter((r) => r.method === 'personal_sign').length, logins);
      h.faults.vaultOwner = 'NONE';
      await manuallyRestoreOwnerA(h);
      assert.equal(h.s.walletRequests.filter((r) => r.method === 'personal_sign').length, logins + 1);
      assert.equal(h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length, 0);
    }));

test('delayed A read cannot republish personal data after the wallet and session change to B', async () =>
  browserCase('delayed-owner-read', async (h) => {
    await h.goto();
    await h.login();
    let reached, release;
    const observed = new Promise((resolve) => {
      reached = resolve;
    });
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    h.faults.vaultReadBarrier = { reached, wait };
    try {
      await h.page.getByRole('button', { name: '刷新链上状态', exact: true }).click();
      await observed;
      await h.page.evaluate((owner) => window.__releaseMockWallet.changeOwner(owner), OWNER_B);
      await h.page.getByRole('button', { name: '连接钱包并登录', exact: true }).click();
      await h.page.getByRole('heading', { name: '尚无已配置的 Vault', exact: true }).waitFor();
      const completed = h.page.waitForResponse((response) => response.url().endsWith('/api/testnet/vaults'));
      release();
      // The original A response is actually fulfilled before checking the settled B UI.
      await completed;
      await h.page.evaluate(
        () =>
          new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))),
      );
      await h.page.getByRole('heading', { name: '尚无已配置的 Vault', exact: true }).waitFor();
      assert.equal(await h.page.getByRole('heading', { name: 'mock-owner-a', exact: true }).count(), 0);
      assert.equal(h.s.walletRequests.filter((r) => r.method === 'eth_sendTransaction').length, 0);
    } finally {
      release();
    }
  }));

test('current public API failure is visible and stale healthy action preview fails closed', async () =>
  browserCase('api-failure-gate', async (h) => {
    await h.goto();
    await h.login();
    h.faults.api = 'UNAVAILABLE';
    await h.page.getByRole('button', { name: '刷新链上状态', exact: true }).click();
    await h.page
      .getByRole('status')
      .filter({ hasText: /存储已暂停|服务|读取|不可|未完成/ })
      .waitFor();
    // A stale page must not offer an enabled owner preview after loss of its read service.
    const preview = h.page.getByRole('button', { name: '预览待签交易', exact: true });
    assert.equal((await preview.count()) === 0 || (await preview.isDisabled()), true);
    h.faults.api = 'NONE';
    await h.page.getByRole('button', { name: '刷新链上状态', exact: true }).click();
    assert.deepEqual(h.errors, []);
  }));

test('demo JSON export yields an actual parseable file with isolated mock ledger and bookmarks', async () =>
  browserCase(
    'demo-json-export',
    async (h) => {
      await h.goto('/#/trade/trend');
      await h.page.locator('[data-save="trend"]').first().click();
      await h.goto('/#/account/settings');
      const buttons = h.page.getByRole('button', { name: /Export records/i });
      assert.equal(await buttons.count(), 1);
      const downloaded = h.page.waitForEvent('download');
      await buttons.click();
      const download = await downloaded;
      const file = join(h.directory, 'export.json');
      await download.saveAs(file);
      const data = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(typeof data, 'object');
      assert.equal(data.product, 'AlphaForge');
      assert.equal(data.scope, 'LOCAL_PROTOTYPE_ONLY');
      assert.ok(data.state.favorites.includes('trend'));
      assert.ok(data.passMarket.positions.trend);
      assert.ok(Array.isArray(data.state.history));
      await h.capture('export');
    },
    { demo: true },
  ));

test('six demo strategy routes render their own chart and actual hover evidence', async () =>
  browserCase(
    'demo-six-strategies-hover',
    async (h) => {
      for (const id of ['trend', 'factor', 'mean', 'rotate', 'breakout', 'pairs']) {
        await h.goto('/#/trade/' + id);
        const chart = h.page.locator('[data-v3-chart="price"]');
        assert.equal(await chart.count(), 1, id);
        await chart.scrollIntoViewIfNeeded();
        const point = await chart.evaluate((svg) => {
          const rows = window.AF.marketData.candles(svg.dataset.strategy, window.AF.view.priceRange);
          const g = window.AF.charts.G;
          const p = svg.createSVGPoint();
          p.x = g.L + (10.5 / rows.length) * (g.R - g.L);
          p.y = 150;
          const xy = p.matrixTransform(svg.getScreenCTM());
          return { x: xy.x, y: xy.y, close: rows[10].close };
        });
        await h.page.mouse.move(point.x, point.y);
        await h.page.locator('[data-candle-tooltip]').waitFor();
        const close = await h.page.locator('[data-candle-field="close"]').innerText();
        assert.equal(
          close,
          new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
            point.close / 100,
          ) + ' ETH',
        );
        await h.capture('strategy-' + id);
      }
      assert.deepEqual(h.errors, []);
    },
    { demo: true },
  ));

// W1 matrix 9aa7cdc and immutable prototype router: six canonical tabs;
// trials/activity are documented fallback aliases. Singular trial is a fallback,
// not a seventh canonical section. Assert the effective content, not just a URL.
for (const tab of ['trades', 'passes', 'saved', 'notes', 'funds', 'settings'])
  test(`canonical account ${tab} retains its own content/navigation without legacy diagnosis`, async () =>
    browserCase(
      'account-' + tab,
      async (h) => {
        await h.goto('/#/account/' + tab);
        await h.page.locator('#main h1').waitFor();
        assert.equal(await h.page.evaluate(() => window.location.hash), '#/account/' + tab);
        if (tab === 'trades') assert.equal(await h.page.locator('[data-wallet-account]').count(), 1);
        else {
          assert.equal(await h.page.locator('.account-page').count(), 1);
          assert.equal(await h.page.evaluate(() => window.AF.view.accountTab), tab);
          assert.equal(
            await h.page
              .locator(`[aria-label="Account sections"] a[href="#/account/${tab}"][aria-current="page"]`)
              .count(),
            1,
          );
        }
        assert.equal(await h.page.locator('[aria-label="M3 account chain status"]').count(), 0, tab);
        await h.capture('account-' + tab);
      },
      { demo: true },
    ));

test('account no-tab and generic fallbacks preserve their hashes and render actual Pass content', async () =>
  browserCase(
    'account-fallbacks',
    async (h) => {
      for (const tab of ['', 'trials', 'activity', 'trial', 'release-invalid-tab']) {
        const hash = '#/account' + (tab ? '/' + tab : '');
        await h.goto('/' + hash);
        await h.page.locator('.account-page').waitFor();
        assert.equal(await h.page.evaluate(() => window.location.hash), hash);
        assert.equal(await h.page.evaluate(() => window.AF.view.accountTab), 'passes');
        assert.equal(
          await h.page
            .locator('[aria-label="Account sections"] a[href="#/account/passes"][aria-current="page"]')
            .count(),
          1,
        );
        assert.equal(await h.page.locator('[aria-label="M3 account chain status"]').count(), 0);
        await h.capture('account-fallback-' + tab);
      }
    },
    { demo: true },
  ));

test('mobile menu accessible label follows closed state and routes remain within viewport', async () =>
  browserCase(
    'mobile-navigation',
    async (h) => {
      await h.goto('/#/');
      const toggle = h.page.locator('.menu-toggle');
      await toggle.click();
      await h.page.locator('.nav-center [data-nav="market"]').click();
      await h.page.waitForFunction(
        () => document.querySelector('.menu-toggle')?.getAttribute('aria-expanded') === 'false',
      );
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.match(await toggle.getAttribute('aria-label'), /expand|open/i);
      for (const route of ['/market', '/rankings', '/forum', '/trade/trend', '/account/settings']) {
        await h.goto('/#' + route);
        assert.equal(
          await h.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          true,
          route,
        );
      }
    },
    { demo: true, viewport: { width: 390, height: 844 } },
  ));

test('external JSON uses current browser API contract, creates fills once and UI displays stop settlement', async () =>
  browserCase(
    'external-json',
    async (h) => {
      await h.goto('/automata.html');
      const { page } = h;
      await page.getByLabel('测试账户').selectOption('alice');
      await page.getByRole('button', { name: '建立测试 Vault', exact: true }).click();
      await page.getByLabel('存入 / 取出金额').fill('1000');
      await page.getByRole('button', { name: '存入并冻结 Pass', exact: true }).click();
      await page.getByLabel('运行资金').fill('500');
      await page.getByLabel('策略来源').selectOption('external');
      await page.locator('fieldset select').first().selectOption('off');
      await page.getByRole('button', { name: '启动模拟运行', exact: true }).click();
      await page.locator('.af-run').waitFor();
      await page.getByRole('button', { name: '推进一帧', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('.af-run small')?.textContent?.includes('第 1/120 帧'),
      );
      const result = await page.evaluate(async () => {
        const call = async (path, body) => {
          const r = await fetch(path, {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-quantpass-demo': '1' },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          if (!r.ok) throw new Error('JSON_API_STATUS:' + r.status + ':' + (await r.text()));
          return r.json();
        };
        const list = await call('/api/v1/automata'),
          id = list.items[0].state.id;
        const c = await call('/api/v1/automata/' + id + '/strategy-context');
        const envelope = {
          protocol: 'alphaforge-targets-v1',
          runId: id,
          id: 'release-browser-external-1',
          expectedRevision: c.revision,
          frameSeq: c.frameSeq,
          targets: { 'rwa-a': 5000, 'rwa-b': 5000 },
        };
        const first = await call('/api/v1/automata/' + id + '/decisions', envelope);
        const replay = await call('/api/v1/automata/' + id + '/decisions', envelope);
        return { first, replay };
      });
      assert.equal(result.first.state.trades.filter((t) => t.side === 'buy').length, 2);
      assert.deepEqual(result.replay, result.first);
      await page.reload();
      await page
        .getByText('最近信号：release-browser-external-1', { exact: false })
        .waitFor({ state: 'attached' });
      await page.getByRole('button', { name: '停止并立即清仓', exact: true }).click();
      await page.locator('.af-state').filter({ hasText: '已停止' }).waitFor();
      const final = await page.evaluate(
        async () => (await (await fetch('/api/v1/automata')).json()).items[0],
      );
      assert.equal(final.state.trades.filter((t) => t.side === 'sell').length, 2);
      assert.equal(final.state.positions['rwa-a'].quantity, '0');
      assert.equal(final.state.positions['rwa-b'].quantity, '0');
      assert.ok(BigInt(final.state.cash) > 0n);
      await page.getByRole('button', { name: '将结算现金转为闲置', exact: true }).click();
      await page.getByRole('button', { name: '完整退出并释放全部 Pass', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Vault 已完整退出' }).waitFor();
      const account = await page.evaluate(
        async () => (await (await fetch('/api/v1/vaults')).json()).items[0],
      );
      assert.equal(account.passAccounting.closed, true);
      assert.equal(account.passAccounting.lockedPassRaw, '0');
      assert.equal(account.activeCash, '0');
      assert.deepEqual(h.errors, []);
    },
    { demo: true },
  ));

async function externalUiSetup(h) {
  await h.goto('/automata.html');
  const { page } = h;
  await page.getByLabel('测试账户').selectOption('alice');
  await page.getByRole('button', { name: '建立测试 Vault', exact: true }).click();
  await page.getByLabel('存入 / 取出金额').fill('1000');
  await page.getByRole('button', { name: '存入并冻结 Pass', exact: true }).click();
  await page.getByLabel('运行资金').fill('500');
  await page.getByLabel('策略来源').selectOption('external');
  await page.locator('fieldset select').first().selectOption('off');
  await page.getByRole('button', { name: '启动模拟运行', exact: true }).click();
  await page.locator('.af-run').waitFor();
  await page.getByRole('button', { name: '推进一帧', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.af-run small')?.textContent?.includes('第 1/120 帧'),
  );
  await page.getByText('策略接入与信号状态', { exact: true }).click();
  await page.getByLabel('外部策略目标 JSON', { exact: true }).waitFor();
}
const readDemoRun = async (page) =>
  page.evaluate(async () => (await (await fetch('/api/v1/automata')).json()).items[0]);
const decisionPosts = (h) =>
  readFileSync(join(h.s.directory, 'demo-api.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((record) => record.method === 'POST' && record.path.endsWith('/decisions'));

test('native external textarea preview and double-confirm submit the reviewed owner/run/revision/frame once and complete exit', async () =>
  browserCase(
    'external-json-native-ui',
    async (h) => {
      await externalUiSetup(h);
      const { page } = h;
      const before = await readDemoRun(page);
      assert.equal(
        await page.evaluate(async () => (await (await fetch('/api/session')).json()).user),
        'alice',
      );
      await page.getByLabel('外部策略目标 JSON', { exact: true }).fill('{"rwa-a":5000,"rwa-b":5000}');
      await page.getByRole('button', { name: '预览 JSON 信号', exact: true }).click();
      await page.locator('[data-external-preview]').waitFor();
      const reviewed = JSON.parse(await page.locator('[data-external-preview] pre').innerText());
      assert.equal(reviewed.runId, before.state.id);
      assert.equal(reviewed.expectedRevision, before.revision);
      assert.equal(reviewed.frameSeq, before.state.cursor);
      assert.equal(decisionPosts(h).length, 0);
      await page.getByRole('button', { name: '确认提交 JSON 信号', exact: true }).dblclick();
      await page.waitForFunction(() =>
        document.querySelector('.af-run details')?.textContent?.includes('最近信号：'),
      );
      const posts = decisionPosts(h);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].status, 200);
      assert.deepEqual(posts[0].request, reviewed);
      const filled = await readDemoRun(page);
      assert.equal(filled.state.trades.filter((trade) => trade.side === 'buy').length, 2);
      await page.reload();
      await page.getByRole('button', { name: '停止并立即清仓', exact: true }).click();
      await page.locator('.af-state').filter({ hasText: '已停止' }).waitFor();
      await page.getByRole('button', { name: '将结算现金转为闲置', exact: true }).click();
      await page.getByRole('button', { name: '完整退出并释放全部 Pass', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Vault 已完整退出' }).waitFor();
      const account = await page.evaluate(
        async () => (await (await fetch('/api/v1/vaults')).json()).items[0],
      );
      assert.equal(account.passAccounting.closed, true);
      assert.equal(account.passAccounting.lockedPassRaw, '0');
      assert.deepEqual(h.errors, []);
    },
    { demo: true },
  ));

test('native external JSON refuses malformed targets, changed frame/revision and clears drafts on owner change', async () =>
  browserCase(
    'external-json-native-refusals',
    async (h) => {
      await externalUiSetup(h);
      const { page } = h;
      const input = page.getByLabel('外部策略目标 JSON', { exact: true });
      for (const value of ['{', '{"rwa-a":10001}', '{"outside-asset":1000}']) {
        await input.fill(value);
        const fetched = page.waitForResponse((response) => response.url().endsWith('/strategy-context'));
        await page.getByRole('button', { name: '预览 JSON 信号', exact: true }).click();
        await fetched;
        await page
          .getByRole('status')
          .filter({ hasText: /有效目标 JSON|整数基点/ })
          .waitFor();
        assert.equal(await page.locator('[data-external-preview]').count(), 0);
        assert.equal(decisionPosts(h).length, 0);
      }
      const preview = async () => {
        await input.fill('{"rwa-a":3000}');
        await page.getByRole('button', { name: '预览 JSON 信号', exact: true }).click();
        await page.locator('[data-external-preview]').waitFor();
        return JSON.parse(await page.locator('[data-external-preview] pre').innerText());
      };
      const frameOne = await preview();
      await page.getByRole('button', { name: '推进一帧', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('.af-run small')?.textContent?.includes('第 2/120 帧'),
      );
      await page.getByRole('button', { name: '确认提交 JSON 信号', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '行情帧或账户状态已变化' }).waitFor();
      assert.equal(await page.locator('[data-external-preview]').count(), 0);
      assert.equal(decisionPosts(h).length, 0);
      const frameTwo = await preview();
      assert.notEqual(frameTwo.frameSeq, frameOne.frameSeq);
      await page.getByRole('button', { name: '暂停策略', exact: true }).click();
      await page.locator('.af-state').filter({ hasText: '已暂停' }).waitFor();
      await page.getByRole('button', { name: '确认提交 JSON 信号', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '行情帧或账户状态已变化' }).waitFor();
      assert.equal(decisionPosts(h).length, 0);
      await page.getByRole('button', { name: '继续策略', exact: true }).click();
      await preview();
      await page.getByLabel('测试账户').selectOption('bob');
      await page.waitForFunction(() => !document.querySelector('.af-run'));
      assert.equal(await page.locator('[data-external-preview]').count(), 0);
      await page.getByLabel('测试账户').selectOption('alice');
      await page.locator('.af-run').waitFor();
      await page.getByText('策略接入与信号状态', { exact: true }).click();
      assert.equal(await input.inputValue(), '');
      assert.equal(await page.locator('[data-external-preview]').count(), 0);
      assert.equal(decisionPosts(h).length, 0);
      assert.equal((await readDemoRun(page)).state.trades.length, 0);
      assert.deepEqual(h.errors, []);
    },
    { demo: true },
  ));

test('pinned EMA complete production adapter path is displayed by current research UI', async () =>
  browserCase(
    'ema-complete',
    async (h) => {
      const { StrategyClient } = await import('../tools/automata/strategy-client.mjs');
      const { emaTargets } = await import('../packages/automata/src/ema-strategy.ts');
      const { provisionEma, advanceEma } = await import('../tools/automata/ema-demo-runtime.mjs');
      const fetcher = async (url, options) => {
        const r = await h.demoApp.app.inject({
          method: options.method,
          url: new URL(url).pathname,
          headers: { ...options.headers, host: new URL(h.origin).host },
          ...(options.body ? { payload: options.body } : {}),
        });
        h.requests.push({
          mode: 'MOCK',
          scope: 'EMA_API_ADAPTER',
          method: options.method,
          path: new URL(url).pathname,
          status: r.statusCode,
        });
        return new Response(r.body, { status: r.statusCode, headers: r.headers });
      };
      const client = new StrategyClient({
        baseUrl: h.origin,
        owner: 'alice',
        runId: 'qinfra-ema-demo',
        targets: {},
        selectTargets: emaTargets,
        fetcher,
      });
      await client.connect();
      await provisionEma(client);
      let status = '';
      for (let i = 0; i < 125 && status !== 'finished'; i++) status = await advanceEma(client);
      assert.equal(status, 'finished');
      const result = await (await client.request('/api/v1/automata/qinfra-ema-demo')).json();
      assert.equal(result.state.status, 'stopped');
      assert.equal(result.state.trades.length, 4);
      assert.equal(result.state.positions['rwa-a'].quantity, '0');
      assert.equal(result.state.positions['rwa-b'].quantity, '0');
      await h.goto('/automata.html');
      await h.page.getByLabel('测试账户').selectOption('alice');
      await h.page.getByRole('heading', { name: '开源 EMA 测试策略', exact: true }).waitFor();
      await h.page.locator('.af-state').filter({ hasText: '已停止' }).waitFor();
      await h.capture('ema-ui-completed');
      assert.deepEqual(h.errors, []);
    },
    { demo: true },
  ));
