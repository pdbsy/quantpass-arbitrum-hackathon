import { Interface, ZeroHash } from 'ethers';
import { address, uint } from './config.ts';
import {
  LaunchMarketError,
  type LaunchMarketManifest,
  type MarketQuote,
  type MarketSnapshot,
  type MarketWalletSnapshot,
} from './types.ts';
import { mintCost } from './math.ts';

export const nativeQuoteTuple =
  '(address router,address payer,bytes32 accountId,uint8 operation,address pass,uint256 amountIn,uint256 usdcAmount,uint256 minOut,uint256 ethAmount,uint256 ethUsdPrice,uint256 nonce,uint64 issuedAt,uint64 deadline,uint64 epoch)';
export const claimVoucherTuple =
  '(bytes32 accountId,address wallet,uint256 nonce,uint64 issuedAt,uint64 deadline,uint64 epoch)';
export const nativeQuoteTypes = {
  NativeQuote: [
    { name: 'router', type: 'address' },
    { name: 'payer', type: 'address' },
    { name: 'accountId', type: 'bytes32' },
    { name: 'operation', type: 'uint8' },
    { name: 'pass', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'usdcAmount', type: 'uint256' },
    { name: 'minOut', type: 'uint256' },
    { name: 'ethAmount', type: 'uint256' },
    { name: 'ethUsdPrice', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
    { name: 'epoch', type: 'uint64' },
  ],
};
export const claimVoucherTypes = {
  ClaimVoucher: [
    { name: 'accountId', type: 'bytes32' },
    { name: 'wallet', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
    { name: 'epoch', type: 'uint64' },
  ],
};
export const marketInterfaces = {
  launch: new Interface([
    'function subscribeUsdc(uint256 passAmount,uint64 deadline)',
    `function subscribeEth(uint256 passAmount,${nativeQuoteTuple} q,bytes signature) payable`,
  ]),
  router: new Interface([
    `function buyNative(${nativeQuoteTuple} q,bytes signature) payable`,
    `function sellNative(${nativeQuoteTuple} q,bytes signature)`,
  ]),
  pool: new Interface([
    'function buy(uint256 usdcIn,uint256 minPass,address recipient,uint64 deadline)',
    'function sell(uint256 passIn,uint256 minUsdc,address recipient,uint64 deadline)',
  ]),
  claim: new Interface([`function claim(${claimVoucherTuple} voucher,bytes signature)`]),
  vaultFactory: new Interface(['function createVault(uint8 strategyIndex) returns(address)']),
  vault: new Interface([
    'function deposit(uint256 usdcAmount)',
    'function withdraw(uint256 usdcAmount)',
    'function close()',
  ]),
};
/** Wallet-side verification binds all displayed constraints to allowlisted calldata, not just its selector. */
export function validateQuoteTransaction(
  quote: MarketQuote,
  manifest: LaunchMarketManifest,
  snapshot?: MarketSnapshot,
  wallet?: MarketWalletSnapshot,
): void {
  const owner = address(quote.owner),
    strategy = manifest.strategies[quote.strategyId],
    target = address(quote.transaction.to);
  const same = (a: unknown, b: string) => address(String(a)) === address(b);
  const eq = (a: unknown, b: string) => BigInt(String(a)) === uint(b);
  const reject = () => {
    throw new LaunchMarketError('QUOTE_TRANSACTION_MISMATCH', 400);
  };
  if (quote.location.chainId !== manifest.chainId || quote.expiresAt <= 0) reject();
  let parsed;
  if (quote.operation === 'CREATE_VAULT') {
    if (
      !manifest.vaultFactory ||
      target !== address(manifest.vaultFactory) ||
      quote.asset !== 'AF_USDC' ||
      uint(quote.amountInRaw) !== 0n ||
      uint(quote.transaction.value) !== 0n ||
      quote.allowance !== null
    )
      reject();
    parsed = marketInterfaces.vaultFactory.parseTransaction({ data: quote.transaction.data });
    if (
      !parsed ||
      parsed.name !== 'createVault' ||
      Number(parsed.args[0]) !== (quote.strategyId === 'TSLA' ? 0 : 1)
    )
      reject();
  } else if (['DEPOSIT', 'WITHDRAW', 'CLOSE'].includes(quote.operation)) {
    const vault = wallet?.vaults.find(
      (v) => v.strategyId === quote.strategyId && address(v.address) === target,
    );
    if (
      !vault ||
      wallet?.owner.toLowerCase() !== owner ||
      quote.asset !== 'AF_USDC' ||
      uint(quote.transaction.value) !== 0n
    )
      reject();
    parsed = marketInterfaces.vault.parseTransaction({ data: quote.transaction.data });
    const name =
      quote.operation === 'DEPOSIT' ? 'deposit' : quote.operation === 'WITHDRAW' ? 'withdraw' : 'close';
    if (!parsed || parsed.name !== name) return reject();
    if (name !== 'close' && !eq(parsed.args[0], quote.amountInRaw)) reject();
    if (name === 'close' && (uint(quote.amountInRaw) !== 0n || quote.allowance !== null)) reject();
    if (name === 'withdraw' && quote.allowance !== null) reject();
  } else if (quote.operation === 'CLAIM') {
    if (
      target !== address(manifest.claim) ||
      uint(quote.transaction.value) !== 0n ||
      quote.allowance !== null
    )
      reject();
    parsed = marketInterfaces.claim.parseTransaction({ data: quote.transaction.data });
    if (!parsed || parsed.name !== 'claim') return reject();
    const v = parsed.args[0];
    if (
      !same(v.wallet, owner) ||
      v.accountId === ZeroHash ||
      Number(v.deadline) !== quote.expiresAt ||
      Number(v.deadline) - Number(v.issuedAt) > 60
    )
      reject();
  } else if (quote.asset === 'ETH') {
    const iface = quote.operation === 'MINT' ? marketInterfaces.launch : marketInterfaces.router;
    const expectedTarget = quote.operation === 'MINT' ? strategy.launch : manifest.router;
    if (!expectedTarget || target !== address(expectedTarget)) reject();
    parsed = iface.parseTransaction({ data: quote.transaction.data });
    const expectedName =
      quote.operation === 'MINT' ? 'subscribeEth' : quote.operation === 'BUY' ? 'buyNative' : 'sellNative';
    if (!parsed || parsed.name !== expectedName) return reject();
    const q = parsed.args[quote.operation === 'MINT' ? 1 : 0];
    if (
      !same(q.payer, owner) ||
      !same(q.pass, strategy.pass) ||
      !same(q.router, expectedTarget!) ||
      q.accountId === ZeroHash ||
      Number(q.operation) !== ['MINT', 'BUY', 'SELL'].indexOf(quote.operation) ||
      Number(q.deadline) !== quote.expiresAt
    )
      reject();
    if (
      !quote.reference ||
      !eq(q.ethUsdPrice, quote.reference.ethUsdPriceRaw) ||
      Number(q.issuedAt) > Number(q.deadline) ||
      Number(q.deadline) - Number(q.issuedAt) > 60 ||
      BigInt(q.nonce) < 0n ||
      BigInt(q.epoch) <= 0n
    )
      reject();
    if (quote.operation === 'MINT') {
      if (
        !eq(parsed.args[0], quote.amountInRaw) ||
        !eq(q.minOut, quote.minOutRaw) ||
        quote.minOutRaw !== quote.estimatedOutRaw ||
        quote.estimatedOutRaw !== quote.amountInRaw ||
        BigInt(q.usdcAmount) !== mintCost(uint(quote.amountInRaw)) ||
        !eq(q.ethAmount, quote.transaction.value) ||
        !eq(q.amountIn, quote.transaction.value) ||
        quote.allowance !== null
      )
        reject();
    } else if (quote.operation === 'BUY') {
      if (
        !eq(q.minOut, quote.minOutRaw) ||
        !eq(q.amountIn, quote.amountInRaw) ||
        !eq(q.ethAmount, quote.amountInRaw) ||
        !eq(q.ethAmount, quote.transaction.value) ||
        quote.allowance !== null
      )
        reject();
    } else if (
      !eq(q.minOut, quote.minOutRaw) ||
      !eq(q.amountIn, quote.amountInRaw) ||
      !eq(q.ethAmount, quote.estimatedOutRaw) ||
      uint(quote.transaction.value) !== 0n
    )
      reject();
  } else if (quote.operation === 'MINT') {
    if (!strategy.launch || target !== address(strategy.launch) || uint(quote.transaction.value) !== 0n)
      reject();
    parsed = marketInterfaces.launch.parseTransaction({ data: quote.transaction.data });
    if (
      !parsed ||
      parsed.name !== 'subscribeUsdc' ||
      !eq(parsed.args[0], quote.amountInRaw) ||
      Number(parsed.args[1]) !== quote.expiresAt ||
      quote.estimatedOutRaw !== quote.amountInRaw ||
      quote.minOutRaw !== quote.amountInRaw
    )
      reject();
  } else {
    const pool = snapshot?.markets[quote.strategyId].pool ?? strategy.pool;
    if (!pool || target !== address(pool) || uint(quote.transaction.value) !== 0n) reject();
    parsed = marketInterfaces.pool.parseTransaction({ data: quote.transaction.data });
    const name = quote.operation === 'BUY' ? 'buy' : 'sell';
    if (
      !parsed ||
      parsed.name !== name ||
      !eq(parsed.args[0], quote.amountInRaw) ||
      !eq(parsed.args[1], quote.minOutRaw) ||
      !same(parsed.args[2], owner) ||
      Number(parsed.args[3]) !== quote.expiresAt
    )
      reject();
  }
  if (quote.allowance) {
    const token = quote.operation === 'SELL' ? strategy.pass : manifest.usdc;
    const required = quote.operation === 'MINT' ? mintCost(uint(quote.amountInRaw)) : uint(quote.amountInRaw);
    if (quote.operation === 'DEPOSIT') {
      const isPass = address(quote.allowance.token) === address(strategy.pass);
      if (
        (!isPass && address(quote.allowance.token) !== address(manifest.usdc)) ||
        uint(quote.allowance.amountRaw) !== (isPass ? required * 10n ** 12n : required)
      )
        reject();
    } else if (
      address(quote.allowance.token) !== address(token) ||
      uint(quote.allowance.amountRaw) !== required
    )
      reject();
    if (address(quote.allowance.spender) !== target || uint(quote.allowance.amountRaw) === 0n) reject();
  }
}
