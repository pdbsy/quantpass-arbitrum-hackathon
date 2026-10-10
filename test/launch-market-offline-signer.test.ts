import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet, encryptKeystoreJson, verifyTypedData } from 'ethers';
import { loadOfflineVoucherSigner } from '../apps/server/src/launch-market-adapters/offline-voucher-signer.ts';

const password = randomBytes(32).toString('base64url');

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'af-offline-voucher-'));
  chmodSync(directory, 0o700);
  const wallet = Wallet.createRandom();
  const keystoreFile = join(directory, 'signer.json'),
    unlockFile = join(directory, 'unlock'),
    rawFile = join(directory, 'legacy.key');
  const json = await encryptKeystoreJson(
    { address: wallet.address, privateKey: wallet.privateKey },
    password,
    {
      scrypt: { N: 1024, r: 8, p: 1 },
    },
  );
  writeFileSync(keystoreFile, json, { mode: 0o600 });
  writeFileSync(unlockFile, password + '\n', { mode: 0o600 });
  writeFileSync(rawFile, wallet.privateKey + '\n', { mode: 0o600 });
  return {
    directory,
    wallet,
    keystoreFile,
    unlockFile,
    rawFile,
    json,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('a genuine encrypted isolated key can issue a recoverable EIP-712 voucher without provider or transaction capability', async () => {
  const files = await fixture();
  try {
    assert.equal(await loadOfflineVoucherSigner({}), null);
    for (const configuration of [
      { keystoreFile: files.keystoreFile, unlockFile: files.unlockFile },
      { rawFile: files.rawFile },
    ]) {
      const signer = (await loadOfflineVoucherSigner(configuration))!;
      assert.equal(await signer.getAddress(), files.wallet.address);
      assert.deepEqual(Object.keys(signer).sort(), ['getAddress', 'signTypedData']);
      assert.equal(Object.isFrozen(signer), true);
      const domain = { name: 'Isolated Voucher', version: '1', chainId: 46630 },
        types = { Voucher: [{ name: 'nonce', type: 'uint256' }] },
        value = { nonce: 3n };
      const signature = await signer.signTypedData(domain, types, value);
      assert.equal(verifyTypedData(domain, types, value, signature), files.wallet.address);
    }
  } finally {
    files.close();
  }
});

test('wrong unlock, missing or mixed mode and unsafe private files fail without leaking operator input', async () => {
  const files = await fixture();
  const reject = async (configuration: Parameters<typeof loadOfflineVoucherSigner>[0]) => {
    await assert.rejects(loadOfflineVoucherSigner(configuration), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'OFFLINE_VOUCHER_SIGNER_REJECTED');
      assert.equal(error.cause, undefined);
      return true;
    });
  };
  try {
    await reject({ keystoreFile: files.keystoreFile });
    await reject({ unlockFile: files.unlockFile });
    await reject({ rawFile: files.rawFile, unlockFile: files.unlockFile });
    await reject({ rawFile: files.rawFile, keystoreFile: files.keystoreFile });
    await reject({ rawFile: '' });
    await reject({ rawFile: 'relative.key' });
    writeFileSync(files.unlockFile, 'wrong-but-long-enough-unlock', { mode: 0o600 });
    await reject({ keystoreFile: files.keystoreFile, unlockFile: files.unlockFile });
    writeFileSync(files.unlockFile, password, { mode: 0o600 });
    chmodSync(files.unlockFile, 0o640);
    await reject({ keystoreFile: files.keystoreFile, unlockFile: files.unlockFile });
    chmodSync(files.unlockFile, 0o600);
    const alias = join(files.directory, 'alias');
    symlinkSync(files.keystoreFile, alias);
    await reject({ keystoreFile: alias, unlockFile: files.unlockFile });
    linkSync(files.rawFile, join(files.directory, 'hardlink'));
    await reject({ rawFile: files.rawFile });
    chmodSync(files.directory, 0o770);
    await reject({ keystoreFile: files.keystoreFile, unlockFile: files.unlockFile });
  } finally {
    files.close();
  }
});

test('unbounded KDF work, ambiguous case aliases and oversized inputs are rejected before decryption', async () => {
  const files = await fixture();
  try {
    const original = JSON.parse(files.json);
    const crypto = original.Crypto;
    for (const parameters of [
      { ...crypto.kdfparams, n: 2 ** 30 },
      { ...crypto.kdfparams, r: 1024 },
      { ...crypto.kdfparams, p: 1000 },
      { ...crypto.kdfparams, n: 1025 },
      { ...crypto.kdfparams, n: '1024' },
      { N: 2 ** 30, ...crypto.kdfparams },
    ]) {
      writeFileSync(
        files.keystoreFile,
        JSON.stringify({ ...original, Crypto: { ...crypto, kdfparams: parameters } }),
      );
      await assert.rejects(
        loadOfflineVoucherSigner({ keystoreFile: files.keystoreFile, unlockFile: files.unlockFile }),
        /^Error: OFFLINE_VOUCHER_SIGNER_REJECTED$/,
      );
    }
    writeFileSync(files.keystoreFile, JSON.stringify({ ...original, crypto }));
    await assert.rejects(
      loadOfflineVoucherSigner({ keystoreFile: files.keystoreFile, unlockFile: files.unlockFile }),
      /OFFLINE_VOUCHER_SIGNER_REJECTED/,
    );
    writeFileSync(files.keystoreFile, ' '.repeat(32769));
    await assert.rejects(
      loadOfflineVoucherSigner({ keystoreFile: files.keystoreFile, unlockFile: files.unlockFile }),
      /OFFLINE_VOUCHER_SIGNER_REJECTED/,
    );
  } finally {
    files.close();
  }
});
