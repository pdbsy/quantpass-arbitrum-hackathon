import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { registerSimulationTools } from './webmcp.ts';
import { commandMessage } from './command-message.ts';
import { api, ApiError, type Vault, type Audit } from './api.ts';
import { parseUnits, formatUnits } from '../../../packages/domain/src/money.ts';

type Draft = { owner: string; vaultId: string; command: Record<string, unknown> };
const draftKey = 'quantpass.local.pending-command.v1';
const statusText = { stopped: '已停止', running: '运行中', stopping: '等待结算后停止' };
const names: Record<string, string> = {
  deposit: '模拟存入',
  allocate: '分配额度',
  deallocate: '释放资金',
  requestWithdrawal: '申请取出',
  confirmWithdrawal: '模拟到账',
  cancelWithdrawal: '撤销取出',
  start: '启动',
  stop: '停止',
  reserveBuy: '模拟挂单',
  fillBuy: '模拟成交',
  cancelOrder: '撤销挂单',
  markPosition: '模拟估值',
  settlePosition: '模拟卖出结算',
};
const errors: Record<string, string> = {
  SESSION_REQUIRED: '会话已结束，请重新选择测试身份。',
  REVISION_CONFLICT: '账本已更新。请刷新核对后重新提交。',
  ALLOWANCE_EXCEEDED: '分配将超过 Pass 额度。多存的余额可以留在空闲区。',
  INSUFFICIENT_IDLE: '空闲余额不足。',
  INSUFFICIENT_ACTIVE_CASH: '可用策略现金不足，挂单或持仓中的资金不能直接取出。',
  INVALID_REQUEST: '输入不符合要求，请检查金额和操作。',
};
function money(value = '0') {
  return formatUnits(value, 6).replace(/\.?0+$/, '');
}
function readDraft(): Draft | null {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey) || 'null') as Draft | null;
    return value &&
      typeof value.owner === 'string' &&
      typeof value.vaultId === 'string' &&
      typeof value.command?.id === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}
function AmountForm({
  label,
  initial,
  disabled,
  submit,
}: {
  label: string;
  initial: string;
  disabled: boolean;
  submit: (amount: string) => void;
}) {
  const [amount, setAmount] = useState(initial);
  function send(event: FormEvent) {
    event.preventDefault();
    if (!/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/.test(amount) || BigInt(parseUnits(amount, 6)) <= 0n) return;
    submit(parseUnits(amount, 6).toString());
  }
  return (
    <form onSubmit={send}>
      <label>
        {label}
        <span className="input-row">
          <input
            aria-label={`${label}金额`}
            inputMode="decimal"
            required
            pattern="(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled}
          />
          <span>模拟 USDT</span>
        </span>
      </label>
      <button disabled={disabled}>{label}</button>
    </form>
  );
}

