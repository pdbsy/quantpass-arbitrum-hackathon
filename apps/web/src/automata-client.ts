import { parseUnits } from '../../../packages/domain/src/money.ts';
import { validateParameters, type Parameters } from '../../../packages/automata/src/model.ts';
export interface ConfigForm {
  weight: string;
  deviation: string;
  seconds: string;
  fee: string;
  slippage: string;
  mode: string;
  upper: string;
  lower: string;
}
const percent = (value: string) => {
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) throw new Error('百分比最多两位小数');
  const result = Number(parseUnits(value.replace(/^-/, ''), 2)) * (value.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(result)) throw new Error('百分比超出范围');
  return result;
};
export function parametersFromForm(form: ConfigForm): Parameters {
  if (!/^[1-9][0-9]*$/.test(form.seconds)) throw new Error('检查间隔必须为整数秒');
  const limits: Parameters['limits'] =
    form.mode === 'off'
      ? { mode: 'off' }
      : form.mode === 'price'
        ? {
            mode: 'price',
            assetId: 'rwa-a',
            ...(form.upper ? { upper: parseUnits(form.upper, 6) } : {}),
            ...(form.lower ? { lower: parseUnits(form.lower, 6) } : {}),
          }
        : {
            mode: 'percent',
            ...(form.upper ? { upperBps: percent(form.upper) } : {}),
            ...(form.lower ? { lowerBps: percent(form.lower) } : {}),
          };
  const result = {
    weights: { 'rwa-a': percent(form.weight) },
    deviationBps: percent(form.deviation),
    intervalMs: Number(form.seconds) * 1000,
    feeBps: percent(form.fee),
    maxSlippageBps: percent(form.slippage),
    limits,
  };
  try {
    validateParameters(result);
  } catch {
    throw new Error('请检查权重、上下限及费用范围；收益上限为正、下限为负，价格上限须高于下限');
  }
  return result;
}
const messages: Record<string, string> = {
  SESSION_REQUIRED: '请先选择测试账户',
  INSUFFICIENT_BOT_CASH: 'Bot 可用现金不足，请降低撤回金额；不会自动卖出持仓',
  INSUFFICIENT_IDLE: '闲置余额不足，请先存入模拟资金',
  ALLOWANCE_EXCEEDED: '追加后超过当前 Pass 运行额度',
  BOT_VAULT_NOT_READY: '该 Vault 已有分配或持仓，请先停止并释放上一轮的结算现金',
  BOT_OWNS_ALLOCATION: '资金由 Bot 管理，请在运行卡片中操作',
  REVISION_CONFLICT: '状态刚刚更新，请刷新后重试',
  INVALID_STATUS: '当前状态不允许此操作',
  REPLAY_COMPLETE: '固定行情回放已结束；可使用最后报价停止并清仓',
  STALE_VALUATION: '持仓缺少有效估值，暂不能变更运行资金',
  BOT_RUN_LIMIT: '本地演示已达到 50 次运行上限',
};
export class SimulationError extends Error {
  readonly definitive: boolean;
  constructor(message: string, definitive: boolean) {
    super(message);
    this.definitive = definitive;
  }
}
export async function requestSimulation<T = unknown>(
  path: string,
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-quantpass-demo': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new SimulationError(
      messages[result.error] ?? '操作未完成，请刷新状态后检查参数',
      response.status < 500,
    );
  return result as T;
}
