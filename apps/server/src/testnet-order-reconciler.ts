import { OrderJournal } from '../../../packages/testnet/src/order-journal.ts';
import type { ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import { asAddress, asTransactionHash } from '../../../packages/chain-adapter/src/types.ts';
import { createOperation, transitionOperation } from '../../../packages/chain-adapter/src/lifecycle.ts';
import { readTradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import { feedInterface } from '../../../packages/testnet/src/trading-abi.ts';
import type { BatchJournal } from '../../../packages/market-data/src/batch-journal.ts';
import {
  createReferenceEngine,
  advanceReferenceEngine,
  type ReferenceTerms,
} from '../../../packages/testnet/src/reference-engine.ts';
import { TradingVaultContractIntegration, decodeTradingEvent } from './trading-vault-integration.ts';
import type { SubmissionPolicy } from '../../../packages/testnet/src/restricted-submission.ts';
import type { ExecutorDeployment } from './testnet-executor-service.ts';

/** Bounded pages retain every original outcome; canonical replacements must be revalidated. */
export function restrictedOrderReconciler(
  orders: OrderJournal,
  rpc: ReadonlyRpc,
  deployments: readonly ExecutorDeployment[],
  batches: BatchJournal,
  terms: readonly ReferenceTerms[],
  gasPolicy?: SubmissionPolicy,
) {
  let cursor = '';
  return async () => {
    if ((await rpc.chainId()) !== 46630 || !rpc.transaction) throw new Error('ORDER_RECONCILIATION_CHAIN');
    const head = await rpc.block('latest');
    if (!head) throw new Error('ORDER_RECONCILIATION_HEAD');
    const page = orders.reconcileCandidates(cursor);
    if (!page.length) {
      cursor = '';
      return;
    }
    for (const order of page) {
      cursor = order.intent.id;
      const d = deployments.find(
        (d) =>
          d.manifest.contractAddress === order.intent.vault &&
          d.manifest.manifestDigest === order.intent.manifestDigest &&
          d.inventory.owner === order.intent.owner,
      );
      if (!d || !order.transactionHash) throw new Error('ORDER_RECONCILIATION_IDENTITY');
      const hash = asTransactionHash(order.transactionHash),
        receipt = await rpc.receipt(hash);
      if (!receipt) {
        if (order.state === 'RECONCILED' || order.state === 'REVERTED')
          orders.recordOutcome(
            order.intent.id,
            'REORGED',
            JSON.stringify({ reason: 'RECEIPT_DISAPPEARED', previousState: order.state }),
          );
        continue;
      }
      const block = await rpc.block(receipt.blockNumber);
      if (!block || block.hash !== receipt.blockHash) {
        orders.recordOutcome(
          order.intent.id,
          'REORGED',
          JSON.stringify({ reason: 'RECEIPT_NOT_CANONICAL', previousState: order.state }),
        );
        continue;
      }
      if (head.number - block.number + 1n < 3n) continue;
      const tx = await rpc.transaction(hash);
      if (
        !tx ||
        tx.hash !== hash ||
        receipt.transactionHash !== hash ||
        tx.chainId !== 46630 ||
        tx.from !== order.intent.executor ||
        tx.to !== (order.intent.feed ?? order.intent.vault) ||
        tx.data !== order.intent.calldata ||
        tx.value !== 0n ||
        String(tx.nonce) !== order.nonce ||
        tx.blockHash !== receipt.blockHash ||
        tx.blockNumber !== receipt.blockNumber ||
        tx.transactionIndex !== receipt.transactionIndex ||
        receipt.from !== tx.from ||
        receipt.to !== tx.to ||
        receipt.gasUsed === undefined ||
        receipt.effectiveGasPrice === undefined
      )
        throw new Error('ORDER_RECONCILIATION_ENVELOPE');
      if (
        receipt.gasUsed <= 0n ||
        (gasPolicy &&
          (receipt.gasUsed > BigInt(gasPolicy.gasLimit) ||
            receipt.effectiveGasPrice > BigInt(gasPolicy.maxFeePerGas) ||
            receipt.gasUsed * receipt.effectiveGasPrice > BigInt(gasPolicy.maxGasCostWei)))
      )
        throw new Error('ORDER_RECONCILIATION_GAS');
      if (receipt.status === 'SUCCESS') {
        await readTradingSnapshot(rpc, d.manifest, d.inventory, block);
        if (order.intent.purpose === 'FEED_UPDATE') {
          const mapping = d.inventory.stocks.find((s) => s.feed === order.intent.feed);
          if (!mapping || mapping.keeper !== tx.from) throw new Error('ORDER_RECONCILIATION_FEED');
          const action = feedInterface.parseTransaction({ data: tx.data });
          if (
            action?.name !== 'update' ||
            feedInterface.encodeFunctionData('update', [...action.args]).toLowerCase() !== tx.data
          )
            throw new Error('ORDER_RECONCILIATION_FEED');
          const row = batches.database
            .prepare('SELECT id FROM reference_batches WHERE sha256=? ORDER BY id LIMIT 1')
            .get(order.intent.sourceDigest.slice(2));
          if (!row) throw new Error('ORDER_RECONCILIATION_SOURCE');
          const reference = advanceReferenceEngine(
            createReferenceEngine(terms),
            batches.entry(Number(row.id)).batch,
          );
          const quote = reference.quotes?.find(
            (q) => q.identity === terms[d.inventory.stocks.indexOf(mapping)]!.identity,
          );
          if (
            !quote ||
            quote.priceUsdc !== String(action.args[0]) ||
            quote.observedAt !== String(action.args[1]) ||
            quote.sourceDigest !== String(action.args[2]).toLowerCase()
          )
            throw new Error('ORDER_RECONCILIATION_SOURCE');
          const logs = receipt.logs.filter(
            (l) =>
              l.address === mapping.feed &&
              l.topics[0] === feedInterface.getEvent('ReferenceUpdated')!.topicHash,
          );
          if (
            logs.length !== 1 ||
            logs[0]!.removed ||
            logs[0]!.transactionHash !== hash ||
            logs[0]!.blockHash !== block.hash ||
            logs[0]!.blockNumber !== block.number
          )
            throw new Error('ORDER_RECONCILIATION_FEED');
          const event = feedInterface.parseLog({ topics: [...logs[0]!.topics], data: logs[0]!.data });
          if (
            !event ||
            event.args[0] !== action.args[0] ||
            event.args[1] !== action.args[1] ||
            event.args[2] !== action.args[2]
          )
            throw new Error('ORDER_RECONCILIATION_FEED');
        } else {
          const integration = new TradingVaultContractIntegration(d.inventory);
          const operation = transitionOperation(
            createOperation({
              operationId: order.intent.id,
              chainId: 46630,
              owner: asAddress(tx.from),
              target: d.manifest.contractAddress,
              calldata: tx.data,
              state: 'AWAITING_SIGNATURE',
            }),
            { state: 'SUBMITTED', txHash: hash, submittedAt: new Date(order.intent.createdAt).toISOString() },
          );
          const events = receipt.logs.flatMap((log) => {
            if (log.address !== d.manifest.contractAddress) return [];
            const decoded = decodeTradingEvent(log);
            return decoded ? [{ ...log, ...decoded, chainId: 46630 }] : [];
          });
          if (
            (
              await integration.reconcileOperation({
                rpc,
                manifest: d.manifest,
                block,
                receipt,
                operation,
                events,
              })
            ).status !== 'MATCH'
          )
            throw new Error('ORDER_RECONCILIATION_FILL');
        }
      }
      const canonical = await rpc.block(block.number);
      if (!canonical || canonical.hash !== block.hash) throw new Error('ORDER_RECONCILIATION_REORG');
      const outcome = {
        chainId: 46630,
        transactionHash: hash,
        blockNumber: String(block.number),
        blockHash: block.hash,
        transactionIndex: receipt.transactionIndex,
        status: receipt.status,
        gasUsed: String(receipt.gasUsed),
        effectiveGasPrice: String(receipt.effectiveGasPrice),
        platformGasCostWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
        l2Confirmations: '3',
        l1Finality: 'UNKNOWN',
        scope: 'TESTNET_ONLY',
      };
      const payload = JSON.stringify(outcome);
      orders.recordOutcome(
        order.intent.id,
        receipt.status === 'SUCCESS' ? 'RECONCILED' : 'REVERTED',
        payload,
      );
    }
    if (page.length < 100) cursor = '';
  };
}