export function App() {
  const [user, setUser] = useState<string | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('正在读取本地账本…');
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(readDraft);
  const lock = useRef(false);

  async function refresh() {
    const identity = await api<{ user: string }>('/session');
    const states = await api<Vault[]>('/vaults');
    const state = states[0] || null;
    const events = state ? await api<Audit[]>(`/vaults/${state.id}/audit`) : [];
    flushSync(() => {
      setUser(identity.user);
      setVault(state);
      setAudit(events);
    });
    return { scope: 'TEST_ONLY', user: identity.user, vault: state };
  }
  async function claimPasses() {
    if (readDraft()) throw new Error('CONFIRM_PENDING_REQUEST_FIRST');
    const next = await api<Vault>('/vaults', { strategyId: 'core-flow-demo' });
    await refresh();
    flushSync(() => setMessage('已获得 1,000 测试 Pass。使用权不是资金，重复领取不会增加额度或重置余额。'));
    return { scope: 'TEST_ONLY', vaultId: next.id, passes: next.passes };
  }
  useEffect(
    () =>
      registerSimulationTools({
        read: refresh,
        claim: async () => {
          if (lock.current) throw new Error('BUSY');
          lock.current = true;
          setBusy(true);
          try {
            return await claimPasses();
          } catch (error) {
            report(error);
            throw error;
          } finally {
            lock.current = false;
            flushSync(() => setBusy(false));
          }
        },
      }),
    [],
  );
  function report(error: unknown) {
    setFailed(true);
    if (error instanceof ApiError) {
      setMessage(errors[error.message] || `操作未完成：${error.message}`);
      if (error.status === 401) {
        setUser(null);
        setVault(null);
        setAudit([]);
      }
    } else setMessage('无法确认请求结果。请检查本地服务；若有待确认操作，使用原请求重试，不要重复新建。');
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void refresh()
      .then(() => {
        if (active) setMessage('已载入 SQLite 持久账本。');
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401)
          setMessage('先选择一个测试身份，开始验证资金流程。');
        else report(error);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function selectIdentity(next: string) {
    await api('/demo/session', { user: next });
    await refresh();
    setMessage(`已切换为 ${next}。这是可自由切换的测试身份，不是真实登录。`);
  }
  function saveDraft(value: Draft | null) {
    // A device-local retry envelope only; balances always come from the API.
    if (value) localStorage.setItem(draftKey, JSON.stringify(value));
    else localStorage.removeItem(draftKey);
    setDraft(value);
  }
  async function sendDraft(value: Draft) {
    try {
      const result = await api<{ vault: Vault; replayed: boolean }>(
        `/vaults/${value.vaultId}/commands`,
        value.command,
      );
      setVault(result.vault);
      saveDraft(null);
      setMessage(
        commandMessage({
          type: String(value.command.type),
          label: names[String(value.command.type)] || '操作',
          status: result.vault.status,
          revision: result.vault.revision,
          replayed: result.replayed,
        }),
      );
      setAudit(await api<Audit[]>(`/vaults/${value.vaultId}/audit`));
    } catch (error) {
      // 5xx / timeout may have committed. Keep the exact ID and payload until confirmed.
      if (error instanceof ApiError && [400, 409, 413, 415].includes(error.status)) saveDraft(null);
      throw error;
    }
  }
  function command(type: string, fields: Record<string, string> = {}) {
    if (!vault || !user || draft) return;
    void run(async () => {
      const value = {
        owner: user,
        vaultId: vault.id,
        command: { id: crypto.randomUUID(), expectedRevision: vault.revision, type, ...fields },
      };
      saveDraft(value);
      await sendDraft(value);
    });
  }
  const disabled = busy || !vault || !!draft;
  return (
    <>
      <div className="safety-strip">LOCAL SIMULATION · 不连接钱包、不提交链上交易、不使用真实资金</div>
      <header className="topbar">
        <a className="brand" href="/" aria-label="AlphaForge 首页">
          <span className="brand-mark">A</span>AlphaForge
          <span className="brand-sub">Hackathon · 资金工作台</span>
        </a>
        <div className="identity">
          <label htmlFor="identity">测试身份</label>
          <select
            id="identity"
            value={user || ''}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) void run(() => selectIdentity(e.target.value));
            }}
          >
            <option value="">选择身份</option>
            <option value="alice">Alice</option>
            <option value="bob">Bob</option>
          </select>
          <button
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await refresh();
                setMessage('已刷新账本。');
              })
            }
          >
            刷新
          </button>
        </div>
      </header>
      <main>
        <section className="page-heading">
          <div>
            <p className="eyebrow">ROBINHOOD CHAIN TESTNET / 本地演示</p>
            <h1>策略使用权与资金，分开管理。</h1>
            <p>1 Pass = 1 模拟 USDT 分配额度。多存的余额不参与策略，也不自动补亏损。</p>
          </div>
          <span className="stage">仅固定样例 · 无真实收益</span>
        </section>
        <div role="status" aria-live="polite" className={`notice ${failed ? 'error' : ''}`}>
          {message}
        </div>
        {draft && (
          <section className="retry" aria-label="待确认请求">
            <div>
              <strong>有一笔待确认操作：{names[String(draft.command.type)] || '未知操作'}</strong>
              <p>所属身份 {draft.owner}。原请求保存在当前设备，只用于安全重试。确认前暂停新操作。</p>
            </div>
            <button disabled={busy || user !== draft.owner} onClick={() => void run(() => sendDraft(draft))}>
              用原请求核对 / 重试
            </button>
          </section>
        )}
        <div className="workspace">
          <aside className="strategy-card">
            <p className="eyebrow">策略样例 01</p>
            <div className="strategy-icon" aria-hidden="true">
              QP
            </div>
            <h2>核心资金流程</h2>
            <p>用于验证购买使用权、独立余额和策略分配的最小样例，不提供投资服务。</p>
            <dl>
              <div>
                <dt>使用权性质</dt>
                <dd>永久 SaaS 额度</dd>
              </div>
              <div>
                <dt>样例额度</dt>
                <dd>1,000 Pass</dd>
              </div>
              <div>
                <dt>正式 Pass 价格</dt>
                <dd>待定 · 不售卖</dd>
              </div>
              <div>
                <dt>执行环境</dt>
                <dd>本机模拟器</dd>
              </div>
              <div>
                <dt>运行状态</dt>
                <dd>{vault ? statusText[vault.status] : '尚未建立账本'}</dd>
              </div>
            </dl>
            {!user ? (
              <button disabled={busy} onClick={() => void run(() => selectIdentity('alice'))}>
                以 Alice 开始测试
              </button>
            ) : !vault ? (
              <button
                disabled={busy || !!draft}
                onClick={() =>
                  void run(async () => {
                    await claimPasses();
                  })
                }
              >
                获得 1,000 测试 Pass
              </button>
            ) : (
              <div className="button-row">
                <button disabled={disabled || vault.status !== 'stopped'} onClick={() => command('start')}>
                  启动样例
                </button>
                <button
                  className="secondary"
                  disabled={disabled || vault.status === 'stopped'}
                  onClick={() => command('stop')}
                >
                  停止
                </button>
              </div>
            )}
            <p className="fine">没有购买扣款。演示不确定价、不发行真实代币，不代表正式平台开放。</p>
          </aside>
          <div className="ledger">
            <section className="balances" aria-label="账本余额">
              <article>
                <span>已持有使用权</span>
                <strong>
                  {vault?.passes || '0'} <small>Pass</small>
                </strong>
                <p>不是基金份额或账户资产</p>
              </article>
              <article>
                <span>参与策略净额</span>
                <strong>
                  {money(vault?.balances.activeNet)} <small>模拟 USDT</small>
                </strong>
                <p>额度 {money(vault?.balances.allowance)} · 浮盈不强制卖出</p>
              </article>
              <article className="idle">
                <span>空闲余额</span>
                <strong>
                  {money(vault?.idle)} <small>模拟 USDT</small>
                </strong>
                <p>不参与策略 · 可申请取出</p>
              </article>
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>资金操作</h2>
                <span>先存入 → 分配 → 独立取出</span>
              </div>
              <div className="forms">
                <AmountForm
                  label="模拟存入"
                  initial="1500"
                  disabled={disabled}
                  submit={(amount) => command('deposit', { amount })}
                />
                <AmountForm
                  label="分配到策略"
                  initial="1000"
                  disabled={disabled}
                  submit={(amount) => command('allocate', { amount })}
                />
                <AmountForm
                  label="取出空闲余额"
                  initial="500"
                  disabled={disabled}
                  submit={(amount) => command('requestWithdrawal', { amount })}
                />
              </div>
              <p className="fine">
                取出请求先进入待确认区；只有模拟确认到账后才计入已取出。金额最多 6 位小数。
              </p>
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>资金去向</h2>
                <span>账本版本 {vault?.revision ?? '—'}</span>
              </div>
              <dl className="flow-grid">
                <div>
                  <dt>策略可用现金</dt>
                  <dd>{money(vault?.activeCash)}</dd>
                </div>
                <div>
                  <dt>挂单预占</dt>
                  <dd>{money(vault?.balances.reserved)}</dd>
                </div>
                <div>
                  <dt>持仓估值</dt>
                  <dd>{money(vault?.positionValue)}</dd>
                </div>
                <div>
                  <dt>待确认取出</dt>
                  <dd>{money(vault?.balances.pending)}</dd>
                </div>
                <div>
                  <dt>累计已取出</dt>
                  <dd>{money(vault?.withdrawalsPaid)}</dd>
                </div>
                <div>
                  <dt>待支付费用</dt>
                  <dd>{money(vault?.feeLiability)}</dd>
                </div>
              </dl>
              {Object.entries(vault?.pendingWithdrawals || {}).map(([id, amount]) => (
                <div className="pending-row" key={id}>
                  <span>
                    取出 {money(amount)} <small>模拟 USDT</small>
                  </span>
                  <div className="button-row">
                    <button
                      disabled={disabled}
                      onClick={() => command('confirmWithdrawal', { withdrawalId: id })}
                    >
                      模拟确认到账
                    </button>
                    <button
                      className="quiet"
                      disabled={disabled}
                      onClick={() => command('cancelWithdrawal', { withdrawalId: id })}
                    >
                      撤销
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>
        <details className="panel simulator">
          <summary>
            展开成交模拟器 <span>用于验收浮盈、结算与停止流程</span>
          </summary>
          <p>
            所有价格均由你手动输入，无行情源。结算使用零费率测试夹具；容量缓冲、正式费率仍待决，不能据此上线。
          </p>
          <div className="forms">
            <AmountForm
              label="模拟买入挂单"
              initial="1000"
              disabled={disabled || vault?.status !== 'running'}
              submit={(amount) => command('reserveBuy', { amount, orderId: crypto.randomUUID() })}
            />
            <AmountForm
              label="设置持仓估值"
              initial="1100"
              disabled={disabled}
              submit={(value) => command('markPosition', { value })}
            />
            <AmountForm
              label="全部卖出结算"
              initial="1100"
              disabled={disabled}
              submit={(proceeds) => command('settlePosition', { proceeds })}
            />
            <AmountForm
              label="释放策略现金"
              initial="1000"
              disabled={disabled}
              submit={(amount) => command('deallocate', { amount })}
            />
          </div>
          {Object.entries(vault?.orders || {}).map(([id, amount]) => (
            <div className="pending-row" key={id}>
              <span>挂单 {money(amount)} 模拟 USDT</span>
              <div className="button-row">
                <button disabled={disabled} onClick={() => command('fillBuy', { orderId: id })}>
                  模拟成交
                </button>
                <button
                  className="quiet"
                  disabled={disabled}
                  onClick={() => command('cancelOrder', { orderId: id })}
                >
                  撤单
                </button>
              </div>
            </div>
          ))}
        </details>
        <section className="panel audit">
          <div className="section-heading">
            <h2>操作记录</h2>
            <span>当前身份 · 最近 100 条</span>
          </div>
          {audit.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>操作</th>
                    <th>执行者</th>
                    <th>本地时间</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row) => (
                    <tr key={row.revision}>
                      <td>{row.revision}</td>
                      <td>{names[row.command_type] || row.command_type}</td>
                      <td>{row.actor_id}</td>
                      <td>{new Date(row.recorded_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">还没有资金操作。获得测试 Pass 后，可按上方流程存入、分配并取出。</p>
          )}
        </section>
        <footer>
          AlphaForge · 本地 SQLite 持久化 · 测试身份不构成真实认证 · 刷新页面不会重置账本
          <a href="/task-board.html">查看工程安全看板</a>
        </footer>
      </main>
    </>
  );
}
