import { randomUUID } from 'node:crypto';
import { marketInterfaces, validateQuoteTransaction } from '../../../../packages/launch-market/src/abi.ts';
import { address, uint } from '../../../../packages/launch-market/src/config.ts';
import {
  LaunchMarketError,
  type MarketAccount,
  type MarketQuote,
  type MarketSnapshot,
  type QuoteRequest,
} from '../../../../packages/launch-market/src/types.ts';
import type { RpcMarketChain } from './rpc-chain.ts';

export async function buildVaultQuote(
  chain: RpcMarketChain,
  request: QuoteRequest,
  account: MarketAccount,
  snapshot: MarketSnapshot,
  expiresAt: number,
): Promise<MarketQuote> {
  const owner = address(request.owner),
    amount = uint(request.amountRaw),
    m = chain.manifest;
  if (request.asset !== 'AF_USDC' || !m.vaultFactory || account.wallet !== owner)
    throw new LaunchMarketError('VAULT_OWNER_MISMATCH', 403);
  const wallet = await chain.wallet(owner);
  const vault = wallet.vaults.find((v) => v.strategyId === request.strategyId && v.status === 'OPEN');
  let data: string,
    target: string,
    output = 0n;
  if (request.operation === 'CREATE_VAULT') {
    if (amount !== 0n || vault) throw new LaunchMarketError('ACTIVE_VAULT_EXISTS');
    target = m.vaultFactory;
    data = marketInterfaces.vaultFactory.encodeFunctionData('createVault', [
      request.strategyId === 'TSLA' ? 0 : 1,
    ]);
  } else {
    if (!vault) throw new LaunchMarketError('VAULT_NOT_CREATED');
    target = vault.address;
    if (request.operation === 'DEPOSIT') {
      if (
        amount === 0n ||
        amount > uint(wallet.usdcBalanceRaw) ||
        amount * 1000000000000n > uint(wallet.passes[request.strategyId].availableRaw)
      )
        throw new LaunchMarketError('INSUFFICIENT_VAULT_CAPACITY');
      data = marketInterfaces.vault.encodeFunctionData('deposit', [amount]);
      output = amount;
    } else if (request.operation === 'WITHDRAW') {
      if (amount === 0n || amount > uint(vault.withdrawablePrincipalRaw) + uint(vault.withdrawableProfitRaw))
        throw new LaunchMarketError('PRINCIPAL_WITHDRAWAL_RESTRICTED');
      data = marketInterfaces.vault.encodeFunctionData('withdraw', [amount]);
      output = amount;
    } else if (request.operation === 'CLOSE') {
      if (amount !== 0n || vault.holdings.length) throw new LaunchMarketError('TRACKED_POSITIONS_OPEN');
      data = marketInterfaces.vault.encodeFunctionData('close', []);
      output = uint(vault.cashRaw);
    } else throw new LaunchMarketError('INVALID_VAULT_OPERATION', 400);
  }
  const transaction = { to: address(target), data, value: '0' };
  const block = await chain.head();
  const deficits = await chain.requiredApprovals(transaction, owner, block);
  const allowance = deficits[0] ?? null;
  const gas = allowance ? null : await chain.simulate(transaction, owner);
  const quote: MarketQuote = {
    id: randomUUID(),
    owner,
    strategyId: request.strategyId,
    operation: request.operation,
    asset: request.asset,
    amountInRaw: request.amountRaw,
    estimatedOutRaw: output.toString(),
    minOutRaw: output.toString(),
    feeUsdcRaw: '0',
    conversionFeeUsdcRaw: '0',
    priceImpactBps: 0,
    expiresAt,
    reference: null,
    transaction,
    allowance,
    gasEstimateRaw: gas,
    simulation: allowance ? 'APPROVAL_REQUIRED' : 'READY',
    location: wallet.location,
  };
  validateQuoteTransaction(quote, m, snapshot, wallet);
  return quote;
}
