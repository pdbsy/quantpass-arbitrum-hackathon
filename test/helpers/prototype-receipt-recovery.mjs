/* global window, document */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const scope = 'FAULT_INJECTED_DOM_BOUNDARY';
const sourceSha256 = 'b9671bca14a388d08a7e5db492f831c5e02fcb15f8ff57baab8a65e863d4ff35';

async function ledgers(page) {
  return page.evaluate(() => ({
    trial: window.AF.store.read(),
    exchange: window.AF.exchange.read(),
    trialStorage: localStorage.getItem('alphaforge.prototype.v3'),
    exchangeStorage: localStorage.getItem('alphaforge.passmarket.v3'),
  }));
}

async function backend(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/product-snapshot');
    return { status: response.status, body: await response.json() };
  });
}

async function ready(page) {
  await page
    .locator('[data-product-state]')
    .filter({ hasText: /^(READY|EMPTY)$/ })
    .waitFor();
  await page.locator('#pass-order-form').waitFor();
}

async function review(page) {
  await page.locator('#pass-qty').fill('1');
  await page.locator('#pass-order-form button[type="submit"]').click();
  await page.locator('#quote-countdown').waitFor();
  assert.equal(await page.locator('#app-dialog[open] #pass-review-error').count(), 1);
  assert.equal(await page.locator('#app-dialog[open] [data-v3-action="commit-order"]').count(), 1);
  const rows = await page
    .locator('#dialog-body .receipt-lines > div')
    .evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [...node.children].map((child) => child.textContent.trim()))),
    );
  // Hand-checked frozen Trend fixture: 342 gross + 1 impact + 2 fee = 345.
  assert.equal(rows.Quantity, '1 Pass');
  assert.equal(rows['Estimated payment (including fees)'], '3.45 ETH');
  assert.equal(rows['Simulated fee'], '0.02 ETH');
  assert.equal(rows['Maximum payment (slippage limit)'], '3.47 ETH');
  return rows;
}

function assertPurchase(before, after) {
  assert.deepEqual(after.trial, before.trial, 'receipt processing must preserve the trial ledger');
  assert.equal(after.trialStorage, before.trialStorage, 'no trial-storage write');
  const order = after.exchange.orders[0];
  assert.ok(order && typeof order.id === 'string' && order.id.length > 0);
  assert.ok(Number.isFinite(Date.parse(order.at)));
  assert.ok(!before.exchange.executed.includes(order.id), 'the new confirmation has a fresh order ID');
  const { id, at, ...economics } = order;
  assert.deepEqual(economics, {
    strategy: 'trend',
    side: 'buy',
    qty: 1,
    slippage: 50,
    price: 342,
    gross: 342,
    impact: 1,
    impactBps: 1,
    fee: 2,
    total: 345,
    bound: 347,
    pnl: 0,
    scope: 'LOCAL_SIMULATION',
    status: 'recorded',
  });
  assert.deepEqual(
    after.exchange,
    {
      ...before.exchange,
      revision: before.exchange.revision + 1,
      cash: before.exchange.cash - 345,
      fees: before.exchange.fees + 2,
      positions: {
        ...before.exchange.positions,
        trend: {
          qty: before.exchange.positions.trend.qty + 1,
          cost: before.exchange.positions.trend.cost + 345,
        },
      },
      orders: [{ ...economics, id, at }, ...before.exchange.orders],
      executed: [...before.exchange.executed, id],
    },
    'exactly one complete economic transition; all other fields remain unchanged',
  );
  assert.equal(after.exchange.executed.filter((value) => value === id).length, 1);
  assert.equal(after.exchange.orders.filter((value) => value.id === id).length, 1);
  assert.deepEqual(JSON.parse(after.exchangeStorage), after.exchange, 'persistent exchange equals memory');
}

async function receipt(page, state) {
  const dialog = page.locator('#app-dialog[open]');
  await dialog.locator('h2').filter({ hasText: 'Demo purchase recorded.' }).waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'dialog-title');
  assert.equal(await dialog.locator('h2#dialog-title').count(), 1);
  assert.match(await dialog.innerText(), new RegExp(state.exchange.orders[0].id));
  const rows = await dialog
    .locator('.receipt-lines > div')
    .evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [...node.children].map((child) => child.textContent.trim()))),
    );
  assert.equal(rows['Balance deducted (demo)'], '3.45 ETH');
  assert.equal(rows['Tradable position'], `${state.exchange.positions.trend.qty} Pass`);
  assert.equal(rows['Trading balance'], state.exchange.orders.length === 1 ? '9,996.55 ETH' : '9,993.10 ETH');
  assert.equal(
    await dialog.locator('#pass-review-error, [data-v3-action="commit-order"]').count(),
    0,
    'the consumed quote has no retry/commit affordance',
  );
  return rows;
}

