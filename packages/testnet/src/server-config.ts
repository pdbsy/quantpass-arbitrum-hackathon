import { isAbsolute, join, resolve } from 'node:path';
import type { M3ChainRuntimeDeployment } from '../../../apps/server/src/m3-chain-runtime.ts';
import { validateDeploymentManifest } from '../../chain-adapter/src/manifest.ts';
import { asAddress, asBlockHash, type Address, type BlockHash } from '../../chain-adapter/src/types.ts';
import { M3_VAULT_ABI_HASH, M3_VAULT_ABI_VERSION } from '../../chain-adapter/src/vault-abi.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../chain-adapter/src/pass-abi.ts';

export interface VaultBinding {
  readonly id: string;
  readonly manifestFile: string;
  readonly manifestDigest: BlockHash;
  readonly vaultAddress: Address;
}

export interface TestnetServerConfig {
  readonly schemaVersion: 1;
  readonly profile: 'M3_READONLY_TESTNET';
  readonly chainId: 46630;
  readonly origin: string;
  readonly dataDirectory: string;
  readonly syncIntervalMs: number;
  readonly vaults: readonly VaultBinding[];
}

function invalid(): never {
  throw new Error('INVALID_TESTNET_SERVER_CONFIG');
}

function fields(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return invalid();
  return value;
}

export function parseVaultBindings(input: unknown): readonly VaultBinding[] {
  if (!Array.isArray(input) || input.length > 16) return invalid();
  const ids = new Set<string>();
  const addresses = new Set<string>();
  const files = new Set<string>();
  const vaults = input.map((raw): VaultBinding => {
    const a = fields(raw, ['id', 'manifestFile', 'manifestDigest', 'vaultAddress']);
    if (
      typeof a.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,47}$/.test(a.id) ||
      typeof a.manifestFile !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(a.manifestFile)
    )
      return invalid();
    let address: Address;
    let digest: BlockHash;
    try {
      address = asAddress(a.vaultAddress as string);
      digest = asBlockHash(a.manifestDigest as string);
    } catch {
      return invalid();
    }
    if (
      /^0x0+$/.test(address) ||
      /^0x0+$/.test(digest) ||
      ids.has(a.id) ||
      addresses.has(address.toLowerCase()) ||
      files.has(a.manifestFile)
    )
      return invalid();
    ids.add(a.id);
    addresses.add(address.toLowerCase());
    files.add(a.manifestFile);
    return Object.freeze({
      id: a.id,
      manifestFile: a.manifestFile,
      manifestDigest: digest,
      vaultAddress: address,
    });
  });
  return Object.freeze(vaults);
}

/** Offline admission only. This profile cannot open public ingress or an executor. */
export function parseTestnetServerConfig(input: unknown): TestnetServerConfig {
  const v = fields(input, [
    'schemaVersion',
    'profile',
    'chainId',
    'origin',
    'dataDirectory',
    'syncIntervalMs',
    'vaults',
  ]);
  if (v.schemaVersion !== 1 || v.profile !== 'M3_READONLY_TESTNET' || v.chainId !== 46630) return invalid();
  if (
    typeof v.origin !== 'string' ||
    typeof v.dataDirectory !== 'string' ||
    !isAbsolute(v.dataDirectory) ||
    v.dataDirectory !== resolve(v.dataDirectory) ||
    v.dataDirectory === resolve('/') ||
    Array.from(v.dataDirectory).some((character) => character.charCodeAt(0) < 32)
  )
    return invalid();
  let origin: URL;
  try {
    origin = new URL(v.origin);
  } catch {
    return invalid();
  }
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    origin.origin !== v.origin ||
    !origin.port
  )
    return invalid();
  if (
    !Number.isSafeInteger(v.syncIntervalMs) ||
    Number(v.syncIntervalMs) < 1000 ||
    Number(v.syncIntervalMs) > 300000 ||
    !Array.isArray(v.vaults) ||
    v.vaults.length > 16
  )
    return invalid();
  const vaults = parseVaultBindings(v.vaults);
  return Object.freeze({
    schemaVersion: 1,
    profile: 'M3_READONLY_TESTNET',
    chainId: 46630,
    origin: origin.origin,
    dataDirectory: v.dataDirectory,
    syncIntervalMs: Number(v.syncIntervalMs),
    vaults: Object.freeze(vaults),
  });
}

function rpcEndpoints(input: readonly string[]): readonly string[] {
  if (!Array.isArray(input) || input.length !== 1) throw new Error('INVALID_TESTNET_RPC_CONFIGURATION');
  let url: URL;
  try {
    url = new URL(input[0]!);
  } catch {
    throw new Error('INVALID_TESTNET_RPC_CONFIGURATION');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('INVALID_TESTNET_RPC_CONFIGURATION');
  return Object.freeze([url.toString()]);
}

/** Operator file reads are the only injected side effect; no RPC or signing is performed. */
export async function loadTestnetDeployments(
  input: unknown,
  endpoints: readonly string[],
  manifestReader: (relativeFile: string) => Promise<unknown>,
): Promise<readonly M3ChainRuntimeDeployment[]> {
  const config = parseTestnetServerConfig(input);
  if (config.vaults.length === 0)
    return Object.freeze([Object.freeze({ deploymentStatus: 'NOT_DEPLOYED' as const })]);
  const urls = rpcEndpoints(endpoints);
  const deployments: M3ChainRuntimeDeployment[] = [];
  for (const binding of config.vaults) {
    let document: unknown;
    try {
      document = await manifestReader(binding.manifestFile);
    } catch {
      throw new Error('TESTNET_MANIFEST_READ_FAILED');
    }
    const manifest = validateDeploymentManifest(document, {
      environment: 'robinhood-chain-testnet',
      chainId: 46630,
      manifestDigest: binding.manifestDigest,
      contractAddress: binding.vaultAddress,
    });
    if (
      manifest.contractName !== 'AlphaForgeVault' ||
      manifest.contractType !== 'vault' ||
      manifest.abiVersion !== M3_VAULT_ABI_VERSION ||
      manifest.abiHash.toLowerCase() !== M3_VAULT_ABI_HASH.toLowerCase() ||
      manifest.strategyPassAbiHash.toLowerCase() !== M3_STRATEGY_PASS_ABI_HASH.toLowerCase()
    )
      throw new Error('M3_VAULT_ABI_MISMATCH');
    deployments.push(
      Object.freeze({
        deploymentStatus: 'DEPLOYED' as const,
        dbPath: join(config.dataDirectory, `vault-${binding.id}.sqlite`),
        rpcEndpoints: urls,
        manifestDocument: Object.freeze({ ...(document as Record<string, unknown>) }),
        expectedManifestDigest: binding.manifestDigest,
        expectedContractAddress: binding.vaultAddress,
      }),
    );
  }
  return Object.freeze(deployments);
}
