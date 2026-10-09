import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { LaunchMarketStore } from '../packages/launch-market/src/store.ts';
import { MarketEventBroker, MarketProjector } from '../packages/launch-market/src/projection.ts';
import {
  LaunchMarketError,
  type MarketSnapshot,
  type TrustedEmailIdentity,
} from '../packages/launch-market/src/types.ts';
import { ammQuote, ethSaleOutput, mintCost, usdcForEth } from '../packages/launch-market/src/math.ts';

const h = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const a = (n: number) => '0x' + n.toString(16).padStart(40, '0');
function identity(n: number): TrustedEmailIdentity {
  return { email: `user${n}@example.test`, subject: `google:${n}`, emailVerified: true };
}
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-launch-'));
  const path = join(folder, 'market.sqlite');
  const store = new LaunchMarketStore(path, 'https://www.ikol.top');
  return {
    store,
    path,
    close() {
      store.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
async function linked(store: LaunchMarketStore, n: number, now = 1000) {
  const account = store.trustedAccount(identity(n), now);
  const wallet = new Wallet(h(n + 1));
  const challenge = store.bindingChallenge(account.id, wallet.address, now);
  store.bindWallet(account.id, challenge.nonce, await wallet.signMessage(challenge.message), now);
  return { account: store.account(account.id), wallet };
}
function snapshot(block = 10): MarketSnapshot {
  const base = {
    state: 'LAUNCHED' as const,
    pass: a(1),
    totalSupplyRaw: '1000000000000000000000000',
    publicSupplyRaw: '0',
    soldRaw: '0',
    remainingRaw: '0',
    mintPriceUsdcRaw: '500000',
    lpPassRaw: '500000000000000000000000',
    lpUsdcRaw: '250000000000',
    pool: a(2),
    reservePassRaw: '500000000000000000000000',
    reserveUsdcRaw: '250000000000',
    ammFeeBps: 30,
  };
  return {
    location: {
      chainId: 46630,
      blockNumber: String(block),
      blockHash: h(block),
      transactionHash: null,
      logIndex: null,
      version: '0',
      confirmations: 1,
    },
    markets: {
      TSLA: {
        ...base,
        pass: a(3),
        state: 'MINTING',
        pool: null,
        publicSupplyRaw: '500000000000000000000000',
        remainingRaw: '500000000000000000000000',
      },
      AMZN: base,
    },
    claim: {
      amountUsdcRaw: '1000000000',
      successfulClaims: 0,
      maxClaims: 100,
      remainingClaims: 100,
      funded: true,
    },
    conversion: {
      ethReserveRaw: '100000000000000000000',
      usdcReserveRaw: '1000000000000',
      ethBuyAvailable: true,
      ethSellAvailable: true,
      feeBps: 0,
      epoch: '1',
    },
  };
}
test('verified opaque identities survive restart and preserve exact email distinctions', () => {
  const f = fixture();
  try {
    const original = f.store.trustedAccount({ ...identity(1), email: ' user.name+one@Example.Test ' }, 1000);
    assert.equal(original.email, 'user.name+one@example.test');
    assert.equal(
      f.store.trustedAccount({ ...identity(1), email: 'user.name+one@example.test' }, 1001).id,
      original.id,
    );
    assert.throws(
      () => f.store.trustedAccount({ ...identity(2), email: original.email }, 1000),
      /IDENTITY_CHANGED/,
    );
    assert.throws(
      () =>
        f.store.trustedAccount(
          { ...identity(3), emailVerified: false } as unknown as TrustedEmailIdentity,
          1000,
        ),
      /VERIFIED_EMAIL_REQUIRED/,
    );
    assert.notEqual(
      f.store.trustedAccount({ ...identity(4), email: 'username+one@example.test' }, 1000).id,
      original.id,
    );
    assert.notEqual(
      f.store.trustedAccount({ ...identity(5), email: 'User.Name+One@example.test' }, 1000).id,
      original.id,
    );
    const before = f.store.fingerprint();
    f.store.close();
    const reopened = new LaunchMarketStore(f.path, 'https://www.ikol.top');
    assert.equal(reopened.account(original.id).accountKey, original.accountKey);
    assert.equal(reopened.fingerprint(), before);
    reopened.close();
  } finally {
    f.close();
  }
});
test('wallet binding requires a matching unexpired signature bound to the authenticated account', async () => {
  const f = fixture();
  try {
    const alice = f.store.trustedAccount(identity(1), 1000),
      bob = f.store.trustedAccount(identity(2), 1000),
      wallet = new Wallet(h(4)),
      wrong = new Wallet(h(5));
    const challenge = f.store.bindingChallenge(alice.id, wallet.address, 1000);
    assert.match(challenge.message, /Chain ID: 46630/);
    assert.match(challenge.message, new RegExp(alice.id));
    assert.throws(
      () => f.store.bindWallet(bob.id, challenge.nonce, '0x' + '00'.repeat(65), 1000),
      /WALLET_CHALLENGE_EXPIRED/,
    );
    assert.throws(
      () => f.store.bindWallet(alice.id, challenge.nonce, '0x' + '00'.repeat(65), 1300),
      /WALLET_CHALLENGE_EXPIRED/,
    );
    assert.throws(
      () => f.store.bindWallet(alice.id, challenge.nonce, awaitSignatureDummy(), 1000),
      /WALLET_SIGNATURE_REJECTED/,
    );
    const fresh = f.store.bindingChallenge(alice.id, wallet.address, 1001);
    assert.throws(
      () => f.store.bindWallet(alice.id, fresh.nonce, '0x' + '00'.repeat(65), 1001),
      /WALLET_SIGNATURE_REJECTED/,
    );
    const next = f.store.bindingChallenge(alice.id, wallet.address, 1002),
      signature = await wallet.signMessage(next.message);
    assert.equal(
      f.store.bindWallet(alice.id, next.nonce, signature, 1002).wallet,
      wallet.address.toLowerCase(),
    );
    assert.throws(
      () => f.store.bindWallet(alice.id, next.nonce, signature, 1002),
      /WALLET_CHALLENGE_EXPIRED/,
    );
    const other = f.store.bindingChallenge(bob.id, wrong.address, 1003);
    assert.throws(
      () => f.store.bindWallet(bob.id, other.nonce, signature, 1003),
      /WALLET_SIGNATURE_REJECTED/,
    );
    const rebinding = f.store.bindingChallenge(bob.id, wallet.address, 1004);
    assert.throws(
      () => f.store.bindWallet(bob.id, rebinding.nonce, signature, 1004),
      /WALLET_SIGNATURE_REJECTED/,
    );
    const final = f.store.bindingChallenge(bob.id, wallet.address, 1005),
      finalSignature = await wallet.signMessage(final.message);
    assert.throws(
      () => f.store.bindWallet(bob.id, final.nonce, finalSignature, 1005),
      /WALLET_ALREADY_BOUND/,
    );
  } finally {
    f.close();
  }
});
function awaitSignatureDummy() {
  return '0x' + '01'.repeat(65);
}
test('one claim voucher persists across restart, login, wallet changes and reorg', async () => {
  const f = fixture();
  try {
    const { account, wallet } = await linked(f.store, 1);
    const voucher = f.store.reserveClaim(account.id, wallet.address, 1000, 1060, 0);
    assert.equal(f.store.reserveClaim(account.id, wallet.address, 1001, 1061, 0).nonce, voucher.nonce);
    f.store.close();
    const reopened = new LaunchMarketStore(f.path, 'https://www.ikol.top');
    assert.equal(reopened.reserveClaim(account.id, wallet.address, 1002, 1062, 0).nonce, voucher.nonce);
    const other = new Wallet(h(22)),
      challenge = reopened.bindingChallenge(account.id, other.address, 1003);
    reopened.bindWallet(account.id, challenge.nonce, await other.signMessage(challenge.message), 1003);
    assert.throws(
      () => reopened.reserveClaim(account.id, other.address, 1003, 1063, 0),
      /CLAIM_BOUND_TO_ORIGINAL_WALLET/,
    );
    const event = {
      accountKey: account.accountKey,
      wallet: wallet.address,
      location: { ...snapshot().location, transactionHash: h(40), logIndex: 2 },
    };
    reopened.observeClaim(event);
    assert.equal(reopened.voucher(account.id)!.status, 'INCLUDED');
    reopened.rollbackClaims(10n);
    assert.equal(reopened.voucher(account.id)!.status, 'REORGED');
    assert.throws(
      () => reopened.reserveClaim(account.id, other.address, 1004, 1064, 0),
      /CLAIM_BOUND_TO_ORIGINAL_WALLET/,
    );
    reopened.observeClaim({ ...event, location: { ...event.location, confirmations: 3 } });
    assert.equal(reopened.voucher(account.id)!.status, 'COMPLETED');
    reopened.close();
  } finally {
    f.close();
  }
});
test('claim reservation enforces 100 slots, expiration and canonical success count without resetting eligibility', async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 100; n++) {
      const { account, wallet } = await linked(f.store, n);
      f.store.reserveClaim(account.id, wallet.address, 1000, 1060, 0);
    }
    const extra = await linked(f.store, 101);
    assert.throws(
      () => f.store.reserveClaim(extra.account.id, extra.wallet.address, 1000, 1060, 0),
      /CLAIM_LIMIT_REACHED/,
    );
    const renewed = f.store.reserveClaim(extra.account.id, extra.wallet.address, 1061, 1121, 0);
    assert.equal(renewed.status, 'ISSUED');
    assert.throws(
      () => f.store.reserveClaim(extra.account.id, extra.wallet.address, 1122, 1182, 100),
      /CLAIM_RECONCILIATION_REQUIRED/,
    );
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM market_claim_vouchers').get()!.n, 101);
  } finally {
    f.close();
  }
});
test('canonical claims require the preserved identity and original voucher before issuing another account voucher', async () => {
  const original = fixture(),
    restored = fixture();
  try {
    const { account, wallet } = await linked(original.store, 1),
      event = {
        accountKey: account.accountKey,
        wallet: wallet.address,
        location: { ...snapshot().location, transactionHash: h(40), logIndex: 2, confirmations: 3 },
      };
    original.store.reserveClaim(account.id, wallet.address, 1000, 1060, 0);
    original.store.observeClaim(event);
    const next = await linked(original.store, 2);
    assert.throws(
      () => original.store.reserveClaim(next.account.id, next.wallet.address, 1001, 1061, 2),
      /CLAIM_RECONCILIATION_REQUIRED/,
    );
    // Rebinding the original account does not invalidate the preserved historical claim wallet.
    const rebound = Wallet.createRandom(),
      challenge = original.store.bindingChallenge(account.id, rebound.address, 1001);
    original.store.bindWallet(
      account.id,
      challenge.nonce,
      await rebound.signMessage(challenge.message),
      1001,
    );
    assert.equal(
      original.store.reserveClaim(next.account.id, next.wallet.address, 1001, 1061, 1).status,
      'ISSUED',
    );
    const sameIdentity = await linked(restored.store, 1);
    assert.notEqual(sameIdentity.account.accountKey, account.accountKey);
    assert.throws(
      () => restored.store.reserveClaim(sameIdentity.account.id, wallet.address, 1001, 1061, 1),
      /CLAIM_RECONCILIATION_REQUIRED/,
    );
    restored.store.observeClaim(event);
    assert.throws(
      () => restored.store.reserveClaim(sameIdentity.account.id, wallet.address, 1001, 1061, 1),
      /CLAIM_IDENTITY_RECOVERY_REQUIRED/,
    );
    // Matching counts and account keys alone do not establish a preserved original voucher.
    original.store.db
      .prepare('UPDATE market_claim_vouchers SET wallet=? WHERE account_id=?')
      .run(rebound.address.toLowerCase(), account.id);
    assert.throws(
      () => original.store.reserveClaim(next.account.id, next.wallet.address, 1001, 1061, 1),
      /CLAIM_IDENTITY_RECOVERY_REQUIRED/,
    );
  } finally {
    original.close();
    restored.close();
  }
});
test('projector rejects old updates, rewinds canonical claims and keeps durable monotonic versions', async () => {
  const f = fixture();
  try {
    const broker = new MarketEventBroker(),
      projector = new MarketProjector(f.store, broker),
      updates: string[] = [];
    const remove = broker.subscribe((event) => updates.push(event.type + ':' + event.location.version));
    const first = projector.commit(snapshot(10), h(9), null);
    assert.equal(first.location.version, '1');
    const second = projector.commit(snapshot(11), h(10), h(10));
    assert.equal(second.location.version, '2');
    assert.throws(() => projector.commit(snapshot(10), h(9), h(10)), /OLD_MARKET_UPDATE/);
    assert.throws(
      () =>
        projector.commit(
          { ...snapshot(11), location: { ...snapshot(11).location, blockHash: h(111) } },
          h(10),
          h(10),
        ),
      /REORG_REQUIRED/,
    );
    const rolled = projector.rollbackFrom('11');
    assert.equal(rolled!.location.blockNumber, '10');
    assert.equal(rolled!.location.version, '3');
    const replay = projector.commit(
      { ...snapshot(11), location: { ...snapshot(11).location, blockHash: h(111) } },
      h(10),
      h(10),
    );
    assert.equal(replay.location.version, '4');
    assert.deepEqual(updates, ['SNAPSHOT:1', 'SNAPSHOT:2', 'REORG:3', 'SNAPSHOT:4']);
    remove();
    f.store.close();
    const reopened = new LaunchMarketStore(f.path, 'https://www.ikol.top');
    assert.equal(new MarketProjector(reopened).latest()!.location.version, '4');
    reopened.close();
  } finally {
    f.close();
  }
});
test('SSE delivery bounds 100 connections and releases slots when subscribers close', () => {
  const broker = new MarketEventBroker();
  const removers = Array.from({ length: 100 }, () => broker.subscribe(() => {}));
  assert.equal(broker.connections, 100);
  assert.throws(() => broker.subscribe(() => {}), /SYNC_CONNECTION_LIMIT/);
  removers[0]!();
  assert.equal(broker.connections, 99);
  broker.subscribe(() => {});
  broker.close();
  assert.equal(broker.connections, 0);
});
test('money quotes preserve integer precision and match exact contract fee rounding', () => {
  assert.equal(mintCost(10n ** 18n), 500000n);
  assert.throws(() => mintCost(1n), /MINT_PRECISION/);
  assert.equal(ammQuote(1001n, 100000n, 100000n, 30).fee, 4n);
  const buy = ammQuote(100000000n, 250000000000n, 500000n * 10n ** 18n, 30),
    sell = ammQuote(buy.output, 500000n * 10n ** 18n, 250000000000n, 30);
  assert.ok(buy.output > 0n);
  assert.ok(sell.output < 100000000n);
  assert.equal(usdcForEth(10n ** 18n, 2000n * 10n ** 6n, 30), 1994n * 10n ** 6n);
  assert.equal(ethSaleOutput(2000n * 10n ** 6n, 2000n * 10n ** 6n, 30), 997n * 10n ** 15n);
  assert.throws(() => ammQuote(1n, 1n, 1n, 30), LaunchMarketError);
});