async function focusState(page) {
  return page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    id: document.activeElement?.id,
    text: document.activeElement?.textContent?.trim().slice(0, 90),
    insideDialog: document.querySelector('#app-dialog').contains(document.activeElement),
    isCloseControl: document.activeElement === document.querySelector('#close-dialog'),
  }));
}

async function keyboardClose(page) {
  const states = [await focusState(page)];
  for (let index = 0; index < 4 && !states.at(-1).isCloseControl; index += 1) {
    await page.keyboard.press('Tab');
    states.push(await focusState(page));
  }
  assert.equal(states.at(-1).isCloseControl, true, 'native Tab must reach the accessible close control');
  assert.equal(await page.getByRole('button', { name: 'Close dialog', exact: true }).isVisible(), true);
  await page.keyboard.press('Enter');
  await page.locator('#app-dialog').waitFor({ state: 'hidden' });
  return states;
}

async function armFocusFault(page) {
  return page.evaluateHandle(() => {
    const target = document.querySelector('#close-dialog');
    const dialog = document.querySelector('#app-dialog');
    const body = document.querySelector('#dialog-body');
    if (!target || !dialog.open || !body.querySelector('#pass-review-error'))
      throw Error('RECEIPT_REVIEW_NOT_READY');
    const descriptor = Object.getOwnPropertyDescriptor(target, 'focus');
    const original = target.focus;
    const state = { armed: true, hits: 0, markers: [], descriptorOriginallyPresent: !!descriptor };
    function restored() {
      const current = Object.getOwnPropertyDescriptor(target, 'focus');
      return (
        target.focus === original &&
        (descriptor
          ? !!current &&
            ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(
              (key) => current[key] === descriptor[key],
            )
          : current === undefined)
      );
    }
    function restore() {
      state.armed = false;
      if (descriptor) Object.defineProperty(target, 'focus', descriptor);
      else delete target.focus;
      if (!restored()) throw Error('FOCUS_DESCRIPTOR_NOT_RESTORED');
    }
    Object.defineProperty(target, 'focus', {
      configurable: true,
      writable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: function (...args) {
        if (
          state.armed &&
          this === target &&
          document.querySelector('#close-dialog') === target &&
          dialog.open &&
          !body.querySelector('#pass-review-error') &&
          body.querySelector('h2')?.textContent === 'Demo purchase recorded.'
        ) {
          restore(); // Disarm and restore the exact instance member before throwing.
          state.hits += 1;
          state.markers.push('FAULT_INJECTED_FOCUS_THROW');
          throw Error('FAULT_INJECTED_FOCUS_THROW');
        }
        return Reflect.apply(original, this, args);
      },
    });
    return { restore, inspect: () => ({ ...state, exactDescriptorRestored: restored() }) };
  });
}

