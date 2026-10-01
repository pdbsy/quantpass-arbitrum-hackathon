import { useEffect, useMemo, useState } from 'react';
import type { PaperServiceView } from '../../../packages/automata/src/reference-paper-service.ts';
import type { PaperEvent } from '../../../packages/automata/src/reference-paper.ts';
import type { PaperControl } from '../../../packages/automata/src/reference-paper-journal.ts';
import {
  readPaperView,
  paperRequest,
  PaperOutbox,
  fundingAmount6,
  formatPaperAmount,
  returnPercent,
  paperChartPoints,
} from './reference-paper-client.ts';
const time = (at: number | null) =>
  at === null ? '—' : new Date(at).toLocaleString('zh-CN', { hour12: false });
const phases: Record<string, string> = {
  blocked: '运行受阻',
  data_paused: '等待有效行情',
  warming_up: '策略暖机中',
  running: '模拟运行中',
  liquidating: '正在请求清仓',
  stopped: '已停止',
};
const reasons: Record<string, string> = {
  WAITING_FOR_REFERENCE: '等待第一轮行情',
  STALE_REFERENCE: '行情已超过 30 秒',
  HTTP_ACCESS_DENIED: '行情接口拒绝访问，采集已停止',
  PAPER_STORAGE_LIMIT: '存储达到预留上限，采集已停止，已有历史完整保留',
  BATCH_QUOTE_SKEW: '三标的报价时间差超过 10 秒，本轮不交易',
  BATCH_MEMBER_REJECTED: '部分标的报价未通过校验，本轮不交易',
  QUOTE_SKEW: '三标的行情时间差超过限制',
  QUOTE_STALE: '行情超过时效限制',
  PAPER_INPUT_BEFORE_CONTROL: '采集发生在资金操作之前，此轮只保留为诊断',
};
function reason(code: string | null): string {
  return code ? (reasons[code] ?? '本轮行情未满足校验：' + code) : '行情通过既定时效和一致性检查';
}
function Curve({ view }: { view: PaperServiceView }) {
  const points = paperChartPoints(view.history.items),
    values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  if (!values.length) return <p className="af-paper-empty">还没有有效净值记录。缺失行情不会补造价格。</p>;
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    range = max - min || 1;
  const paths: string[] = [];
  let current = '';
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) paths.push(current);
      current = '';
      return;
    }
    const x = 48 + (i * 700) / Math.max(points.length - 1, 1),
      y = 190 - ((p.value - min) * 140) / range;
    current += (current ? ' L ' : 'M ') + x + ' ' + y;
  });
  if (current) paths.push(current);
  return (
    <svg className="af-paper-curve" viewBox="0 0 800 235" role="img" aria-label="资金流调整后的模拟收益曲线">
      <line x1="48" x2="748" y1="190" y2="190" className="af-paper-grid" />
      <text x="5" y="50">
        {max.toFixed(2)}%
      </text>
      <text x="5" y="190">
        {min.toFixed(2)}%
      </text>
      {paths.map((d, i) => (
        <path key={i} d={d} className="af-paper-line" />
      ))}
      <text x="48" y="222">
        {new Date(points[0]!.at).toLocaleTimeString('zh-CN', { hour12: false })}
      </text>
      <text x="630" y="222">
        {new Date(points.at(-1)!.at).toLocaleTimeString('zh-CN', { hour12: false })}
      </text>
    </svg>
  );
}
export function ReferencePaper() {
  const [owner, setOwner] = useState<'alice' | 'bob'>('alice'),
    [connected, setConnected] = useState(false);
  const [view, setView] = useState<PaperServiceView | null>(null),
    [amount, setAmount] = useState('100');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false),
    [stopBusy, setStopBusy] = useState(false),
    [stopPending, setStopPending] = useState(false),
    [pageFresh, setPageFresh] = useState(false);
  const box = useMemo(
    () =>
      view
        ? new PaperOutbox(sessionStorage, location.origin + ':' + view.accountId + ':' + view.owner)
        : null,
    [view?.accountId, view?.owner],
  );
  const stopBox = useMemo(
    () =>
      view
        ? new PaperOutbox(sessionStorage, location.origin + ':' + view.accountId + ':' + view.owner + ':stop')
        : null,
    [view?.accountId, view?.owner],
  );
  useEffect(() => {
    let live = true;
    void paperRequest<{ user: 'alice' | 'bob' }>('/api/session')
      .then((s) => {
        if (live) {
          setOwner(s.user);
          setConnected(true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!connected) return;
    let live = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await readPaperView();
        if (live) {
          setView(next);
          setPageFresh(true);
        }
      } catch (error) {
        if (live) {
          setPageFresh(false);
          setMessage(error instanceof Error ? error.message : '页面读取失败');
        }
      }
      if (live)
        timer = setTimeout(() => {
          void refresh();
        }, 5000);
    };
    void refresh();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [connected, owner]);
  const refreshPending = () => {
    try {
      setPending(!!box?.pending());
    } catch (error) {
      setMessage(String(error));
      setPending(true);
    }
    try {
      setStopPending(!!stopBox?.pending());
    } catch (error) {
      setMessage(String(error));
      setStopPending(true);
    }
  };
  useEffect(refreshPending, [box, stopBox]);
  const login = async () => {
    setBusy(true);
    try {
      await paperRequest('/api/demo/session', { user: owner });
      setView(null);
      setConnected(true);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '账户连接失败');
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (work: () => Promise<unknown>, success: string, priority = false) => {
    if (!box || !stopBox) return;
    const setWorking = priority ? setStopBusy : setBusy;
    setWorking(true);
    setMessage('');
    try {
      await work();
      setMessage(success);
      setView(await readPaperView());
      setPageFresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作未确认');
    } finally {
      refreshPending();
      setWorking(false);
    }
  };
  const fund = (direction: 'in' | 'out') => {
    try {
      const action: PaperControl['action'] = { type: 'fund', direction, amount6: fundingAmount6(amount) };
      void mutate(
        () => box!.send(action, view!.revision),
        direction === 'in' ? '虚拟资金已追加。' : '虚拟现金已撤回。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请输入有效金额');
    }
  };
  const unavailable = busy || pending || stopBusy || stopPending || !pageFresh || !view?.initialized;
  const events: (PaperEvent & { revision: number })[] =
    view?.history.items.flatMap((row) => row.events.map((e) => ({ ...e, revision: row.revision }))) ?? [];
  const fillEvents: (PaperEvent & { revision: number })[] =
    (view?.fills ?? view?.history.items)?.flatMap((row) =>
      row.events.map((e) => ({ ...e, revision: row.revision })),
    ) ?? [];
  const signals = events.find((e) => e.kind === 'SIGNALS')?.signals as
    { id: string; signal: string }[] | undefined;
  const signalLabels: Record<string, string> = {
    warmup: '暖机',
    buy: '买入',
    sell: '卖出',
    hold: '持有',
    cash: '保留现金',
  };
  return (
    <>
      <div className="af-banner">研究模拟账户 · 虚拟资金与模拟成交 · 不代表主网业绩</div>
      <header className="af-header">
        <span className="af-brand">
          AlphaForge <small>REFERENCE PAPER</small>
        </span>
        <span>持续模拟盘</span>
      </header>
      <main className="af-paper-main">
        <div className="af-heading">
          <div>
            <span className="af-eyebrow">MSFT · NVDA · AAPL</span>
            <h1>观察策略如何持续运行</h1>
            <p>双均线 EMA 15/30 · 1 分钟采样 · 每个标的最多三分之一资金</p>
          </div>
          <div className="af-paper-login">
            <label>
              本地测试账户
              <select
                value={owner}
                disabled={busy || stopBusy || pending || stopPending}
                onChange={(e) => {
                  setOwner(e.target.value as 'alice' | 'bob');
                  setConnected(false);
                  setView(null);
                }}
              >
                <option value="alice">Alice</option>
                <option value="bob">Bob</option>
              </select>
            </label>
            <button
              onClick={() => {
                void login();
              }}
              disabled={busy || stopBusy}
            >
              进入研究账户
            </button>
          </div>
        </div>
        {message && (
          <div className="af-message" role="status">
            {message}
          </div>
        )}
        {pending && (
          <div className="af-message">
            上一笔请求尚未确认。重试会使用原来的请求编号和金额。
            <button
              disabled={busy}
              onClick={() => {
                void mutate(() => box!.retry(), '原请求已确认。');
              }}
            >
              重试原请求
            </button>
          </div>
        )}
        {stopPending && (
          <div className="af-message">
            停止请求尚未确认。可以安全重试原停止请求。
            <button
              disabled={stopBusy}
              onClick={() => {
                void mutate(() => stopBox!.retry(), '停止请求已确认。', true);
              }}
            >
              重试原停止请求
            </button>
          </div>
        )}
        {!view ? (
          <section className="af-panel">
            <h2>独立研究账户</h2>
            <p>请进入配置的测试账户。此页面不会存入真实 Vault，也不会冻结或解锁 Pass。</p>
          </section>
        ) : (
          <>
            <section className="af-panel af-paper-status">
              <div>
                <span className="af-eyebrow">
                  {view.sourceMode === 'OFFLINE_FIXTURE' ? '离线验收样本' : '官方真实参考行情'}
                </span>
                <h2>{!pageFresh ? '页面连接中断' : phases[view.health.phase]}</h2>
                <p>{reason(view.health.reason)}</p>
                {view.health.backupInProgress && <p>备份正在复验，行情采集与停止操作仍可使用。</p>}
                <small>
                  最近采集：{time(view.health.lastCaptureAt)} · 最近有效行情：
                  {time(view.health.lastAcceptedAt)}
                </small>
              </div>
              <div>
                <strong>{view.warmup.validMinutes} / 30</strong>
                <p>有效分钟暖机</p>
                <progress max="30" value={view.warmup.validMinutes} />
              </div>
            </section>
            {view.account.status === 'liquidating' && (
              <div className="af-message">
                停止已锁定，不再新增买入。只有有效行情允许模拟卖出；残余仓位归零后才显示“已停止”。
              </div>
            )}
            <section className="af-panel">
              <div className="af-metrics af-paper-metrics">
                <div>
                  <span>模拟账户净值</span>
                  <strong>{pageFresh ? formatPaperAmount(view.nav6, 6) : '—'}</strong>
                  <small>虚拟 AF-USDC</small>
                </div>
                <div>
                  <span>可撤回现金</span>
                  <strong>{formatPaperAmount(view.account.cash6, 6)}</strong>
                  <small>只撤回现金，不自动卖持仓</small>
                </div>
                <div>
                  <span>资金流调整后收益</span>
                  <strong>{pageFresh ? returnPercent(view.unitValue) : '—'}</strong>
                  <small>追加／撤回不计入策略收益</small>
                </div>
                <div>
                  <span>累计模拟手续费</span>
                  <strong>{formatPaperAmount(view.account.fees6, 6)}</strong>
                  <small>不包含主网 gas</small>
                </div>
              </div>
              {view.nav6 === null && <p>持仓行情失效，当前净值暂不可用。历史值保留在图表中。</p>}
              <h2>资金流调整后的收益</h2>
              <Curve view={view} />
              <small>最近最多 100 条记录；无效行情留断点。收益按累计单位价值展示，显示至两位百分比。</small>
            </section>
            <section className="af-panel">
              <h2>虚拟资金与停止</h2>
              <div className="af-paper-controls">
                <label>
                  虚拟 AF-USDC 金额
                  <input
                    value={amount}
                    inputMode="decimal"
                    onChange={(e) => setAmount(e.target.value)}
                    aria-label="虚拟 AF-USDC 金额"
                  />
                </label>
                <button
                  disabled={unavailable || view.account.status !== 'running' || view.nav6 === null}
                  onClick={() => fund('in')}
                >
                  追加虚拟资金
                </button>
                <button disabled={unavailable || view.nav6 === null} onClick={() => fund('out')}>
                  撤回虚拟现金
                </button>
                <button
                  className="af-paper-stop"
                  disabled={!view.initialized || stopBusy || stopPending || view.account.status === 'stopped'}
                  onClick={() => {
                    void mutate(
                      () => stopBox!.send({ type: 'stop' }, view.revision),
                      '停止请求已记录，请查看仓位与结算状态。',
                      true,
                    );
                  }}
                >
                  停止并请求清仓
                </button>
                <button
                  disabled={unavailable}
                  onClick={() => {
                    void mutate(() => box!.backup(), '一致性备份已创建并验证。');
                  }}
                >
                  保存并验证备份
                </button>
              </div>
              <p>
                <small>本轮只开启手动停止；停止后不会自动重启。资金操作只影响当前虚拟研究账户。</small>
              </p>
            </section>
            <section className="af-panel">
              <h2>参考行情与模拟持仓</h2>
              <div className="af-paper-table-scroll">
                <table className="af-paper-table">
                  <thead>
                    <tr>
                      <th>标的</th>
                      <th>参考买／卖价（USD，约）</th>
                      <th>行情年龄</th>
                      <th>最近策略信号</th>
                      <th>模拟持有数量</th>
                      <th>持仓成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.account.config.market.selections.map((s) => {
                      const id = s.chainId + ':' + s.contractAddress,
                        q = view.account.quotes[id],
                        p = view.account.positions[id]!;
                      const age = q ? Math.max(0, view.at - q.generatedAt) : null,
                        valid = age !== null && age <= view.account.config.market.maxAgeMs;
                      return (
                        <tr key={id}>
                          <td>
                            <strong>{s.symbol}</strong>
                          </td>
                          <td
                            title={
                              q
                                ? formatPaperAmount(q.tokenBidUsd18, 18) +
                                  ' / ' +
                                  formatPaperAmount(q.tokenAskUsd18, 18)
                                : undefined
                            }
                          >
                            {q
                              ? formatPaperAmount(
                                  (BigInt(q.tokenBidUsd18) / 100000000000000n).toString(),
                                  4,
                                ) +
                                ' / ' +
                                formatPaperAmount((BigInt(q.tokenAskUsd18) / 100000000000000n).toString(), 4)
                              : '—'}
                          </td>
                          <td>
                            {age === null
                              ? '等待行情'
                              : Math.floor(age / 1000) + ' 秒' + (valid ? '' : ' · 已失效')}
                          </td>
                          <td>
                            {signalLabels[signals?.find((signal) => signal.id === id)?.signal ?? 'warmup']}
                          </td>
                          <td>{formatPaperAmount(p.quantity18, 18)}</td>
                          <td>{formatPaperAmount(p.cost6, 6)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <small>
                买入使用参考卖价、卖出使用参考买价；测试手续费 0.3%，不利滑点 0.1%。这些是模拟假设。
              </small>
            </section>
            <section className="af-panel">
              <h2>最近模拟成交 · 累计 {view.account.fills} 笔</h2>
              <div className="af-paper-table-scroll">
                <table className="af-paper-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>标的</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>模拟成交价</th>
                      <th>手续费</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fillEvents
                      .filter((e) => e.kind === 'FILL')
                      .map((e, i) => (
                        <tr key={String(e.revision) + ':' + i}>
                          <td>{time(e.at as number)}</td>
                          <td>{view.account.quotes[String(e.identity)]?.symbol ?? '—'}</td>
                          <td>{e.side === 'buy' ? '买入' : '卖出'}</td>
                          <td>{formatPaperAmount(e.quantity18 as string, 18)}</td>
                          <td>{formatPaperAmount(e.priceUsd18 as string, 18)}</td>
                          <td>{formatPaperAmount(e.fee6 as string, 6)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!fillEvents.some((e) => e.kind === 'FILL') && (
                <p>当前记录窗口暂无模拟成交；暖机或等待信号时，资金会保留为现金。</p>
              )}
            </section>
            <section className="af-panel af-paper-operations">
              <div>
                <h2>运行记录</h2>
                <p>
                  已处理 {view.cursor} 轮行情 · 账本版本 {view.revision}
                </p>
                <p>
                  存储：{(view.storage.usedBytes / 1_000_000).toFixed(1)} /{' '}
                  {(view.storage.maxBytes / 1_000_000).toFixed(0)} MB
                </p>
                <small>达到预留上限后停止新增，保留已有历史与备份。</small>
              </div>
              <div>
                <h2>已验证备份</h2>
                {view.backups.length ? (
                  view.backups
                    .slice(-3)
                    .reverse()
                    .map((b) => (
                      <p key={b.id}>
                        {time(b.createdAt)} · 版本 {b.revision}
                      </p>
                    ))
                ) : (
                  <p>尚无一致性备份。</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
      <footer className="af-footer">
        <small>AlphaForge Hackathon · 参考行情采集每轮完成后等待 5 秒 · 此页面只用于研究验收</small>
      </footer>
    </>
  );
}
