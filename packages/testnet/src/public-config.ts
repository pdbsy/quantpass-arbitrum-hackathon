import { isAbsolute, resolve } from 'node:path';
import { parseVaultBindings, type VaultBinding } from './server-config.ts';
import { asBlockHash, type BlockHash } from '../../chain-adapter/src/types.ts';
import type { ExecutionStatusBinding } from './execution-status.ts';

export interface TradingVaultBinding extends VaultBinding {
  readonly inventoryFile: string;
  readonly inventoryDigest: BlockHash;
}

export interface PublicTestnetConfig {
  readonly executorStatus?: ExecutionStatusBinding;
  readonly schemaVersion: 1;
  readonly profile: 'PUBLIC_TESTNET';
  readonly chainId: 46630;
  readonly origin: string;
  readonly dataDirectory: string;
  readonly syncIntervalMs: number;
  readonly challengeTtlMs: number;
  readonly sessionTtlMs: number;
  readonly maxAuthRows: number;
  readonly maxStorageBytes: number;
  readonly vaults: readonly TradingVaultBinding[];
}
const keys = [
  'schemaVersion',
  'profile',
  'chainId',
  'origin',
  'dataDirectory',
  'syncIntervalMs',
  'challengeTtlMs',
  'sessionTtlMs',
  'maxAuthRows',
  'maxStorageBytes',
  'vaults',
];
const invalid = (): never => {
  throw new Error('PUBLIC_TESTNET_CONFIGURATION');
};
const bounded = (input: unknown, min: number, max: number): number => {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max)
    return invalid();
  return input;
};
function bindings(input: unknown): readonly TradingVaultBinding[] {
  if (!Array.isArray(input) || input.length > 16) return invalid();
  const files = new Set<string>();
  const raw = input.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).length !== 6 ||
      Object.keys(item).some(
        (key) =>
          ![
            'id',
            'manifestFile',
            'manifestDigest',
            'vaultAddress',
            'inventoryFile',
            'inventoryDigest',
          ].includes(key),
      )
    )
      return invalid();
    const v = item as Record<string, unknown>;
    if (typeof v.inventoryFile !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(v.inventoryFile))
      return invalid();
    const inventoryDigest = asBlockHash(String(v.inventoryDigest));
    if (
      /^0x0+$/.test(inventoryDigest) ||
      files.has(v.inventoryFile) ||
      files.has(String(v.manifestFile)) ||
      v.inventoryFile === v.manifestFile
    )
      return invalid();
    files.add(v.inventoryFile);
    files.add(String(v.manifestFile));
    return {
      id: v.id,
      manifestFile: v.manifestFile,
      manifestDigest: v.manifestDigest,
      vaultAddress: v.vaultAddress,
      inventoryFile: v.inventoryFile,
      inventoryDigest,
    };
  });
  const base = parseVaultBindings(
    raw.map(({ id, manifestFile, manifestDigest, vaultAddress }) => ({
      id,
      manifestFile,
      manifestDigest,
      vaultAddress,
    })),
  );
  return Object.freeze(
    base.map((v, i) =>
      Object.freeze({ ...v, inventoryFile: raw[i]!.inventoryFile, inventoryDigest: raw[i]!.inventoryDigest }),
    ),
  );
}
export function parsePublicTestnetConfig(input: unknown): PublicTestnetConfig {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).length !== keys.length + (v.executorStatus === undefined ? 0 : 1) ||
      Object.keys(v).some((key) => !keys.includes(key) && key !== 'executorStatus') ||
      v.schemaVersion !== 1 ||
      v.profile !== 'PUBLIC_TESTNET' ||
      v.chainId !== 46630
    )
      return invalid();
    if (
      typeof v.origin !== 'string' ||
      typeof v.dataDirectory !== 'string' ||
      !isAbsolute(v.dataDirectory) ||
      v.dataDirectory !== resolve(v.dataDirectory) ||
      v.dataDirectory === resolve('/') ||
      Array.from(v.dataDirectory).some((c) => c.charCodeAt(0) < 32)
    )
      return invalid();
    const origin = new URL(v.origin);
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== v.origin ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/'
    )
      return invalid();
    let executorStatus: ExecutionStatusBinding | undefined;
    if (v.executorStatus !== undefined) {
      const s = v.executorStatus as Record<string, unknown>;
      if (
        !s ||
        Array.isArray(s) ||
        Object.keys(s).length !== 2 ||
        Object.keys(s).some((k) => !['file', 'configurationDigest'].includes(k)) ||
        typeof s.file !== 'string' ||
        !isAbsolute(s.file) ||
        s.file !== resolve(s.file) ||
        !s.file.endsWith('/execution-status.json') ||
        typeof s.configurationDigest !== 'string' ||
        !/^0x[0-9a-f]{64}$/.test(s.configurationDigest) ||
        /^0x0+$/.test(s.configurationDigest)
      )
        return invalid();
      executorStatus = Object.freeze({ file: s.file, configurationDigest: s.configurationDigest });
    }
    return Object.freeze({
      ...(executorStatus ? { executorStatus } : {}),
      schemaVersion: 1,
      profile: 'PUBLIC_TESTNET',
      chainId: 46630,
      origin: origin.origin,
      dataDirectory: v.dataDirectory,
      syncIntervalMs: bounded(v.syncIntervalMs, 1000, 300000),
      challengeTtlMs: bounded(v.challengeTtlMs, 1000, 300000),
      sessionTtlMs: bounded(v.sessionTtlMs, 1000, 28800000),
      maxAuthRows: bounded(v.maxAuthRows, 1, 10000),
      maxStorageBytes: bounded(v.maxStorageBytes, 1048576, 8000000000),
      vaults: bindings(v.vaults),
    });
  } catch {
    return invalid();
  }
}