// This catches post-commit duplication, incorrect receipts, lost keyboard access,
// and persistent-state corruption. It does not establish native 544 reachability.
export async function verifyPrototypeReceiptRecovery(parent) {
  const source = await readFile(new URL('../../apps/web/prototype/AlphaForge_v3_EN.html', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), sourceSha256);
  const origin = new URL(parent.url()).origin;
  assert.ok(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin), 'local mock origin required');
  const browser = parent.context().browser();
  assert.ok(browser, 'an attached browser is required for isolated contexts');
  const parentBefore = {
    storage: await parent.context().storageState(),
    ledgers: await ledgers(parent),
    backend: await backend(parent),
  };
  const observations = [];
  const failures = [];
  try {
    for (const fault of [false, true]) {
      const observation = {
        name: `${scope}: ${fault ? 'one-shot receipt focus fault' : 'normal control'}`,
        scope,
        faultInjected: fault,
        nativeTargetState: 'OPEN_NATIVE_REACHABILITY_UNPROVEN',
        status: 'RUNNING',
        pageErrors: [],
        consoleErrors: [],
        forbiddenRequests: [],
        writes: [],
      };
      observations.push(observation);
      let context, page, injection;
      let authenticated = false;
      const scenarioFailures = [];
      try {
        context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: 'reduce',
        });
        await context.route('**/*', async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          const writes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
          if (writes) observation.writes.push({ method: request.method(), path: url.pathname });
          if (
            url.origin !== origin ||
            (writes && !(request.method() === 'POST' && url.pathname === '/api/demo/session'))
          ) {
            observation.forbiddenRequests.push({ method: request.method(), url: request.url() });
            await route.abort();
          } else await route.continue();
        });
        page = await context.newPage();
        page.setDefaultTimeout(10_000);
        page.on('pageerror', (error) => observation.pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error')
            observation.consoleErrors.push({
              text: message.text(),
              url: message.location().url,
              beforeLogin: !authenticated,
            });
        });
        await page.goto(`${origin}/#/trade/trend`);
        await page.locator('[data-product-login="alice"]').click();
        await ready(page);
        authenticated = true;
        const before = await ledgers(page),
          backendBefore = await backend(page);
        assert.equal(backendBefore.status, 200, 'authenticated backend snapshot required');
        assert.equal(before.exchange.cash, 1000000);
        assert.deepEqual(before.exchange.orders, []);
        assert.deepEqual(before.exchange.executed, []);
        observation.firstReview = await review(page);
        if (fault) injection = await armFocusFault(page);
        await page.locator('[data-v3-action="commit-order"]').click();
        await page.locator('#dialog-body h2').filter({ hasText: 'Demo purchase recorded.' }).waitFor();
        const first = await ledgers(page);
        assertPurchase(before, first);
        observation.firstReceipt = await receipt(page, first);
        observation.initialReceiptFocus = await focusState(page);
        if (injection) {
          observation.injection = await injection.evaluate((value) => value.inspect());
          assert.equal(observation.injection.hits, 1, 'missing fault trigger must fail qualification');
          assert.deepEqual(observation.injection.markers, ['FAULT_INJECTED_FOCUS_THROW']);
          assert.equal(observation.injection.armed, false);
          assert.equal(observation.injection.exactDescriptorRestored, true);
          await injection.evaluate((value) => value.restore());
          await injection.dispose();
          injection = null;
        } else assert.equal(observation.initialReceiptFocus.isCloseControl, true);
        assert.deepEqual(await backend(page), backendBefore, 'no backend economic mutation');
        observation.keyboardRecovery = await keyboardClose(page);
        assert.deepEqual(await ledgers(page), first, 'keyboard close must not resend a consumed quote');
        await page.locator('a[href="#/home"]').first().click();
        await page.locator('#press-button').waitFor();
        await page.locator('nav a[href="#/trade/trend"]').click();
        await ready(page);
        assert.deepEqual(await ledgers(page), first, 'navigation does not resend');
        await page.reload();
        await ready(page);
        assert.deepEqual(await ledgers(page), first, 'reload preserves the exact committed state');
        assert.deepEqual(await backend(page), backendBefore);
        observation.secondReview = await review(page);
        await page.locator('[data-v3-action="commit-order"]').click();
        await page.locator('#dialog-body h2').filter({ hasText: 'Demo purchase recorded.' }).waitFor();
        const second = await ledgers(page);
        assertPurchase(first, second);
        observation.secondReceipt = await receipt(page, second);
        assert.notEqual(second.exchange.orders[0].id, first.exchange.orders[0].id);
        assert.deepEqual(second.exchange.orders.slice(1), first.exchange.orders);
        observation.restoredReceiptFocus = await focusState(page);
        assert.equal(observation.restoredReceiptFocus.isCloseControl, true);
        await keyboardClose(page);
        assert.deepEqual(await ledgers(page), second);
        assert.deepEqual(await backend(page), backendBefore);
        observation.before = before;
        observation.afterFirst = first;
        observation.afterSecond = second;
        observation.backendBefore = backendBefore;
        observation.backendAfter = await backend(page);
        observation.assertionsCompleted = true;
      } catch (error) {
        scenarioFailures.push(error);
      } finally {
        if (injection) {
          try {
            await injection.evaluate((value) => value.restore());
          } catch (error) {
            scenarioFailures.push(error);
          }
          try {
            await injection.dispose();
          } catch (error) {
            scenarioFailures.push(error);
          }
        }
        // Explicit page.close lets the original collector flush each real page.
        for (const ownedPage of context?.pages() ?? []) {
          try {
            await ownedPage.close();
          } catch (error) {
            scenarioFailures.push(error);
          }
        }
        if (context) {
          try {
            await context.close();
          } catch (error) {
            scenarioFailures.push(error);
          }
        }
      }
      try {
        assert.deepEqual(observation.pageErrors, []);
        observation.expectedStartupAuthErrors = observation.consoleErrors.filter(
          (error) =>
            error.beforeLogin &&
            error.url === `${origin}/api/session` &&
            error.text ===
              'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
        );
        assert.deepEqual(
          observation.consoleErrors.filter((error) => !observation.expectedStartupAuthErrors.includes(error)),
          [],
          'only the unauthenticated context startup session probe may report 401',
        );
        assert.deepEqual(observation.forbiddenRequests, []);
        assert.deepEqual(observation.writes, [{ method: 'POST', path: '/api/demo/session' }]);
      } catch (error) {
        scenarioFailures.push(error);
      }
      observation.status = scenarioFailures.length ? 'FAIL' : 'PASS';
      observation.errors = scenarioFailures.map((error) => ({ message: error.message, stack: error.stack }));
      failures.push(...scenarioFailures);
      if (scenarioFailures.length) break;
    }
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      assert.deepEqual(
        await parent.context().storageState(),
        parentBefore.storage,
        'parent storage isolation',
      );
      assert.deepEqual(await ledgers(parent), parentBefore.ledgers, 'parent ledger isolation');
      assert.deepEqual(await backend(parent), parentBefore.backend, 'parent backend isolation');
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    const error = new AggregateError(failures, `${scope}: receipt recovery qualification failed`);
    error.observations = observations;
    throw error;
  }
  assert.equal(observations.length, 2);
  return observations;
}
