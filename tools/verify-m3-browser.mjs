/* global window, document */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asAddress, asHexData, sameAddress } from '../packages/chain-adapter/src/types.ts';
import { decodeM3VaultCalldata } from '../packages/chain-adapter/src/vault-abi.ts';
import { verifyM3FixtureNonOwnerTransfer } from '../test/helpers/m3-browser-fixture-boundaries.mjs';
import { verifyM3LateConfirmIsolation } from '../test/helpers/m3-browser-late-confirm.mjs';
import { verifyM3LateReviewCancellation } from '../test/helpers/m3-browser-late-review.mjs';
import { importUserUI } from './import-user-ui.mjs';

const OWNER_A = asAddress('0x1111111111111111111111111111111111111111');
const OWNER_B = asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const NON_OWNER = asAddress('0x9999999999999999999999999999999999999999');
const VAULT_A = asAddress('0x2222222222222222222222222222222222222222');
const VAULT_B = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const AF_USDC = asAddress('0x3333333333333333333333333333333333333333');
const RESCUE_TOKEN = asAddress('0x1212121212121212121212121212121212121212');
const APPROVE_SELECTOR = '0x095ea7b3';
const TRANSFER_SELECTOR = '0xa9059cbb';
const allowedProviderMethods = new Set([
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_call',
  'eth_sendTransaction',
]);

function addressWord(data, offset) {
  return asAddress(`0x${data.slice(offset + 24, offset + 64)}`);
}

function uintWord(data, offset) {
  return BigInt(`0x${data.slice(offset, offset + 64)}`);
}

export function analyzeM3WalletRequests(requests, options) {
  const vaults = options.vaults.map(asAddress);
  const pass = asAddress(options.pass);
  const afUsdc = asAddress(options.afUsdc);
  const sends = [];
  for (const request of requests) {
    if (request.method !== 'eth_sendTransaction') continue;
    const transaction = request.params?.[0];
    if (
      !transaction ||
      typeof transaction !== 'object' ||
      Array.isArray(transaction) ||
      !('to' in transaction) ||
      !('from' in transaction) ||
      !('data' in transaction) ||
      !('value' in transaction)
    )
      throw new Error('M3_BROWSER_INVALID_WALLET_SEND');
    let target;
    let data;
    try {
      target = asAddress(String(transaction.to));
      asAddress(String(transaction.from));
      data = asHexData(String(transaction.data));
      if (transaction.value !== '0x0') throw new Error('INVALID_VALUE');
    } catch {
      throw new Error('M3_BROWSER_INVALID_WALLET_SEND');
    }
    const vault = vaults.find((entry) => sameAddress(entry, target));
    if (!vault && !sameAddress(target, pass) && !sameAddress(target, afUsdc))
      throw new Error('M3_BROWSER_UNEXPECTED_WALLET_TARGET');

    if (data.slice(0, 10).toLowerCase() === APPROVE_SELECTOR) {
      if (data.length !== 138 || (!sameAddress(target, pass) && !sameAddress(target, afUsdc)))
        throw new Error('M3_BROWSER_INVALID_APPROVAL');
      const spender = addressWord(data.slice(2), 8);
      if (!vaults.some((entry) => sameAddress(entry, spender)))
        throw new Error('M3_BROWSER_UNEXPECTED_APPROVAL_SPENDER');
      sends.push({
        kind: sameAddress(target, pass) ? 'APPROVE_PASS' : 'APPROVE_AF_USDC',
        target,
        spender,
        amount: uintWord(data.slice(2), 72),
      });
      continue;
    }
    if (data.slice(0, 10).toLowerCase() === TRANSFER_SELECTOR) {
      if (data.length !== 138 || !sameAddress(target, pass))
        throw new Error('M3_BROWSER_INVALID_PASS_TRANSFER');
      sends.push({
        kind: 'TRANSFER_PASS',
        target,
        recipient: addressWord(data.slice(2), 8),
        amount: uintWord(data.slice(2), 72),
      });
      continue;
    }
    if (!vault) throw new Error('M3_BROWSER_UNEXPECTED_TOKEN_CALL');
    const decoded = decodeM3VaultCalldata(data);
    if (!decoded) throw new Error('M3_BROWSER_INVALID_VAULT_CALL');
    if (decoded.kind === 'DEPOSIT' || decoded.kind === 'WITHDRAW')
      sends.push({ kind: decoded.kind, target: vault, amount: decoded.usdcAmount });
    else if (decoded.kind === 'RESCUE_UNTRACKED_TOKEN')
      sends.push({ kind: decoded.kind, target: vault, token: decoded.token });
    else sends.push({ kind: decoded.kind, target: vault });
  }
  return sends;
}

