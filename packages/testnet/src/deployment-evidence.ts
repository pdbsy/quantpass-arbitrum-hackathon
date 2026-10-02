import { keccak256 } from 'ethers';
import type { ReadonlyRpc } from '../../chain-adapter/src/rpc.ts';
import { asAddress, asHexData, asBlockHash, asTransactionHash } from '../../chain-adapter/src/types.ts';
import { validateDeploymentManifest, deploymentManifestDigest } from '../../chain-adapter/src/manifest.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../chain-adapter/src/pass-abi.ts';
import { tradingAbiHash, tradingAbiVersion, factoryInterface, feedInterface } from './trading-abi.ts';
import { validateTradingInventory } from './trading-inventory.ts';
import { readTradingSnapshot } from './trading-reader.ts';
import { seederInterface } from './pool-preparation.ts';
import { evidenceHash } from './executor-plan.ts';
import type { prepareDeploymentPlan } from './deployment-plan.ts';
import type { ReferenceTerms } from './reference-engine.ts';
type Plan = Awaited<ReturnType<typeof prepareDeploymentPlan>>;
/** Plan must be freshly regenerated from the qualified source/artifacts; never accept a client-supplied plan. */
export async function verifyTestnetDeployment(
  rpc: ReadonlyRpc,
  plan: Plan,
  creationHashes: readonly string[],
  poolCreationHashes: readonly string[],
  terms: readonly ReferenceTerms[],
  maxPriceAge: number,
) {
  if (
    (await rpc.chainId()) !== 46630 ||
    !rpc.transaction ||
    creationHashes.length !== plan.transactions.length ||
    poolCreationHashes.length !== 3 ||
    terms.length !== 3 ||
    new Set([...creationHashes, ...poolCreationHashes]).size !== creationHashes.length + 3
  )
    throw new Error('DEPLOYMENT_RECEIPT_INPUT');
  const head = await rpc.block('latest');
  if (!head) throw new Error('DEPLOYMENT_HEAD');
  const reference = { blockHash: head.hash, requireCanonical: true } as const;
  const hashes = new Map<string, string>(),
    blocks = new Map<string, string>(),
    receipts = [];
  for (let i = 0; i < plan.transactions.length; i++) {
    const expected = plan.transactions[i]!,
      hash = asTransactionHash(creationHashes[i]!),
      tx = await rpc.transaction(hash),
      receipt = await rpc.receipt(hash);
    if (
      !tx ||
      !receipt ||
      tx.hash !== hash ||
      receipt.transactionHash !== hash ||
      tx.chainId !== 46630 ||
      tx.from !== expected.from ||
      tx.to !== null ||
      tx.data !== expected.data.toLowerCase() ||
      tx.value !== 0n ||
      tx.nonce !== BigInt(expected.nonce) ||
      receipt.status !== 'SUCCESS' ||
      receipt.contractAddress !== expected.expectedAddress ||
      receipt.from !== tx.from ||
      receipt.to !== null ||
      tx.blockHash !== receipt.blockHash ||
      tx.blockNumber !== receipt.blockNumber ||
      tx.transactionIndex !== receipt.transactionIndex ||
      head.number - receipt.blockNumber + 1n < 3n
    )
      throw new Error('DEPLOYMENT_CREATION_RECEIPT');
    const canonical = await rpc.block(receipt.blockNumber);
    if (!canonical || canonical.hash !== receipt.blockHash) throw new Error('DEPLOYMENT_REORG');
    const code = await rpc.code(asAddress(expected.expectedAddress), reference);
    if (code === '0x') throw new Error('DEPLOYMENT_CODE');
    hashes.set(expected.expectedAddress, keccak256(code));
    blocks.set(expected.expectedAddress, String(receipt.blockNumber));
    receipts.push({
      name: expected.name,
      address: expected.expectedAddress,
      transactionHash: hash,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      artifactDigest: expected.artifactDigest,
    });
  }
  const pools: string[] = [];
  for (let i = 0; i < 3; i++) {
    const expected = plan.poolCalls[i]!,
      hash = asTransactionHash(poolCreationHashes[i]!),
      tx = await rpc.transaction(hash),
      receipt = await rpc.receipt(hash);
    if (
      !tx ||
      !receipt ||
      tx.hash !== hash ||
      receipt.transactionHash !== hash ||
      tx.chainId !== 46630 ||
      tx.from !== expected.from ||
      tx.to !== expected.to ||
      tx.data !== expected.data.toLowerCase() ||
      tx.value !== 0n ||
      tx.nonce !== BigInt(expected.nonce) ||
      receipt.status !== 'SUCCESS' ||
      receipt.from !== tx.from ||
      receipt.to !== tx.to ||
      tx.blockHash !== receipt.blockHash ||
      tx.blockNumber !== receipt.blockNumber ||
      tx.transactionIndex !== receipt.transactionIndex ||
      head.number - receipt.blockNumber + 1n < 3n
    )
      throw new Error('DEPLOYMENT_POOL_RECEIPT');
    const canonical = await rpc.block(receipt.blockNumber);
    if (!canonical || canonical.hash !== receipt.blockHash) throw new Error('DEPLOYMENT_REORG');
    const pool = asAddress(
      String(
        factoryInterface.decodeFunctionResult(
          'getPool',
          await rpc.call(
            {
              to: asAddress(plan.addresses.factory),
              data: asHexData(
                factoryInterface.encodeFunctionData('getPool', [
                  plan.addresses.usdc,
                  plan.addresses.stocks[i],
                  3000,
                ]),
              ),
            },
            reference,
          ),
        )[0],
      ),
    );
    const code = await rpc.code(pool, reference);
    if (code === '0x') throw new Error('DEPLOYMENT_POOL_CODE');
    hashes.set(pool, keccak256(code));
    pools.push(pool);
  }
  const operator = plan.transactions.find((t) => t.expectedAddress === plan.addresses.seeder)!.from;
  for (const [method, expected] of [
    ['owner', operator],
    ['factory', plan.addresses.factory],
    ['usdc', plan.addresses.usdc],
  ]) {
    const data = await rpc.call(
      { to: asAddress(plan.addresses.seeder), data: asHexData(seederInterface.encodeFunctionData(method!)) },
      reference,
    );
    if (String(seederInterface.decodeFunctionResult(method!, data)[0]).toLowerCase() !== expected)
      throw new Error('DEPLOYMENT_SEEDER');
  }
  for (let i = 0; i < 3; i++) {
    const data = await rpc.call(
      {
        to: asAddress(plan.addresses.seeder),
        data: asHexData(seederInterface.encodeFunctionData('stocks', [i])),
      },
      reference,
    );
    if (
      String(seederInterface.decodeFunctionResult('stocks', data)[0]).toLowerCase() !==
      plan.addresses.stocks[i]
    )
      throw new Error('DEPLOYMENT_SEEDER');
  }
  const vaults = [];
  for (const v of plan.addresses.vaults) {
    const locker = asAddress(v.passLocker),
      code = await rpc.code(locker, reference);
    if (code === '0x') throw new Error('DEPLOYMENT_LOCKER_CODE');
    hashes.set(locker, keccak256(code));
    const document = {
      schemaVersion: 1 as const,
      environment: 'robinhood-chain-testnet' as const,
      chainId: 46630 as const,
      contractName: 'AlphaForgeTradingVault',
      contractType: 'vault' as const,
      contractAddress: asAddress(v.vault),
      deploymentBlock: blocks.get(v.vault)!,
      abiVersion: tradingAbiVersion,
      abiHash: asBlockHash(tradingAbiHash),
      runtimeBytecodeHash: asBlockHash(hashes.get(v.vault)!),
      strategyPassAddress: asAddress(plan.addresses.pass),
      strategyPassDeploymentBlock: blocks.get(plan.addresses.pass)!,
      strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
      strategyPassRuntimeBytecodeHash: asBlockHash(hashes.get(plan.addresses.pass)!),
    };
    const manifest = { ...document, manifestDigest: deploymentManifestDigest(document) };
    const inventory = {
      schemaVersion: 1,
      chainId: 46630,
      kind: 'TEST_SUBSTITUTES',
      deploymentManifestDigest: manifest.manifestDigest,
      owner: v.owner,
      passLocker: v.passLocker,
      usdc: plan.addresses.usdc,
      router: plan.addresses.router,
      quoter: plan.addresses.quoter,
      factory: plan.addresses.factory,
      maxPriceAge,
      stocks: terms.map((term, i) => ({
        symbol: term.symbol,
        token: plan.addresses.stocks[i],
        feed: plan.addresses.feeds[i],
        pool: pools[i],
        referenceIdentity: evidenceHash(term),
        keeper: plan.addresses.keeper,
      })),
      codeHashes: [
        v.passLocker,
        plan.addresses.usdc,
        plan.addresses.router,
        plan.addresses.quoter,
        plan.addresses.factory,
        ...terms.flatMap((_t, i) => [plan.addresses.stocks[i]!, plan.addresses.feeds[i]!, pools[i]!]),
      ].map((address) => ({ address, hash: hashes.get(address)! })),
    };
    // Feed keeper is read from canonical deployed state, not a display label or ticker.
    for (const stock of inventory.stocks) {
      const result = await rpc.call(
        { to: asAddress(stock.feed!), data: asHexData(feedInterface.encodeFunctionData('keeper')) },
        reference,
      );
      if (String(feedInterface.decodeFunctionResult('keeper', result)[0]).toLowerCase() !== stock.keeper)
        throw new Error('DEPLOYMENT_KEEPER');
    }
    const qualifiedManifest = validateDeploymentManifest(manifest, {
      environment: 'robinhood-chain-testnet',
      chainId: 46630,
      manifestDigest: manifest.manifestDigest,
    });
    const inventoryDigest = evidenceHash(inventory),
      qualifiedInventory = validateTradingInventory(inventory, inventoryDigest, manifest.manifestDigest);
    await readTradingSnapshot(rpc, qualifiedManifest, qualifiedInventory, head);
    vaults.push({ manifest, inventory, inventoryDigest });
  }
  const canonical = await rpc.block(head.number);
  if (!canonical || canonical.hash !== head.hash) throw new Error('DEPLOYMENT_REORG');
  return Object.freeze({
    schemaVersion: 1,
    chainId: 46630,
    verifiedBlock: String(head.number),
    verifiedBlockHash: head.hash,
    receipts,
    vaults,
    operatorLiquidity: {
      owner: operator,
      seeder: plan.addresses.seeder,
      runtimeBytecodeHash: hashes.get(plan.addresses.seeder)!,
    },
    l2Finality: 'SOFT_3_CONFIRMATIONS',
    l1Finality: 'UNKNOWN',
    poolInitialization: 'NOT_ASSERTED',
    executionGrants: 'NOT_ASSERTED',
    scope: 'TEST_SUBSTITUTES_ONLY',
  });
}
