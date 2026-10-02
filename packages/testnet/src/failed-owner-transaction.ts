import type { ReadonlyRpc } from '../../chain-adapter/src/rpc.ts';
import type { ChainOperation } from '../../chain-adapter/src/lifecycle.ts';
/** Fresh EOA envelope and canonical soft-confirmation proof; never resubmits the failed transaction. */
export async function verifiedOwnerRevert(rpc: ReadonlyRpc, operation: ChainOperation): Promise<boolean> {
  if (operation.state !== 'REVERTED' || !operation.txHash || !operation.calldata || !rpc.transaction)
    return false;
  if ((await rpc.chainId()) !== 46630) return false;
  const head = await rpc.block('latest'),
    receipt = await rpc.receipt(operation.txHash),
    tx = await rpc.transaction(operation.txHash);
  if (
    !head ||
    !receipt ||
    !tx ||
    receipt.status !== 'REVERTED' ||
    receipt.transactionHash !== operation.txHash ||
    tx.hash !== operation.txHash ||
    tx.chainId !== 46630 ||
    tx.from !== operation.owner ||
    tx.to !== operation.target ||
    tx.value !== 0n ||
    tx.data !== operation.calldata ||
    receipt.from !== tx.from ||
    receipt.to !== tx.to ||
    tx.blockHash !== receipt.blockHash ||
    tx.blockNumber !== receipt.blockNumber ||
    tx.transactionIndex !== receipt.transactionIndex ||
    head.number - receipt.blockNumber + 1n < 3n
  )
    return false;
  const block = await rpc.block(receipt.blockNumber),
    canonicalHead = await rpc.block(head.number);
  return !!block && block.hash === receipt.blockHash && !!canonicalHead && canonicalHead.hash === head.hash;
}
