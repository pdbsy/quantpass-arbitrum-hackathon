import { useEffect, useRef, useState } from 'react';
import {
  parametersFromForm,
  externalDecisionFromJson,
  type ExternalStrategyContext,
  requestSimulation as request,
  SimulationError,
  type ConfigForm,
} from './automata-client.ts';
import { formatUnits, parseUnits } from '../../../packages/domain/src/money.ts';
import type { passAccounting } from '../../../packages/domain/src/vault.ts';
import type { AutomataStore } from '../../server/src/automata-store.ts';
type RunView = ReturnType<AutomataStore['get']> & { runtimeError?: string | null };
interface Vault {
  passAccounting?: NonNullable<ReturnType<typeof passAccounting>>;
  pendingWithdrawals: Record<string, string>;
  withdrawalsPaid: string;
  id: string;
  revision: number;
  idle: string;
  activeCash: string;
  status: string;
  strategyId: string;
  passes: string;
}
interface Pending {
  owner: string;
  path: string;
  body: unknown;
}
const key = 'alphaforge-automata-pending-v1';
function readPending(): Pending | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
const money = (value: string) => formatUnits(value, 6).replace(/0+$/, '').replace(/\.$/, '');
const passMoney = (value: string) => formatUnits(value, 18).replace(/0+$/, '').replace(/\.$/, '');
const states = {
  running: '运行中',
  paused: '策略暂停 · 风控仍监控',
  liquidating: '清仓中',
  blocked: '清仓受阻',
  stopped: '已停止',
};
const triggerNames = { manual: '手动停止', upper: '触碰上限', lower: '触碰下限' };
function Curve({ run }: { run: RunView }) {
  const values = [0, ...run.state.history.map((h) => h.returnBps)];
  const low = Math.min(-1, ...values),
    high = Math.max(1, ...values);
  const points = values
    .map(
      (v, i) => `${12 + (i / Math.max(1, values.length - 1)) * 576},${98 - ((v - low) / (high - low)) * 80}`,
    )
    .join(' ');
  return (
    <figure className="af-curve">
      <figcaption>
        单位净值 · 资金进出已调整 <span>{(1 + run.returnBps / 10000).toFixed(4)}</span>
      </figcaption>
      <svg viewBox="0 0 600 112" role="img" aria-label="单位净值历史曲线">
        <line x1="12" x2="588" y1="98" y2="98" className="af-axis" />
        <polyline points={points} className="af-line" />
      </svg>
      <small>本次运行基准 1.0000 · 合成行情，不代表真实策略业绩</small>
    </figure>
  );
}
export function Automata() {
  const [owner, setOwner] = useState('');
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('请选择本地测试账户。');
  const [pending, setPending] = useState<Pending | null>(readPending);
  const [vaultAmount, setVaultAmount] = useState('100');
  const [capital, setCapital] = useState('500');
  const [transfer, setTransfer] = useState('100');
  const [dataset, setDataset] = useState('trend');
  const [form, setForm] = useState<ConfigForm>({
    weight: '50',
    weightB: '0',
    strategyMode: 'rebalance',
    priceAsset: 'rwa-a',
    deviation: '1',
    seconds: '5',
    fee: '0.1',
    slippage: '1',
    mode: 'percent',
    upper: '10',
    lower: '-5',
  });
  const [externalJson, setExternalJson] = useState<Record<string, string>>({});
  const [decisionDraft, setDecisionDraft] = useState<{
    owner: string;
    runId: string;
    body: ReturnType<typeof externalDecisionFromJson>;
  } | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const vault = vaults.find((v) => v.strategyId === 'core-flow-demo');
  function savePending(value: Pending | null) {
    setPending(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      /* Keep the current tab's pending request available. */
    }
  }
  async function refresh() {
    const epoch = ++generation.current;
    const identity = await request<{ user: string }>('/api/session');
    const [account, list] = await Promise.all([
      request<{ items: Vault[] }>('/api/v1/vaults'),
      request<{ items: RunView[] }>('/api/v1/automata'),
    ]);
    if (epoch !== generation.current) return;
    if (owner && owner !== identity.user) setDecisionDraft(null);
    setOwner(identity.user);
    setMessage((current) =>
      current.startsWith('请选择') || current.startsWith('请先选择')
        ? '本地账户已连接，运行记录已恢复。'
        : current,
    );
    setVaults(account.items);
    setRuns(list.items);
  }
  useEffect(() => {
    let live = true;
    const update = () => {
      if (live && !lock.current)
        void refresh().catch(() => {
          if (live) setMessage('请先选择测试账户，或检查本地服务是否可用。');
        });
    };
    update();
    const timer = setInterval(update, 2000);
    return () => {
      live = false;
      generation.current++;
      clearInterval(timer);
    };
  }, []);
  async function perform(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    generation.current++;
    try {
      await fn();
      await refresh();
      setMessage('操作已确认，状态已更新。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未完成');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function mutate(path: string, body: unknown) {
    const value = { owner, path, body };
    savePending(value);
    try {
      await request(path, body);
      savePending(null);
    } catch (error) {
      if (error instanceof SimulationError && error.definitive) savePending(null);
      throw error;
    }
  }
  async function action(run: RunView, fields: Record<string, unknown>) {
    const current = await request<RunView>(`/api/v1/automata/${run.state.id}`);
    await mutate(`/api/v1/automata/${run.state.id}/actions`, {
      id: crypto.randomUUID(),
      expectedRevision: current.revision,
      ...fields,
    });
  }
  async function vaultCommand(fields: Record<string, unknown>) {
    if (!vault) return;
    const current = await request<Vault>(`/api/v1/vaults/${vault.id}`);
    await mutate(`/api/v1/vaults/${vault.id}/commands`, {
      id: crypto.randomUUID(),
      expectedRevision: current.revision,
      ...fields,
    });
  }
  const disabled = busy || !!pending || !owner;
  const field = (name: keyof ConfigForm, label: string) => (
    <label>
      {label}
      <input
        value={form[name]}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        inputMode="decimal"
      />
    </label>
  );
  return (
    <div className="af-shell">
      <div className="af-banner">LOCAL / MOCK · 合成 RWA 行情 · 不连接钱包、不签名、不使用真实资金</div>
      <header className="af-header">
        <a href="./" className="af-brand">
          AlphaForge <small>HACKATHON</small>
        </a>
        <a href="./">返回策略工作台 ↗</a>
      </header>
      <main>
        <section className="af-heading">
          <div>
            <p className="af-eyebrow">RWA QUANT INFRA / STAGE 02</p>
            <h1>让策略运行，让每一步可追溯。</h1>
            <p>多标的模拟、量化策略接入，以及触发后不会自行恢复的全组合清仓。</p>
          </div>
          <label>
            测试账户
            <select
              aria-label="测试账户"
              value={owner}
              disabled={busy}
              onChange={(e) => {
                const user = e.target.value;
                if (user)
                  void perform(async () => {
                    setOwner('');
                    setRuns([]);
                    setVaults([]);
                    setDecisionDraft(null);
                    setExternalJson({});
                    await request('/api/demo/session', { user });
                    setRuns([]);
                    setVaults([]);
                  });
              }}
            >
              <option value="">选择账户</option>
              <option value="alice" disabled={!!pending && pending.owner !== 'alice'}>
                Alice
              </option>
              <option value="bob" disabled={!!pending && pending.owner !== 'bob'}>
                Bob
              </option>
              <option value="derick" disabled={!!pending && pending.owner !== 'derick'}>
                Derick
              </option>
            </select>
          </label>
        </section>
        <div className="af-message" role="status">
          {message}
        </div>
        {pending && !busy && (
          <section className="af-warning">
            <strong>有一笔结果待确认的请求 · {pending.owner}</strong>
            <p>先用原请求核对，避免重复变更资金。</p>
            <button
              disabled={busy || (owner !== '' && owner !== pending.owner)}
              onClick={() =>
                void perform(async () => {
                  const identity = await request<{ user: string }>('/api/session');
                  if (identity.user !== pending.owner)
                    throw new Error('待确认请求属于另一个测试账户，请在原账户核对');
                  try {
                    await request(pending.path, pending.body);
                    savePending(null);
                  } catch (error) {
                    if (error instanceof SimulationError && error.definitive) savePending(null);
                    throw error;
                  }
                })
              }
            >
              核对原请求
            </button>
          </section>
        )}
        <section className="af-funding">
          <div>
            <span>闲置余额</span>
            <strong>
              {money(vault?.idle ?? '0')} <small>模拟 USDT</small>
            </strong>
          </div>
          <div>
            <span>运行可用现金</span>
            <strong>{money(vault?.activeCash ?? '0')}</strong>
          </div>
          <div>
            <span>累计取出</span>
            <strong>{money(vault?.withdrawalsPaid ?? '0')}</strong>
          </div>
        </section>
        <section className="af-panel af-vault" aria-label="Vault 与 Pass">
          <h2>Vault 与 Pass</h2>
          <div className="af-vault-balances">
            <div>
              <span>当前账户</span>
              <strong>{owner || '未选择'}</strong>
            </div>
            <div>
              <span>持有 PASS</span>
              <strong>{vault?.passes ?? '0'} PASS</strong>
            </div>
          </div>
          {!vault ? (
            <button
              disabled={disabled}
              onClick={() =>
                void perform(async () => {
                  await request('/api/v1/vaults', {
                    strategyId: 'core-flow-demo',
                    passPolicy: 'principal-v1',
                  });
                })
              }
            >
              建立测试 Vault
            </button>
          ) : !vault.passAccounting ? (
            <>
              <p>历史额度模式 · 尚未启用 Pass 冻结。旧记录保持原样。</p>
              <button
                disabled={disabled}
                onClick={() => void perform(() => vaultCommand({ type: 'enablePassLocking' }))}
              >
                启用本金冻结规则
              </button>
              <small>需要停止并清仓、没有历史已付款或待处理提现，且原始存入本金不超过持有 Pass。</small>
            </>
          ) : (
            <>
              <div className="af-vault-balances">
                <div>
                  <span>可用 Pass</span>
                  <strong>{passMoney(vault.passAccounting.freePassRaw)}</strong>
                </div>
                <div>
                  <span>已冻结 Pass</span>
                  <strong>{passMoney(vault.passAccounting.lockedPassRaw)}</strong>
                </div>
                <div>
                  <span>剩余本金基准</span>
                  <strong>{money(vault.passAccounting.principal)}</strong>
                </div>
                <div>
                  <span>当前可申请取出</span>
                  <strong>{money(vault.passAccounting.withdrawable)}</strong>
                </div>
              </div>
              <p>
                存入 1 单位本金冻结 1 Pass。取出先扣利润，再扣本金；仅本金部分解冻。Bot
                现金转回闲置余额不解冻。
              </p>
              {vault.passAccounting.closed ? (
                <p role="status">Vault 已完整退出，Pass 已全部释放；此 Vault 保留历史，不再接收存入。</p>
              ) : (
                <>
                  <label>
                    存入 / 取出金额（模拟 USDT）
                    <input
                      inputMode="decimal"
                      disabled={disabled}
                      value={vaultAmount}
                      onChange={(e) => setVaultAmount(e.target.value)}
                    />
                  </label>
                  <div className="af-actions">
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void perform(() =>
                          vaultCommand({ type: 'deposit', amount: parseUnits(vaultAmount, 6) }),
                        )
                      }
                    >
                      存入并冻结 Pass
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void perform(() =>
                          vaultCommand({ type: 'requestWithdrawal', amount: parseUnits(vaultAmount, 6) }),
                        )
                      }
                    >
                      申请取出到模拟钱包
                    </button>
                    {vault.status === 'stopped' && vault.activeCash !== '0' && (
                      <button
                        disabled={disabled}
                        onClick={() =>
                          void perform(async () => {
                            const current = await request<Vault>(`/api/v1/vaults/${vault.id}`);
                            await mutate(`/api/v1/vaults/${vault.id}/commands`, {
                              id: crypto.randomUUID(),
                              expectedRevision: current.revision,
                              type: 'deallocate',
                              amount: current.activeCash,
                            });
                          })
                        }
                      >
                        将结算现金转为闲置
                      </button>
                    )}
                    <button
                      disabled={
                        disabled ||
                        vault.status !== 'stopped' ||
                        Object.keys(vault.pendingWithdrawals).length > 0
                      }
                      onClick={() => void perform(() => vaultCommand({ type: 'closeVault' }))}
                    >
                      完整退出并释放全部 Pass
                    </button>
                  </div>
                  <small>
                    有持仓时不能取出本金。完整退出要求停止、无持仓及待处理提现；亏损不扣减
                    Pass，退出时释放全部剩余冻结。这里只改变本地模拟账本。
                  </small>
                </>
              )}
              {Object.entries(vault.pendingWithdrawals).map(([id, amount]) => (
                <div className="af-withdrawal" key={id}>
                  <strong>待取出 {money(amount)}</strong>
                  <p>
                    利润 {money(vault.passAccounting!.withdrawals[id]!.profit)} · 本金{' '}
                    {money(vault.passAccounting!.withdrawals[id]!.principal)} · 确认前 Pass 仍冻结
                  </p>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform(() => vaultCommand({ type: 'confirmWithdrawal', withdrawalId: id }))
                    }
                  >
                    模拟确认到账
                  </button>{' '}
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform(() => vaultCommand({ type: 'cancelWithdrawal', withdrawalId: id }))
                    }
                  >
                    取消取出
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
        <div className="af-layout">
          <aside className="af-panel">
            <p className="af-eyebrow">01 / 配置新运行</p>
            <h2>配置量化策略</h2>
            <p>RWA-A / RWA-B 均为合成资产。执行与清仓由底座控制，参数在启动后冻结。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  if (!vault) throw new Error('请先建立测试 Vault 并存入模拟资金');
                  const parameters = parametersFromForm(form);
                  await mutate('/api/v1/automata', {
                    id: crypto.randomUUID(),
                    vaultId: vault.id,
                    amount: parseUnits(capital, 6),
                    datasetId: dataset,
                    parameters,
                  });
                });
              }}
            >
              <label>
                运行资金（模拟 USDT）
                <input
                  value={capital}
                  onChange={(e) => setCapital(e.target.value)}
                  disabled={disabled}
                  inputMode="decimal"
                />
              </label>
              <label>
                行情场景
                <select value={dataset} onChange={(e) => setDataset(e.target.value)} disabled={disabled}>
                  <option value="trend">合成上涨行情</option>
                  <option value="decline">合成下跌行情</option>
                  <option value="liquidity">合成流动性受阻</option>
                  <option value="ema-cycle">EMA 合成周期 · 先涨后跌</option>
                </select>
              </label>
              <div className="af-fields">
                {field('weight', 'RWA-A 目标权重 %')}
                {field('weightB', 'RWA-B 目标权重 %')}
                {field('deviation', '再平衡偏离阈值 %')}
                {form.strategyMode !== 'external' && field('seconds', '检查间隔（模拟秒）')}
                {field('fee', '模拟手续费 %')}
                {field('slippage', '最大滑点 %')}
              </div>
              <label>
                策略来源
                <select
                  value={form.strategyMode}
                  disabled={disabled}
                  onChange={(e) => setForm({ ...form, strategyMode: e.target.value })}
                >
                  <option value="rebalance">内置阈值再平衡</option>
                  <option value="external">外部量化策略 · JSON 接口</option>
                </select>
              </label>
              <small>
                {form.strategyMode === 'external'
                  ? '等待外部策略发送目标仓位；上方权重仅保存为配置参考，不会自动买入。两种资产均可被策略选择。'
                  : '权重之和不超过 100%，剩余资金保留为现金。'}
              </small>
              <fieldset>
                <legend>全组合清仓条件</legend>
                <label>
                  模式
                  <select
                    value={form.mode}
                    disabled={disabled}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        mode: e.target.value,
                        upper: e.target.value === 'price' ? '120' : '10',
                        lower: e.target.value === 'price' ? '90' : '-5',
                      })
                    }
                  >
                    <option value="off">仅手动停止清仓</option>
                    <option value="percent">组合收益率上下限</option>
                    <option value="price">指定资产价格上下限</option>
                  </select>
                </label>
                {form.mode === 'price' && (
                  <label>
                    触发资产
                    <select
                      value={form.priceAsset}
                      disabled={disabled}
                      onChange={(e) => setForm({ ...form, priceAsset: e.target.value })}
                    >
                      <option value="rwa-a">RWA-A</option>
                      <option value="rwa-b">RWA-B</option>
                    </select>
                  </label>
                )}
                {form.mode !== 'off' && (
                  <div className="af-fields">
                    {field('upper', form.mode === 'price' ? '价格上限（模拟 USDT）' : '收益上限 %')}
                    {field('lower', form.mode === 'price' ? '价格下限（模拟 USDT）' : '收益下限 %（负数）')}
                  </div>
                )}
                <small>上下限可留空一个；触碰即清仓整个组合。停止后不会自动重启。</small>
              </fieldset>
              <button
                className="af-primary"
                disabled={
                  disabled ||
                  !vault?.passAccounting ||
                  vault.passAccounting.closed ||
                  vault.status !== 'stopped' ||
                  vault.activeCash !== '0'
                }
              >
                启动模拟运行
              </button>
            </form>
          </aside>
          <section className="af-runs">
            <p className="af-eyebrow">02 / 运行与记录</p>
            {!runs.length && (
              <div className="af-empty">
                <h2>第一条运行记录，从这里开始。</h2>
                <p>选择账户 → 建立 Vault → 存入模拟资金 → 配置并启动。</p>
              </div>
            )}
            {runs.map((run) => (
              <article className="af-panel af-run" key={run.state.id}>
                <header>
                  <div>
                    <h2>
                      {run.state.id === 'qinfra-ema-demo'
                        ? '开源 EMA 测试策略'
                        : run.state.parameters.strategyMode === 'external'
                          ? '外部量化策略'
                          : 'RWA 再平衡'}
                    </h2>
                    <small>
                      运行 {run.state.id.slice(0, 8)} · {run.datasetId} · 第 {run.state.cursor}/120 帧
                    </small>
                  </div>
                  <span className={`af-state ${run.state.status === 'blocked' ? 'af-blocked' : ''}`}>
                    {states[run.state.status]}
                  </span>
                </header>
                {run.state.id === 'qinfra-ema-demo' && (
                  <p>
                    EMA 15/30 · 合成周期测试 ·{' '}
                    <a href="https://github.com/QuantConnect/Lean/blob/ebd7268d68609ae85f73de8290d9673afb1992ac/Algorithm.Python/MovingAverageCrossAlgorithm.py">
                      开源策略来源
                    </a>
                    。已适配目标仓位接口，不代表原始日线策略收益。
                  </p>
                )}
                <div className="af-metrics">
                  <div>
                    <span>组合权益</span>
                    <strong>{money(run.equity)}</strong>
                  </div>
                  <div>
                    <span>调整后收益率</span>
                    <strong>{(run.returnBps / 100).toFixed(2)}%</strong>
                  </div>
                  <div>
                    <span>累计交易费用</span>
                    <strong>{money(run.state.fees)}</strong>
                  </div>
                </div>
                {run.state.trigger && (
                  <p className="af-warning">
                    清仓原因：{triggerNames[run.state.trigger.reason]} · 触发时权益{' '}
                    {money(run.state.trigger.equity)}；最终成交以实际记录为准。
                  </p>
                )}
                {run.settlementReleased !== '0' && (
                  <p>结算时超出额度、已归还闲置：{money(run.settlementReleased)} 模拟 USDT</p>
                )}
                {(run.state.reason || run.runtimeError) && (
                  <p className="af-warning">{run.runtimeError ?? run.state.reason}</p>
                )}
                {run.replayComplete && run.state.status !== 'stopped' && (
                  <p className="af-warning">
                    固定行情已回放完毕，当前持仓仍保留。可用最后一帧报价执行停止清仓；不会将回放结束视为已停止。
                  </p>
                )}
                <Curve run={run} />
                {run.state.parameters.strategyMode === 'external' && (
                  <details>
                    <summary>策略接入与信号状态</summary>
                    <p>
                      {run.state.lastDecision
                        ? `最近信号：${run.state.lastDecision.id} · 第 ${run.state.lastDecision.frameSeq} 帧 · ${run.state.lastDecision.trades} 笔成交`
                        : '尚未收到策略信号；底座不会自行买入。'}
                    </p>
                    {run.state.lastDecision && (
                      <p>
                        最近目标：
                        {Object.keys(run.state.parameters.weights)
                          .map(
                            (id) =>
                              `${id.toUpperCase()} ${(run.state.lastDecision!.targets[id] ?? 0) / 100}%`,
                          )
                          .join(' / ')}
                      </p>
                    )}
                    <p className="af-provenance">
                      协议 alphaforge-targets-v1 · 状态版本 {run.revision}
                      <br />
                      GET /api/v1/automata/{run.state.id}/strategy-context
                      <br />
                      POST /api/v1/automata/{run.state.id}/decisions
                    </p>
                    <small>信号仅对当前帧执行一次。部分成交不会自动补单；后续调仓需读取新状态再提交。</small>
                    <label>
                      外部策略目标 JSON（基点，10000 = 100%）
                      <textarea
                        aria-label="外部策略目标 JSON"
                        value={externalJson[run.state.id] ?? ''}
                        placeholder={'{"rwa-a":3000,"rwa-b":2000}'}
                        disabled={disabled}
                        onChange={(e) => {
                          setExternalJson({ ...externalJson, [run.state.id]: e.target.value });
                          setDecisionDraft(null);
                        }}
                      />
                    </label>
                    <p>只提交当前模拟账户和当前行情帧的目标。空对象表示目标全部为现金；不会连接真实钱包。</p>
                    <button
                      disabled={disabled || run.state.status !== 'running'}
                      onClick={() =>
                        void perform(async () => {
                          const context = await request<ExternalStrategyContext>(
                            `/api/v1/automata/${run.state.id}/strategy-context`,
                          );
                          const body = externalDecisionFromJson(
                            externalJson[run.state.id] ?? '',
                            context,
                            crypto.randomUUID(),
                          );
                          setDecisionDraft({ owner, runId: run.state.id, body });
                        })
                      }
                    >
                      预览 JSON 信号
                    </button>
                    {decisionDraft?.runId === run.state.id && decisionDraft.owner === owner && (
                      <div className="af-warning" data-external-preview>
                        <h3>确认当前帧目标</h3>
                        <pre>{JSON.stringify(decisionDraft.body, null, 2)}</pre>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void perform(async () => {
                              const context = await request<ExternalStrategyContext>(
                                `/api/v1/automata/${run.state.id}/strategy-context`,
                              );
                              if (
                                context.revision !== decisionDraft.body.expectedRevision ||
                                context.frameSeq !== decisionDraft.body.frameSeq
                              ) {
                                setDecisionDraft(null);
                                throw new Error('行情帧或账户状态已变化，请重新预览信号');
                              }
                              await mutate(`/api/v1/automata/${run.state.id}/decisions`, decisionDraft.body);
                              setDecisionDraft(null);
                            })
                          }
                        >
                          确认提交 JSON 信号
                        </button>
                        <button disabled={busy} onClick={() => setDecisionDraft(null)}>
                          取消信号预览
                        </button>
                      </div>
                    )}
                  </details>
                )}
                <div className="af-actions">
                  <button
                    disabled={disabled || run.state.status !== 'running'}
                    onClick={() => void perform(() => action(run, { type: 'pause' }))}
                  >
                    暂停策略
                  </button>
                  <button
                    disabled={disabled || run.state.status !== 'paused'}
                    onClick={() => void perform(() => action(run, { type: 'resume' }))}
                  >
                    继续策略
                  </button>
                  <button
                    disabled={disabled || run.state.status === 'stopped' || run.replayComplete}
                    onClick={() => void perform(() => action(run, { type: 'step' }))}
                  >
                    推进一帧
                  </button>
                  <button
                    className="af-danger"
                    disabled={disabled || run.state.status === 'stopped'}
                    onClick={() => void perform(() => action(run, { type: 'stop' }))}
                  >
                    停止并立即清仓
                  </button>
                </div>
                {['running', 'paused'].includes(run.state.status) && (
                  <div className="af-transfer">
                    <label>
                      变更运行资金
                      <input
                        value={transfer}
                        onChange={(e) => setTransfer(e.target.value)}
                        inputMode="decimal"
                        disabled={disabled}
                      />
                    </label>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void perform(() =>
                          action(run, { type: 'fund', direction: 'in', amount: parseUnits(transfer, 6) }),
                        )
                      }
                    >
                      从闲置追加
                    </button>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void perform(() =>
                          action(run, { type: 'fund', direction: 'out', amount: parseUnits(transfer, 6) }),
                        )
                      }
                    >
                      撤回到闲置
                    </button>
                    <small>最多撤回 {money(run.state.cash)} 模拟 USDT；不自动卖出持仓。</small>
                  </div>
                )}
                <div className="af-table">
                  <table>
                    <caption>当前持仓</caption>
                    <thead>
                      <tr>
                        <th>资产</th>
                        <th>数量</th>
                        <th>成本（含买入费）</th>
                        <th>卖出报价</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(run.state.positions).map(([id, p]) => (
                        <tr key={id}>
                          <td>{id.toUpperCase()}</td>
                          <td>{money(p.quantity)}</td>
                          <td>{money(p.cost)}</td>
                          <td>{money(run.state.quotes[id]?.bid ?? '0')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>成交与运行记录 · {run.state.trades.length} 笔</summary>
                  <div className="af-table">
                    <table>
                      <thead>
                        <tr>
                          <th>模拟秒</th>
                          <th>资产</th>
                          <th>方向</th>
                          <th>数量</th>
                          <th>成交价</th>
                          <th>费用</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.state.trades.map((trade) => (
                          <tr key={trade.id}>
                            <td>{trade.at / 1000}</td>
                            <td>{trade.assetId.toUpperCase()}</td>
                            <td>
                              {trade.side === 'buy' ? '买入' : '卖出'}
                              {trade.purpose === 'liquidation' ? ' · 清仓' : ''}
                            </td>
                            <td>{money(trade.quantity)}</td>
                            <td>{money(trade.price)}</td>
                            <td>{money(trade.fee)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="af-provenance">
                    引擎 {run.state.version}
                    <br />
                    数据 SHA-256 {run.datasetHash}
                    <br />
                    服务器保存检查点，刷新页面不会重置持仓。
                  </p>
                </details>
              </article>
            ))}
          </section>
        </div>
      </main>
      <footer className="af-footer">
        AlphaForge · 本地交易自动机底座 · 参考股票价格与代币成交报价独立建模
      </footer>
    </div>
  );
}
