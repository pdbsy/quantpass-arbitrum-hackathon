/* global window, document */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyInstallation, sha256 } from '../../coverage/toolchain.mjs';
import { buildApp } from '../../../apps/server/src/app.ts';
import { createReleaseSession, OWNER_A, OWNER_B, mockSignature } from './session.mjs';

export async function createBrowserHarness({ demo = false, viewport = { width: 1440, height: 1000 } } = {}) {
  const descriptor = JSON.parse(readFileSync('planning/coverage-toolchain.lock.json'));
  const toolRoot = resolve(process.env.AF_RELEASE_BROWSER_TOOL || '.checks/release-browser-tools/package');
  const toolQualification = verifyInstallation(toolRoot, descriptor.browser.installedFiles);
  const { chromium } = await import(pathToFileURL(join(toolRoot, 'index.mjs')).href);
  const s = await createReleaseSession({ webRoot: resolve('apps/web/dist') });
  const directory = join(s.directory, 'browser');
  mkdirSync(directory);
  const origin = demo ? 'http://127.0.0.1:4198' : s.origin;
  let demoApp,
    browser,
    context,
    page,
    closed = false;
  const faults = { api: 'NONE', vaultOwner: 'NONE', vaultReadBarrier: null },
    blockedRequests = [],
    errors = [],
    requests = [];
  try {
    if (demo)
      demoApp = await buildApp({
        dbPath: join(s.directory, 'demo.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin,
        webRoot: resolve('apps/web/dist'),
        automataReplay: false,
      });
    browser = await chromium.launch({
      executablePath:
        process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    context = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'block' });
    await context.exposeBinding('__releaseMockSignature', (_source, message, owner) =>
      mockSignature(message, owner),
    );
    await context.exposeBinding('__releaseMockWalletRequest', (_source, request) => {
      s.walletRequests.push(request);
      return null;
    });
    await context.addInitScript(
      ({ owner, now }) => {
        Date.now = () => now;
        const listeners = new Map(),
          state = { owner, chain: '0xb626', outcome: 'HASH', sends: 0 };
        window.__releaseMockWallet = {
          state,
          changeOwner(value) {
            state.owner = value;
            for (const listener of listeners.get('accountsChanged') ?? []) listener();
          },
          changeChain(value) {
            state.chain = value;
            for (const listener of listeners.get('chainChanged') ?? []) listener();
          },
        };
        window.ethereum = {
          on(event, listener) {
            const items = listeners.get(event) ?? [];
            items.push(listener);
            listeners.set(event, items);
          },
          removeListener(event, listener) {
            listeners.set(
              event,
              (listeners.get(event) ?? []).filter((x) => x !== listener),
            );
          },
          async request(input) {
            await window.__releaseMockWalletRequest(input);
            if (['eth_accounts', 'eth_requestAccounts'].includes(input.method))
              return state.owner ? [state.owner] : [];
            if (input.method === 'eth_chainId') return state.chain;
            if (input.method === 'personal_sign') {
              const bytes = input.params[0]
                .slice(2)
                .match(/../g)
                .map((v) => parseInt(v, 16));
              return window.__releaseMockSignature(
                new TextDecoder().decode(new Uint8Array(bytes)),
                state.owner,
              );
            }
            if (input.method === 'eth_sendTransaction') {
              state.sends++;
              if (state.outcome === 'CANCEL')
                throw Object.assign(new Error('MOCK_USER_CANCELLED'), { code: 4001 });
              if (state.outcome === 'UNKNOWN') return 'MOCK_NO_HASH';
              if (state.outcome === 'TIMEOUT') throw new Error('MOCK_WALLET_TIMEOUT');
              return '0x' + String(state.sends).padStart(64, '0');
            }
            throw new Error('MOCK_PROVIDER_METHOD_REJECTED:' + input.method);
          },
        };
        document.addEventListener('DOMContentLoaded', () => {
          const banner = document.createElement('p');
          banner.dataset.releaseMock = '1';
          banner.setAttribute('role', 'note');
          banner.textContent = 'MOCK · isolated local fixture · no real signer, RPC broadcast or shared D1';
          document.body.prepend(banner);
        });
      },
      { owner: OWNER_A, now: s.now },
    );
    await context.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        blockedRequests.push({ urlOrigin: url.origin, method: request.method() });
        await route.abort('blockedbyclient');
        return;
      }
      if (url.pathname.startsWith('/api/') && faults.api === 'DISCONNECTED') {
        requests.push({
          mode: 'MOCK',
          method: request.method(),
          path: url.pathname,
          status: null,
          transportError: 'connectionfailed',
          injectedFault: faults.api,
        });
        await route.abort('connectionfailed');
        return;
      }
      if (url.pathname.startsWith('/api/') && faults.api === 'UNAVAILABLE') {
        const body = JSON.stringify({ error: 'MOCK_API_UNAVAILABLE' });
        requests.push({
          mode: 'MOCK',
          method: request.method(),
          path: url.pathname,
          status: 503,
          response: JSON.parse(body),
          responseSha256: sha256(body),
          injectedFault: faults.api,
        });
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body,
        });
        return;
      }
      const rawHeaders = await request.allHeaders(),
        payload = request.postData();
      let response = demo
        ? await demoApp.app.inject({
            method: request.method(),
            url: url.pathname + url.search,
            headers: { ...rawHeaders, host: new URL(origin).host },
            ...(payload ? { payload } : {}),
          })
        : await s.request(
            url.pathname + url.search,
            payload ? JSON.parse(payload) : undefined,
            rawHeaders.cookie ?? '',
            { ...rawHeaders, host: new URL(origin).host, 'x-forwarded-proto': 'https' },
          );
      if (!demo && url.pathname === '/api/testnet/vaults' && response.statusCode === 200) {
        const barrier = faults.vaultReadBarrier;
        if (barrier) {
          faults.vaultReadBarrier = null;
          barrier.reached();
          await barrier.wait;
        }
        if (faults.vaultOwner !== 'NONE') {
          const value = response.json();
          if (faults.vaultOwner === 'MISSING') delete value.owner;
          else value.owner = faults.vaultOwner === 'MALFORMED' ? { mock: 'invalid-owner' } : OWNER_B;
          const payload = Buffer.from(JSON.stringify(value));
          response = { ...response, body: payload.toString(), rawPayload: payload };
          requests.push({
            mode: 'MOCK',
            method: request.method(),
            path: url.pathname,
            status: 200,
            injectedFault: 'VAULT_OWNER_' + faults.vaultOwner,
            response: value,
            responseSha256: sha256(payload),
          });
        }
      }
      if (demo && url.pathname.startsWith('/api/')) {
        let responseBody;
        try {
          responseBody = response.json();
        } catch {
          responseBody = { sha256: sha256(response.rawPayload) };
        }
        appendFileSync(
          join(s.directory, 'demo-api.jsonl'),
          JSON.stringify({
            mode: 'MOCK',
            scope: 'DEMO_RESEARCH',
            method: request.method(),
            path: url.pathname,
            request: payload ? JSON.parse(payload) : null,
            status: response.statusCode,
            response: responseBody,
          }) + '\n',
        );
      }
      requests.push({
        mode: 'MOCK',
        method: request.method(),
        path: url.pathname,
        status: response.statusCode,
        responseSha256: sha256(response.rawPayload),
      });
      const headers = Object.fromEntries(
        Object.entries(response.headers)
          .filter(([name]) => !['content-length', 'transfer-encoding', 'connection'].includes(name))
          .map(([name, value]) => [name, Array.isArray(value) ? value.join('\n') : String(value)]),
      );
      await route.fulfill({ status: response.statusCode, headers, body: response.rawPayload });
    });
    page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        appendFileSync(join(directory, 'console.jsonl'), JSON.stringify({ text: message.text() }) + '\n');
    });
  } catch (error) {
    await context?.close();
    await browser?.close();
    await demoApp?.app.close();
    await s.close();
    throw error;
  }
  async function capture(name) {
    await page.screenshot({ path: join(directory, name + '.png'), fullPage: true });
  }
  return {
    s,
    page,
    context,
    directory,
    origin,
    demoApp,
    faults,
    errors,
    blockedRequests,
    requests,
    async goto(path = '/') {
      await page.goto(origin + path);
      await page.locator('[data-release-mock]').waitFor();
    },
    async login() {
      await page.getByRole('button', { name: '连接钱包并登录', exact: true }).click();
      await page.locator('.vault-card h2').filter({ hasText: 'mock-owner-a' }).waitFor();
    },
    async preview(kind, fields = {}) {
      await page.locator('.vault-card form select').first().selectOption(kind);
      for (const [name, value] of Object.entries(fields)) await page.locator(`[name="${name}"]`).fill(value);
      await page.getByRole('button', { name: '预览待签交易', exact: true }).click();
      await page.getByRole('button', { name: '在 owner 钱包中确认', exact: true }).waitFor();
    },
    capture,
    async check(name, run) {
      try {
        await run();
        writeFileSync(
          join(directory, name + '.json'),
          JSON.stringify({ state: 'PASS', mode: 'MOCK', name }) + '\n',
          { flag: 'wx' },
        );
      } catch (error) {
        await capture(name + '-failure').catch(() => {});
        writeFileSync(
          join(directory, name + '-failure.json'),
          JSON.stringify(
            { state: 'FAIL', mode: 'MOCK', name, error: { message: error.message, stack: error.stack } },
            null,
            2,
          ) + '\n',
          { flag: 'wx' },
        );
        throw error;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await capture('final').catch(() => {});
        const state = await page
          .evaluate(() => ({
            localStorage: Object.fromEntries(Object.entries(localStorage)),
            wallet: window.__releaseMockWallet?.state,
          }))
          .catch(() => null);
        writeFileSync(join(directory, 'browser-state.json'), JSON.stringify(state, null, 2) + '\n');
        writeFileSync(
          join(directory, 'evidence.json'),
          JSON.stringify(
            {
              mode: 'MOCK',
              demoResearchOnly: demo,
              envelopeFixtureUsed: false,
              negativeOwnerFaults: requests
                .filter((request) => request.injectedFault?.startsWith('VAULT_OWNER_'))
                .map((request) => request.injectedFault),
              browserVersion: browser.version(),
              toolVersion: descriptor.browser.package.version,
              toolQualification,
              errors,
              blockedRequests,
              requests,
              walletRequests: s.walletRequests.map((r) =>
                r.method === 'personal_sign' ? { method: r.method, params: '[MOCK_LOGIN_REDACTED]' } : r,
              ),
            },
            null,
            2,
          ) + '\n',
        );
        assert.equal(s.broadcasts, 0);
      } finally {
        await context.close();
        await browser.close();
        await demoApp?.app.close();
        await s.close();
      }
    },
  };
}
