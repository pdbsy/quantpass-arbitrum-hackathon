import type { PaperServiceView } from '../../../packages/automata/src/reference-paper-service.ts';
import type { PaperControl, PaperHistory } from '../../../packages/automata/src/reference-paper-journal.ts';
type Action = PaperControl['action'];
export function fundingAmount6(input: string): string {
  if (!/^(0|[1-9][0-9]{0,71})(\.[0-9]{1,6})?$/.test(input)) throw new Error('金额最多支持 6 位小数');
  const [whole, fraction = ''] = input.split('.');
  const value = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (value <= 0n || value > (1n << 256n) - 1n) throw new Error('请输入有效的正金额');
  return value.toString();
}
export function formatPaperAmount(input: string | null | undefined, decimals: number): string {
  if (input === null || input === undefined) return '—';
  const n = BigInt(input),
    sign = n < 0n ? '-' : '',
    abs = n < 0n ? -n : n,
    scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return sign + whole + (fraction ? '.' + fraction : '');
}
export function returnPercent(value: { numerator: string; denominator: string } | null): string {
  if (!value) return '—';
  const n = BigInt(value.numerator),
    d = BigInt(value.denominator);
  if (d <= 0n) return '—';
  const hundredths = ((n - d) * 10000n) / d;
  return (
    (hundredths < 0n ? '-' : '') +
    (hundredths < 0n ? -hundredths : hundredths) / 100n +
    '.' +
    ((hundredths < 0n ? -hundredths : hundredths) % 100n).toString().padStart(2, '0') +
    '%'
  );
}
export function paperChartPoints(items: PaperHistory['items']): { at: number; value: number | null }[] {
  const points: { at: number; value: number | null }[] = [];
  for (const row of [...items].reverse())
    for (const e of row.events) {
      if (e.kind === 'REFERENCE_REJECTED' || e.kind === 'GAP')
        points.push({ at: (e.at ?? e.until) as number, value: null });
      if (e.kind === 'NAV') {
        const v = e.unitValue as { numerator: string; denominator: string } | null;
        const scaled = v
          ? ((BigInt(v.numerator) - BigInt(v.denominator)) * 1000000n) / BigInt(v.denominator)
          : null;
        const value =
          scaled !== null &&
          scaled <= BigInt(Number.MAX_SAFE_INTEGER) &&
          scaled >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(scaled) / 10000
            : null;
        points.push({ at: e.at as number, value });
      }
    }
  return points;
}
export class PaperApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, maxWithdraw6?: string) {
    const messages: Record<string, string> = {
      PAPER_REVISION_CONFLICT: '行情刚刚更新，这次操作没有执行。请按最新状态重试。',
      PAPER_CONTROL_CONFLICT: '该请求编号已有不同操作，请检查待确认请求。',
      INSUFFICIENT_CASH:
        '可用现金不足，最多可撤回 ' +
        formatPaperAmount(maxWithdraw6, 6) +
        ' 虚拟 AF-USDC；不会自动卖出持仓。',
      STALE_PAPER_VALUATION: '持仓缺少有效行情，暂不能变更运行资金。',
      PAPER_NOT_RUNNING: '运行已停止，不能追加资金。',
      PAPER_STORAGE_LIMIT: '存储达到预留上限，这次操作没有执行。',
      PAPER_NOT_READY: '正在等待第一轮行情记录。',
      PAPER_BACKUP_BUSY: '已有备份正在复验，请稍后再创建新的备份。',
      PAPER_BACKUP_CANCELLED_FOR_STOP: '停止请求已优先记录，本次备份已取消，可稍后重新备份。',
      SESSION_REQUIRED: '请重新进入测试账户。',
      PAPER_NOT_FOUND: '这个测试账户没有此研究运行的访问权限。',
    };
    super(messages[code] ?? '操作未确认（' + code + '）。请刷新状态；传输失败时可重试原请求。');
    this.status = status;
    this.code = code;
  }
}
export async function paperRequest<T>(
  path: string,
  body?: unknown,
  transport: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000)
    throw new Error('页面请求时限异常');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('页面请求超时，原操作结果尚未确认，请重试原请求。'));
    }, timeoutMs);
  });
  const request = async (): Promise<T> => {
    const response = await transport(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-quantpass-demo': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('页面响应超出范围');
    const data = JSON.parse(text) as { error?: { code?: string }; maxWithdraw6?: string };
    if (!response.ok)
      throw new PaperApiError(response.status, data.error?.code ?? 'REQUEST_FAILED', data.maxWithdraw6);
    return data as T;
  };
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
export async function readPaperView(): Promise<PaperServiceView> {
  const view = await paperRequest<PaperServiceView>('/api/v1/reference-paper');
  if (
    view.mode !== 'REFERENCE_PAPER' ||
    !['OFFICIAL_REFERENCE', 'OFFLINE_FIXTURE'].includes(view.sourceMode) ||
    !view.accountId ||
    !Number.isSafeInteger(view.revision) ||
    !view.account?.config ||
    !view.history?.items
  )
    throw new Error('研究账户状态格式异常');
  return view;
}
type Pending = { kind: 'control'; body: PaperControl } | { kind: 'backup'; body: { id: string } };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Store before network I/O; unknown results keep the original ID, revision and body. */
export class PaperOutbox {
  readonly #storage: StoragePort;
  readonly #key: string;
  readonly #transport: typeof fetch;
  readonly #id: () => string;
  constructor(
    storage: StoragePort,
    scope: string,
    transport: typeof fetch = fetch,
    id: () => string = () => crypto.randomUUID(),
  ) {
    this.#storage = storage;
    this.#key = 'alphaforge-paper-outbox-1:' + scope;
    this.#transport = transport;
    this.#id = id;
  }
  pending(): Pending | null {
    const text = this.#storage.getItem(this.#key);
    if (!text) return null;
    if (text.length > 4096) throw new Error('待确认请求超出范围');
    const p = JSON.parse(text) as Pending;
    if (
      !['control', 'backup'].includes(p.kind) ||
      !p.body ||
      typeof p.body.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(p.body.id)
    )
      throw new Error('待确认请求格式异常');
    return p;
  }
  send(action: Action, expectedRevision: number): Promise<unknown> {
    if (this.pending()) throw new Error('请先确认上一笔请求');
    const pending: Pending = { kind: 'control', body: { id: this.#id(), expectedRevision, action } };
    this.#storage.setItem(this.#key, JSON.stringify(pending));
    return this.retry();
  }
  backup(): Promise<unknown> {
    if (this.pending()) throw new Error('请先确认上一笔请求');
    this.#storage.setItem(this.#key, JSON.stringify({ kind: 'backup', body: { id: this.#id() } }));
    return this.retry();
  }
  async retry(): Promise<unknown> {
    const pending = this.pending();
    if (!pending) throw new Error('没有待确认请求');
    try {
      const result = await paperRequest(
        '/api/v1/reference-paper/' + (pending.kind === 'control' ? 'controls' : 'backups'),
        pending.body,
        this.#transport,
      );
      this.#storage.removeItem(this.#key);
      return result;
    } catch (error) {
      if (error instanceof PaperApiError && [400, 409].includes(error.status))
        this.#storage.removeItem(this.#key);
      throw error;
    }
  }
}
