import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { Wallet } from 'ethers';
import { readRegularBytes } from '../../../../packages/testnet/src/bounded-file.ts';
import type { MarketQuoteSigner } from '../../../../packages/launch-market/src/service.ts';

export interface OfflineVoucherSignerFiles {
  readonly rawFile?: string | undefined;
  readonly keystoreFile?: string | undefined;
  readonly unlockFile?: string | undefined;
}

function reject(): never {
  throw new Error('OFFLINE_VOUCHER_SIGNER_REJECTED');
}

function privateText(path: string, maximum: number): string {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) reject();
  const before = lstatSync(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    (before.mode & 0o077n) !== 0n ||
    before.uid !== BigInt(process.getuid!())
  )
    reject();
  const parent = lstatSync(dirname(path), { bigint: true });
  if (!parent.isDirectory() || (parent.mode & 0o022n) !== 0n) reject();
  const bytes = readRegularBytes(path, maximum);
  const after = lstatSync(path, { bigint: true });
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.ctimeNs !== before.ctimeNs ||
    after.mtimeNs !== before.mtimeNs ||
    after.mode !== before.mode ||
    after.uid !== before.uid
  )
    reject();
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}

/** Limit decryption work before ethers sees operator-provided KDF parameters. */
function boundedKeystore(json: string): string {
  const parsed = record(JSON.parse(json));
  if (parsed.version !== 3 || typeof parsed.address !== 'string' || !/^[a-fA-F0-9]{40}$/.test(parsed.address))
    reject();
  // ethers writes "Crypto" and reads case-insensitively. Normalize one unambiguous alias only.
  const aliases = Object.keys(parsed).filter((key) => key.toLowerCase() === 'crypto');
  if (aliases.length !== 1 || !['crypto', 'Crypto'].includes(aliases[0]!)) reject();
  const crypto = record(parsed[aliases[0]!]),
    parameters = record(crypto.kdfparams),
    cipher = record(crypto.cipherparams);
  for (const object of [crypto, parameters, cipher])
    if (Object.keys(object).some((key) => key !== key.toLowerCase())) reject();
  if (
    crypto.cipher !== 'aes-128-ctr' ||
    typeof crypto.ciphertext !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(crypto.ciphertext) ||
    typeof crypto.mac !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(crypto.mac) ||
    typeof cipher.iv !== 'string' ||
    !/^[a-fA-F0-9]{32}$/.test(cipher.iv) ||
    typeof parameters.salt !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(parameters.salt) ||
    parameters.dklen !== 32
  )
    reject();
  const integer = (value: unknown, minimum: number, maximum: number) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  if (crypto.kdf === 'scrypt') {
    const { n, r, p } = parameters;
    if (
      !integer(n, 1024, 262144) ||
      !integer(r, 1, 8) ||
      !integer(p, 1, 4) ||
      ((n as number) & ((n as number) - 1)) !== 0 ||
      128 * (n as number) * (r as number) > 256 * 1024 * 1024 ||
      (n as number) * (r as number) * (p as number) > 8 * 1024 * 1024
    )
      reject();
  } else if (crypto.kdf === 'pbkdf2') {
    if (!integer(parameters.c, 1000, 1000000) || parameters.prf !== 'hmac-sha256') reject();
  } else reject();
  const normalized = { ...parsed };
  delete normalized[aliases[0]!];
  normalized.crypto = crypto;
  return JSON.stringify(normalized);
}

/** Keystore decryption stays in memory; the exposed capability cannot submit or sign transactions. */
export async function loadOfflineVoucherSigner(
  files: OfflineVoucherSignerFiles,
): Promise<MarketQuoteSigner | null> {
  if (files.rawFile === undefined && files.keystoreFile === undefined && files.unlockFile === undefined)
    return null;
  try {
    let wallet: Wallet;
    if (files.rawFile !== undefined) {
      if (files.keystoreFile !== undefined || files.unlockFile !== undefined) reject();
      const raw = privateText(files.rawFile, 256).trim();
      if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) reject();
      wallet = new Wallet(raw);
    } else {
      if (files.keystoreFile === undefined || files.unlockFile === undefined) reject();
      if (files.keystoreFile === files.unlockFile) reject();
      const json = privateText(files.keystoreFile, 32768),
        unlock = privateText(files.unlockFile, 512).replace(/\r?\n$/, '');
      if (unlock.length < 16 || /[\r\n\0]/.test(unlock)) reject();
      const bounded = boundedKeystore(json);
      const decrypted = await Wallet.fromEncryptedJson(bounded, unlock);
      wallet = new Wallet(decrypted.privateKey);
    }
    return Object.freeze({
      getAddress: () => wallet.getAddress(),
      signTypedData: (domain, types, value) => wallet.signTypedData(domain, types, value),
    } satisfies MarketQuoteSigner);
  } catch {
    // Neither malformed operator content nor ethers errors may expose key material in logs.
    reject();
  }
}