function matchingSend(actual, expected) {
  return Object.entries(expected).every(([key, value]) => {
    const observed = actual[key];
    if (typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value))
      return typeof observed === 'string' && sameAddress(asAddress(observed), asAddress(value));
    return observed === value;
  });
}

function errorRecord(error, seen = new Set()) {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  if (seen.has(error)) return { name: error.name, message: '[Circular error cause]' };
  seen.add(error);
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...('cause' in error ? { cause: errorRecord(error.cause, seen) } : {}),
    ...(error.m3BrowserFailure ? { m3BrowserFailure: error.m3BrowserFailure } : {}),
  };
}

async function rejectM3Run(evidenceDirectory, scope, primary, cleanupErrors) {
  const diagnostic = {
    state: 'FAIL',
    scope,
    primaryError: primary ? errorRecord(primary.error) : null,
    cleanupErrors: cleanupErrors.map(({ step, error }) => ({ step, error: errorRecord(error) })),
  };
  const original = primary ? primary.error : cleanupErrors[0].error;
  const failure = original instanceof Error ? original : new Error(String(original), { cause: original });
  failure.m3BrowserFailure = diagnostic;
  try {
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      resolve(evidenceDirectory, scope === 'CLI' ? 'cli-failure.json' : 'failure.json'),
      `${JSON.stringify(diagnostic, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch (error) {
    diagnostic.cleanupErrors.push({ step: 'failure.write', error: errorRecord(error) });
    // Keep the primary failure even when diagnostic storage itself is unavailable.
    process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  }
  throw failure;
}

async function publishM3Result(evidenceDirectory, report) {
  await writeFile(resolve(evidenceDirectory, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
}

async function runBrowserJourneys() {
  const toolPath =
    process.env.AF_PLAYWRIGHT_PATH || '.checks/browser-tools/node_modules/playwright-core/index.mjs';
  const { chromium } = await import(pathToFileURL(resolve(toolPath)).href);
  const { createServer } = await import('vite');
  await importUserUI(
    await readFile('apps/web/prototype/AlphaForge_v3_EN.html', 'utf8'),
    'apps/web',
    'build/ui-import',
  );

  const evidenceRoot = resolve(process.env.AF_M3_BROWSER_EVIDENCE_ROOT || '.checks/M3-04-PHASE1-PRODUCT');
  await mkdir(evidenceRoot, { recursive: true });
  const evidenceDirectory = await mkdtemp(`${evidenceRoot}/browser-`);
  const port = Number(process.env.AF_M3_BROWSER_PORT || '4197');
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('INVALID_AF_M3_BROWSER_PORT');
  const origin = `http://127.0.0.1:${port}`;
  const server = await createServer({
    root: resolve('apps/web'),
    configFile: resolve('apps/web/vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  let browser;
  let report;
  let primary;
  const cleanupErrors = [];
  try {
    await server.listen();
    browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    report = await runM3BrowserJourneys(page, { origin, evidenceDirectory, publishResult: false });
  } catch (error) {
    primary = { error };
  } finally {
    for (const [step, close] of [
      ['browser.close', () => browser?.close()],
      ['server.close', () => server.close()],
    ]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push({ step, error });
      }
    }
  }
  if (primary || cleanupErrors.length) await rejectM3Run(evidenceDirectory, 'CLI', primary, cleanupErrors);
  await publishM3Result(evidenceDirectory, report);
  process.stdout.write(`${JSON.stringify({ ...report, evidenceDirectory }, null, 2)}\n`);
}

// The collector owns its server, fresh browser context and counter collection.
// This function leaves the page open so it can collect the same workflow's counters.
export async function runM3BrowserJourneys(page, { origin, evidenceDirectory, publishResult = true }) {
  const base = new URL(origin);
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    base.username ||
    base.password ||
    base.origin !== origin
  )
    throw new Error('M3_BROWSER_REQUIRES_LOOPBACK_ORIGIN');
  let report;
  let primary;
  const cleanupErrors = [];
  const checks = [];
  const pageErrors = [];
  const cspErrors = [];
  const blockedRequests = [];
  const onPageError = (error) => pageErrors.push(error.message);
  const onConsole = (message) => {
    if (/Content Security Policy|Refused to (?:apply|execute)/i.test(message.text()))
      cspErrors.push(message.text());
  };
  const routeLocal = async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) await route.continue();
    else {
      blockedRequests.push(url.origin);
      await route.abort('blockedbyclient');
    }
  };
  await page.route('**/*', routeLocal);
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  try {
    await page.goto(`${origin}/?m3Fixture=1#/trade/trend`);
    const controls = page.locator('[data-m3-fixture-controls]');
    await controls.waitFor();
    await page.locator('[aria-label="M3 product chain status"]').waitFor();

    async function evidence() {
      const serialized = await controls.getAttribute('data-m3-fixture-evidence');
      if (!serialized) throw new Error('M3_BROWSER_EVIDENCE_UNAVAILABLE');
      return JSON.parse(serialized);
    }
    async function waitEvidence(label, verify, timeout = 8_000) {
      const deadline = Date.now() + timeout;
      let lastError;
      while (Date.now() < deadline) {
        const current = await evidence();
        try {
          verify(current);
          return current;
        } catch (error) {
          lastError = error;
          await page.waitForTimeout(25);
        }
      }
      throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : 'timed out'}`);
    }
    async function fixtureAction(name) {
      await page.locator(`[data-m3-fixture="${name}"]`).click();
    }
    async function refreshChain() {
      await page.locator('[data-chain-refresh]').click();
    }
    async function sendCount() {
      return (await evidence()).providerRequests.filter((request) => request.method === 'eth_sendTransaction')
        .length;
    }
    async function waitForSend(previous, label) {
      return waitEvidence(label, (current) => {
        assert.equal(
          current.providerRequests.filter((request) => request.method === 'eth_sendTransaction').length,
          previous + 1,
        );
        assert.equal(current.snapshot.transaction.status, 'SUBMITTED');
      });
    }
    async function openAction(action, input = {}) {
      const control = page.locator(`[data-chain-action="${action}"]`);
      assert.equal(await control.isEnabled(), true, `${action} must be enabled`);
      await control.click();
      if (input.amount !== undefined)
        await page.locator('dialog[open] [name="chainAmount"]').fill(input.amount);
      if (input.token !== undefined) await page.locator('dialog[open] [name="chainToken"]').fill(input.token);
      await page.locator('dialog[open] [data-chain-review]').click();
    }
    async function confirmAction(action, input = {}) {
      const previous = await sendCount();
      await openAction(action, input);
      const confirm = page.locator('dialog[open] [data-chain-confirm]');
      await confirm.waitFor();
      await confirm.click();
      return waitForSend(previous, `${action} wallet send`);
    }
    async function approveDeposit(kind, amount) {
      const previous = await sendCount();
      await openAction('deposit', { amount });
      const approve = page.locator(`dialog[open] [data-chain-approve="${kind}"]`);
      await approve.waitFor();
      await approve.click();
      return waitForSend(previous, `${kind} approval send`);
    }

    let current = await evidence();
    assert.equal(current.snapshot.vaultSelection.selected.vaultAddress, VAULT_A);
    assert.equal(current.snapshot.network.status, 'UNAVAILABLE');
    const untouched = current.snapshot.vaultSelection.selected;
    await controls.locator('strong').click();
    current = await evidence();
    assert.deepEqual(current.snapshot.vaultSelection.selected, untouched);
    assert.equal(
      current.providerRequests.filter((request) => request.method === 'eth_sendTransaction').length,
      0,
    );
    await fixtureAction('vault-b');
    await waitEvidence('fixture Vault B button', (value) => {
      assert.equal(value.snapshot.vaultSelection.selected.vaultAddress, VAULT_B);
    });
    await fixtureAction('vault-a');
    await waitEvidence('fixture Vault A button', (value) => {
      assert.equal(value.snapshot.vaultSelection.selected.vaultAddress, VAULT_A);
      assert.equal(
        value.providerRequests.filter((request) => request.method === 'eth_sendTransaction').length,
        0,
      );
    });
    checks.push('DEV fixture label click is inert and Vault A/B buttons select only reviewed records');
    await fixtureAction('network');
    await page.locator('[data-chain-connect]').click();
    current = await waitEvidence('connect owner A', (value) => {
      assert.equal(value.snapshot.wallet.status, 'CONNECTED');
      assert.equal(value.snapshot.wallet.address, OWNER_A);
      assert.equal(value.snapshot.network.status, 'CORRECT');
      assert.equal(value.snapshot.onchain.owner, 'OWNER');
      assert.equal(value.snapshot.onchain.writeMode, 'INJECTED_MOCK');
    });
    checks.push('Connected owner A to the exact local chain through the real product controls');

    let previous = await sendCount();
    await page.locator('[data-pass-transfer]').click();
    await page.locator('dialog[open] [name="passRecipient"]').fill(NON_OWNER);
    await page.locator('dialog[open] [name="passAmount"]').fill('0.000000000000000001');
    await page.locator('dialog[open] [data-pass-review]').click();
    await page.locator('dialog[open] [data-pass-confirm]').waitFor();
    await page.locator('dialog[open] [data-pass-confirm]').click();
    await waitForSend(previous, 'one raw Pass transfer');
    await refreshChain();
    await waitEvidence('Pass balance refresh', (value) => {
      assert.equal(value.snapshot.onchain.passBalanceBaseUnits, '1999999999999999999');
    });
    checks.push('Transferred exactly one raw Pass unit and observed the refreshed provider balance');

    await page.locator('[data-chain-vault-select]').selectOption(`46630:${VAULT_B}`);
    await waitEvidence('Vault B selected under owner A', (value) => {
      assert.equal(value.snapshot.vaultSelection.selected.vaultAddress, VAULT_B);
      assert.equal(value.snapshot.onchain.owner, 'UNKNOWN');
    });
    await fixtureAction('owner-b');
    await page.locator('[data-chain-connect]').click();
    await waitEvidence('Vault B owner connected', (value) => {
      assert.equal(value.snapshot.wallet.address, OWNER_B);
      assert.equal(value.snapshot.onchain.owner, 'OWNER');
      assert.equal(value.snapshot.onchain.depositAuthorization.spender, VAULT_B);
      assert.equal(value.snapshot.onchain.passBalanceBaseUnits, '1000000000000000000');
    });
    await page.locator('[data-chain-vault-select]').selectOption(`46630:${VAULT_A}`);
    await waitEvidence('Vault A selected under owner B', (value) => {
      assert.equal(value.snapshot.vaultSelection.selected.vaultAddress, VAULT_A);
      assert.equal(value.snapshot.onchain.owner, 'UNKNOWN');
    });
    await fixtureAction('owner');
    await page.locator('[data-chain-connect]').click();
    await waitEvidence('Vault A isolation restored', (value) => {
      assert.equal(value.snapshot.wallet.address, OWNER_A);
      assert.equal(value.snapshot.onchain.owner, 'OWNER');
      assert.equal(value.snapshot.onchain.depositAuthorization.spender, VAULT_A);
      assert.equal(value.snapshot.onchain.passBalanceBaseUnits, '1999999999999999999');
    });
    checks.push('Vault A/B selection preserved owner, spender, allowance and Pass-balance isolation');

    await fixtureAction('non-owner');
    await waitEvidence('wallet account change', (value) => {
      assert.equal(value.snapshot.wallet.status, 'ACCOUNT_CHANGED');
      assert.equal(value.snapshot.wallet.address, NON_OWNER);
      assert.equal(value.snapshot.onchain.owner, 'UNKNOWN');
    });
    await page.locator('[data-chain-connect]').click();
    await waitEvidence('non-owner connected', (value) => {
      assert.equal(value.snapshot.wallet.status, 'CONNECTED');
      assert.equal(value.snapshot.onchain.owner, 'NON_OWNER');
      assert.equal(value.snapshot.onchain.writeMode, 'DISABLED');
    });
    await fixtureAction('owner');
    await page.locator('[data-chain-connect]').click();
    await waitEvidence('owner restored after account change', (value) => {
      assert.equal(value.snapshot.wallet.address, OWNER_A);
      assert.equal(value.snapshot.onchain.owner, 'OWNER');
    });

    await fixtureAction('disconnected');
    await waitEvidence('wallet disconnect', (value) => {
      assert.equal(value.snapshot.wallet.status, 'DISCONNECTED');
    });
    await fixtureAction('owner');
    await page.locator('[data-chain-connect]').click();
    await waitEvidence('wallet reconnect', (value) => {
      assert.equal(value.snapshot.wallet.status, 'CONNECTED');
      assert.equal(value.snapshot.wallet.address, OWNER_A);
    });
    await fixtureAction('wrong-network');
    await waitEvidence('wrong chain', (value) => {
      assert.equal(value.snapshot.network.status, 'WRONG');
    });
    assert.equal(await page.locator('[data-chain-action="withdraw"]').isEnabled(), false);
    await fixtureAction('network');
    await refreshChain();
    await waitEvidence('correct chain refresh', (value) => {
      assert.equal(value.snapshot.network.status, 'CORRECT');
      assert.equal(value.snapshot.onchain.owner, 'OWNER');
    });
    checks.push(
      'Account change, non-owner disablement, disconnect, reconnect, wrong-chain disablement and explicit refresh recovery',
    );

    await approveDeposit('af-usdc', '1.000001');
    await approveDeposit('pass', '1.000001');
    await refreshChain();
    await waitEvidence('exact allowances refreshed', (value) => {
      assert.equal(value.snapshot.onchain.depositAuthorization.afUsdcAllowanceBaseUnits, '1000001');
      assert.equal(value.snapshot.onchain.depositAuthorization.passAllowanceBaseUnits, '1000001000000000000');
    });
    for (const [vault, ownerControl, owner, usdcAllowance, passAllowance] of [
      [VAULT_B, 'owner-b', OWNER_B, '0', '0'],
      [VAULT_A, 'owner', OWNER_A, '1000001', '1000001000000000000'],
    ]) {
      await page.locator('[data-chain-vault-select]').selectOption(`46630:${vault}`);
      await fixtureAction(ownerControl);
      await page.locator('[data-chain-connect]').click();
      await waitEvidence('per-Vault allowance isolation after approval', (value) => {
        assert.equal(value.snapshot.vaultSelection.selected.vaultAddress, vault);
        assert.equal(value.snapshot.wallet.address, owner);
        assert.equal(value.snapshot.onchain.owner, 'OWNER');
        assert.equal(value.snapshot.onchain.depositAuthorization.spender, vault);
        assert.equal(value.snapshot.onchain.depositAuthorization.afUsdcAllowanceBaseUnits, usdcAllowance);
        assert.equal(value.snapshot.onchain.depositAuthorization.passAllowanceBaseUnits, passAllowance);
      });
    }
    await confirmAction('deposit', { amount: '1.000001' });
    await confirmAction('withdraw', { amount: '0.000001' });
    checks.push('Exact finite two-token approvals, deposit and withdraw reached wallet submission');

    previous = await sendCount();
    await openAction('withdraw', { amount: '0.000001' });
    await page.locator('dialog[open] [data-chain-confirm]').click();
    await page.waitForFunction(() =>
      document
        .querySelector('dialog[open] [data-product-dialog-error]')
        ?.textContent?.startsWith('M3_SUBMISSION_RECOVERY_REQUIRED.'),
    );
    assert.equal(await sendCount(), previous, 'unresolved identical withdrawal must not be resent');
    await page.locator('dialog[open] [data-close]').click();
    await fixtureAction('soft-ready');
    await waitEvidence('first withdrawal confirmed before a new explicit withdrawal', (value) => {
      assert.equal(value.snapshot.transaction.status, 'READY');
      assert.equal(value.snapshot.onchain.readiness, 'SOFT_READY');
    });
    checks.push(
      'Blocked identical unresolved withdrawal; canonical mock evidence completed the first operation',
    );

    await fixtureAction('degraded');
    await waitEvidence('degraded owner exit', (value) => {
      assert.equal(value.snapshot.onchain.health, 'DEGRADED');
      assert.equal(value.snapshot.onchain.owner, 'OWNER');
      assert.ok(['LIVE_RPC', 'SIMULATION'].includes(value.snapshot.onchain.exitPath));
    });
    assert.equal(await page.locator('[data-chain-action="withdraw"]').isEnabled(), true);
    await refreshChain();
    await waitEvidence('degraded refresh remains explicit', (value) => {
      assert.equal(value.snapshot.onchain.health, 'DEGRADED');
    });
    await confirmAction('withdraw', { amount: '0.000001' });
    await waitEvidence('degraded owner withdrawal submitted', (value) => {
      assert.equal(value.snapshot.onchain.health, 'DEGRADED');
      assert.equal(value.snapshot.transaction.status, 'SUBMITTED');
    });
    await fixtureAction('reorg');
    await waitEvidence('reorg state', (value) => {
      assert.equal(value.snapshot.transaction.status, 'FAILED');
      assert.equal(value.snapshot.transaction.errorCode, 'REORGED');
      assert.equal(value.snapshot.onchain.readiness, 'REORGED');
    });
    await fixtureAction('soft-ready');
    await waitEvidence('soft-ready recovery', (value) => {
      assert.equal(value.snapshot.onchain.health, 'LIVE');
      assert.equal(value.snapshot.onchain.readiness, 'SOFT_READY');
    });
    checks.push('Indexer degradation preserved owner withdrawal submission, reorg and refresh recovery');

    await confirmAction('close');
    await fixtureAction('closed');
    await waitEvidence('closed Vault state', (value) => {
      assert.equal(value.snapshot.onchain.vaultClosed, true);
    });
    assert.equal(await page.locator('[data-chain-action="deposit"]').isEnabled(), false);
    assert.equal(await page.locator('[data-chain-action="withdraw"]').isEnabled(), false);
    assert.equal(await page.locator('[data-chain-action="rescue-token"]').isEnabled(), true);
    await confirmAction('rescue-token', { token: RESCUE_TOKEN });
    await confirmAction('rescue-native');
    checks.push('Close disabled ordinary actions and preserved both owner-only post-close rescue paths');

    await page.locator('[data-price-range="7d"]').click();
    assert.equal(await page.locator('[data-price-range="7d"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-price-style="line"]').click();
    assert.equal(await page.locator('[data-price-style="line"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-return-range="7d"]').click();
    assert.equal(await page.locator('[data-return-range="7d"]').getAttribute('aria-pressed'), 'true');
    const bookmark = page.locator('[data-save="trend"]').first();
    await bookmark.click();
    assert.equal(await bookmark.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.AF.store.read().favorites.includes('trend')), true);
    const chainPassBeforePrototypeTrade = (await evidence()).snapshot.onchain.passBalanceBaseUnits;
    const exchangeBefore = await page.evaluate(() => window.AF.exchange.read());
    await page.locator('#pass-qty').fill('10');
    await page.locator('#pass-order-form button[type="submit"]').click();
    await page.locator('dialog[open] [data-v3-action="commit-order"]').click();
    const exchange = await page.evaluate(() => window.AF.exchange.read());
    assert.equal(exchange.positions.trend.qty, (exchangeBefore.positions.trend?.qty ?? 0) + 10);
    assert.ok(exchange.cash < exchangeBefore.cash);
    assert.equal((await evidence()).snapshot.onchain.passBalanceBaseUnits, chainPassBeforePrototypeTrade);
    await page.locator('dialog[open] [data-close]').click();
    checks.push(
      'Existing prototype chart controls, bookmark state and separate demo Pass trade changed only their local ledgers',
    );
    checks.push(...(await verifyM3LateReviewCancellation(page, origin)));
    checks.push(...(await verifyM3LateConfirmIsolation(page, origin)));
    checks.push(await verifyM3FixtureNonOwnerTransfer(page, origin));

    current = await evidence();
    for (const request of current.providerRequests) {
      if (!allowedProviderMethods.has(request.method))
        throw new Error(`M3_BROWSER_UNSUPPORTED_PROVIDER_METHOD:${request.method}`);
      if (request.method === 'eth_sendTransaction') assert.equal(request.params[0].from, OWNER_A);
    }
    const walletSends = analyzeM3WalletRequests(current.providerRequests, {
      vaults: [VAULT_A, VAULT_B],
      pass: PASS,
      afUsdc: AF_USDC,
    });
    const expectedSends = [
      { kind: 'TRANSFER_PASS', target: PASS, recipient: NON_OWNER, amount: 1n },
      { kind: 'APPROVE_AF_USDC', target: AF_USDC, spender: VAULT_A, amount: 1_000_001n },
      {
        kind: 'APPROVE_PASS',
        target: PASS,
        spender: VAULT_A,
        amount: 1_000_001_000_000_000_000n,
      },
      { kind: 'DEPOSIT', target: VAULT_A, amount: 1_000_001n },
      { kind: 'WITHDRAW', target: VAULT_A, amount: 1n },
      { kind: 'WITHDRAW', target: VAULT_A, amount: 1n },
      { kind: 'CLOSE', target: VAULT_A },
      { kind: 'RESCUE_UNTRACKED_TOKEN', target: VAULT_A, token: RESCUE_TOKEN },
      { kind: 'RESCUE_NATIVE', target: VAULT_A },
    ];
    assert.equal(walletSends.length, expectedSends.length);
    for (let index = 0; index < expectedSends.length; index += 1)
      assert.equal(matchingSend(walletSends[index], expectedSends[index]), true);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(cspErrors, []);
    assert.deepEqual(blockedRequests, []);
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, 'm3-browser-journey.png'), fullPage: true });
    report = {
      state: 'PASS',
      origin,
      checks,
      walletSends: walletSends.map((send) =>
        Object.fromEntries(
          Object.entries(send).map(([key, value]) => [
            key,
            typeof value === 'bigint' ? value.toString() : value,
          ]),
        ),
      ),
      finalSnapshot: current.snapshot,
      pageErrors,
      cspErrors,
      blockedRequests,
    };
  } catch (error) {
    primary = { error };
  } finally {
    for (const [step, cleanup] of [
      ['page.off.pageerror', () => page.off('pageerror', onPageError)],
      ['page.off.console', () => page.off('console', onConsole)],
      ['page.unroute', () => page.unroute('**/*', routeLocal)],
    ]) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push({ step, error });
      }
    }
  }
  if (primary || cleanupErrors.length)
    await rejectM3Run(evidenceDirectory, 'JOURNEY', primary, cleanupErrors);
  if (publishResult) await publishM3Result(evidenceDirectory, report);
  return report;
}

function help() {
  return `Usage: node tools/verify-m3-browser.mjs\n\nEnvironment:\n  AF_PLAYWRIGHT_PATH        Exact isolated playwright-core entry\n  CHROMIUM_PATH              Local Chrome/Chromium executable\n  AF_M3_BROWSER_PORT         Loopback port (default 4197)\n  AF_M3_BROWSER_EVIDENCE_ROOT Ignored evidence root\n`;
}

if (process.argv.includes('--help')) process.stdout.write(help());
else if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runBrowserJourneys();
