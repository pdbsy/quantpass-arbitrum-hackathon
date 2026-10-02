import { walletAddress } from './address.ts';
import { tokenInterface, tradingInterface } from './trading-abi.ts';

export interface OwnerActionIdentity {
  readonly owner: string;
  readonly vault: string;
  readonly pass: string;
  readonly usdc: string;
  readonly blockTimestamp: string;
  readonly stocks?: readonly string[];
  readonly stateVersion?: string;
}
const raw = (value: unknown, max = 2n ** 256n - 1n, zero = false): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error();
  const number = BigInt(value);
  if (number > max || (!zero && number === 0n)) throw new Error();
  return number;
};
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw new Error();
  return input as Record<string, unknown>;
}
/** Returns unsigned, zero-value owner calls only. No executor grant is implicit in login. */
export function ownerAction(identity: OwnerActionIdentity, input: unknown) {
  try {
    const v = input as Record<string, unknown>,
      kind = v?.kind;
    let to = walletAddress(identity.vault),
      data: string;
    if (
      ['DEPOSIT', 'WITHDRAW', 'ALLOCATE', 'DEALLOCATE', 'APPROVE_PASS', 'APPROVE_USDC'].includes(String(kind))
    ) {
      fields(v, ['kind', 'amountUsdc']);
      const amount = raw(v.amountUsdc);
      if (kind === 'APPROVE_PASS' || kind === 'APPROVE_USDC') {
        const required = kind === 'APPROVE_PASS' ? amount * 10n ** 12n : amount;
        if (required >= 2n ** 256n) throw new Error();
        to = walletAddress(kind === 'APPROVE_PASS' ? identity.pass : identity.usdc);
        data = tokenInterface.encodeFunctionData('approve', [identity.vault, required]);
      } else data = tradingInterface.encodeFunctionData(String(kind).toLowerCase(), [amount]);
    } else if (['STOP', 'REVOKE', 'CLOSE'].includes(String(kind))) {
      fields(v, ['kind']);
      data = tradingInterface.encodeFunctionData(
        kind === 'REVOKE' ? 'revokeExecutor' : String(kind).toLowerCase(),
      );
    } else if (kind === 'AUTHORIZE') {
      fields(v, [
        'kind',
        'executor',
        'expiresAt',
        'liquidationWindow',
        'maxOrderUsdc',
        'maxTotalBuyUsdc',
        'maxSlippageBps',
      ]);
      const executor = walletAddress(String(v.executor)),
        expiresAt = raw(v.expiresAt, 2n ** 64n - 1n);
      if (
        executor === walletAddress(identity.owner) ||
        executor === walletAddress(identity.vault) ||
        expiresAt <= raw(identity.blockTimestamp, 2n ** 64n - 1n, true)
      )
        throw new Error();
      data = tradingInterface.encodeFunctionData('authorizeExecutor', [
        [
          executor,
          expiresAt,
          raw(v.liquidationWindow, 2n ** 32n - 1n),
          raw(v.maxOrderUsdc),
          raw(v.maxTotalBuyUsdc),
          raw(v.maxSlippageBps, 9999n, true),
        ],
      ]);
    } else if (kind === 'BOUNDS') {
      fields(v, ['kind', 'lowerUnitNav', 'upperUnitNav', 'lowerPrices', 'upperPrices']);
      const lower = raw(v.lowerUnitNav, 2n ** 256n - 1n, true),
        upper = raw(v.upperUnitNav, 2n ** 256n - 1n, true);
      const prices = (value: unknown) => {
        if (!Array.isArray(value) || value.length !== 3) throw new Error();
        return value.map((v) => raw(v, 2n ** 256n - 1n, true));
      };
      const lows = prices(v.lowerPrices),
        highs = prices(v.upperPrices);
      if (
        (lower !== 0n && upper !== 0n && lower >= upper) ||
        lows.some((value, i) => value !== 0n && highs[i] !== 0n && value >= highs[i]!)
      )
        throw new Error();
      data = tradingInterface.encodeFunctionData('setBounds', [lower, upper, lows, highs]);
    } else if (kind === 'RESCUE_TOKEN') {
      fields(v, ['kind', 'token']);
      data = tradingInterface.encodeFunctionData('rescueUntrackedToken', [walletAddress(String(v.token))]);
    } else if (kind === 'RESCUE_NATIVE') {
      fields(v, ['kind']);
      data = tradingInterface.encodeFunctionData('rescueNative');
    } else if (kind === 'RECOVERY_SELL') {
      fields(v, ['kind', 'stock', 'amountRaw', 'minAmountOut', 'deadline']);
      const stock = walletAddress(String(v.stock));
      if (!identity.stocks?.includes(stock) || !identity.stateVersion) throw new Error();
      const deadline = raw(v.deadline, 2n ** 64n - 1n);
      if (deadline < raw(identity.blockTimestamp, 2n ** 64n - 1n, true)) throw new Error();
      data = tradingInterface.encodeFunctionData('execute', [
        [
          stock,
          identity.usdc,
          raw(v.amountRaw),
          raw(v.minAmountOut),
          deadline,
          raw(identity.stateVersion, 2n ** 256n - 1n, true),
        ],
      ]);
    } else throw new Error();
    return Object.freeze({
      from: walletAddress(identity.owner),
      to,
      data,
      value: '0x0',
      chainId: '0xb626',
      kind: String(kind),
    });
  } catch {
    throw new Error('OWNER_ACTION_REJECTED');
  }
}
