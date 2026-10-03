import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits } from 'ethers';
import type { TradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import type { tradingPerformance } from '../../../packages/testnet/src/trading-performance.ts';
import { ownerAction } from '../../../packages/testnet/src/owner-actions.ts';
import { TestnetWalletClient, testnetApi, type TestnetWalletProvider } from './testnet-wallet-client.ts';
import {
  TestnetAccountReader,
  pollTestnetAccount,
  parseTestnetIntent,
  testnetOperationMessage,
} from './testnet-ui-state.ts';
import { formAction } from './testnet-action-form.ts';

type Provider = TestnetWalletProvider & {
  on?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};
interface VaultView {
  id: string;
  status: string;
  manifest: { vault: string; pass: string; usdc: string; manifestDigest: string };
  execution?: { state: string; signingEnabled?: boolean; observedAt?: number | null };
  snapshot: TradingSnapshot | null;
  performance: ReturnType<typeof tradingPerformance> | null;
}
interface Prepared {
  operationId: string | null;
  transaction: ReturnType<typeof ownerAction>;
  manifestDigest: string;
  snapshotHash: string;
}
interface Pending {
  operationId: string | null;
  hash: string | null;
  kind: string;
}
const labels: Record<string, string> = {
  APPROVE_USDC: '授权存款所需 AF-USDC',
  APPROVE_PASS: '授权锁定所需 PASS',
  DEPOSIT: '存入 Vault 并锁定 PASS',
  ALLOCATE: '分配闲置资金给策略',
  DEALLOCATE: '撤回策略现金到闲置余额',
  WITHDRAW: '取出到 owner 钱包',
  AUTHORIZE: '授予有限策略执行权限',
  BOUNDS: '设置触发清仓上下限',
  STOP: '停止策略并进入清仓',
  REVOKE: '撤销执行密钥权限',
  CLOSE: '结算并关闭 Vault',
  RECOVERY_SELL: '由 owner 手动卖出恢复',
  RESCUE_TOKEN: '关闭后取回意外转入代币',
  RESCUE_NATIVE: '关闭后取回意外转入 ETH',
};
const money = (v: string | null | undefined, decimals = 6) =>
  v === null || v === undefined ? '等待有效估值' : formatUnits(v, decimals);
const message = (error: unknown) => {
  const key = error instanceof Error ? error.message : '';
  const known: Record<string, string> = {
    WALLET_ACCOUNT_REQUIRED: '请安装或解锁钱包。',
    WALLET_WRONG_CHAIN: '请切换到 Robinhood Testnet。',
    WALLET_IDENTITY_CHANGED: '钱包账户已变化，请重新登录。',
    WALLET_LOGIN_REQUIRED: '请重新登录钱包。',
    WALLET_CHALLENGE_INVALID: '登录文本校验失败，未请求签名。',
    TESTNET_STORAGE_BLOCKED: '存储已暂停写入，请联系部署者处理容量。',
    AMOUNT_PRECISION: '金额小数位超过允许精度。',
    NAV_REQUIRED: '需要有效的单位净值才能设置百分比上下限。',
    ACTION_FIELD_REQUIRED: '请填写全部必要参数。',
    WALLET_SUBMISSION_UNKNOWN: '提交结果未知。请核对钱包交易记录，不要再次提交。',
    TRADING_EOA_OWNER_REQUIRED: '首轮交易仅支持普通钱包，智能合约钱包暂未接入。',
    STALE_PREVIEW: '状态已变化，请重新预览交易。',
  };
  return known[key] ?? '操作未完成。请检查输入、钱包和服务状态；页面不会自动重复提交。';
};
function VaultCard({
  view,
  client,
  onRefresh,
  readReady,
}: {
  view: VaultView;
  client: TestnetWalletClient;
  onRefresh: () => Promise<void>;
  readReady: boolean;
}) {
  const [fields, setFields] = useState<Record<string, string>>({ kind: 'DEPOSIT', boundMode: 'PERCENT' });
  const [prepared, setPrepared] = useState<{ value: Prepared; input: Record<string, unknown> } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null),
    [operation, setOperation] = useState<{
      state: string;
      productReady: boolean;
      failedFinalConfirmed?: boolean;
    } | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [recoveryHash, setRecoveryHash] = useState('');
  const [intentBlocked, setIntentBlocked] = useState(false);
  const snapshot = view.snapshot,
    kind = fields.kind!,
    key = `alphaforge-testnet-intent:46630:${view.manifest.manifestDigest}:${client.owner}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    try {
      const value = localStorage.getItem(key);
      if (value) setPending(parseTestnetIntent(value));
    } catch {
      setIntentBlocked(true);
      setNotice('本机待确认记录不可读取或已损坏。已暂停新提交；保留原记录，联系部署者并核对钱包交易。');
    }
    return () => {
      mounted.current = false;
    };
  }, [key]);
  useEffect(() => {
    if (!pending?.operationId || !pending.hash) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        await client.assertOwner({
          owner: client.owner!,
          vault: view.manifest.vault,
          pass: view.manifest.pass,
          usdc: view.manifest.usdc,
          blockTimestamp: '0',
        });
        await testnetApi(`/api/testnet/vaults/${view.id}/observe`, {
          operationId: pending.operationId,
          transactionHash: pending.hash,
        });
        const value = (await testnetApi(
          `/api/testnet/vaults/${view.id}/operations/${pending.operationId}`,
        )) as { state: string; productReady: boolean; failedFinalConfirmed?: boolean };
        if (!cancelled) {
          setOperation(value);
          if (value.productReady || value.state === 'REJECTED') {
            setNotice(testnetOperationMessage(value.state, value.productReady));
            localStorage.removeItem(key);
            setPending(null);
            await onRefresh();
          } else
            timer = setTimeout(() => {
              void poll();
            }, 5000);
        }
      } catch {
        if (!cancelled) {
          setNotice('交易核验服务暂不可用；原待确认记录保留，不会再次发送交易。');
          timer = setTimeout(() => {
            void poll();
          }, 10000);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pending, view.id, key, client, onRefresh, view.manifest]);
  useEffect(() => {
    if (!readReady) setPrepared(null);
  }, [readReady]);
  const field = (name: string, label: string, placeholder?: string) => (
    <label key={name}>
      {label}
      <input
        name={name}
        value={fields[name] ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          setFields({ ...fields, [name]: e.target.value });
          setPrepared(null);
        }}
        autoComplete="off"
      />
    </label>
  );
  const identity = () => {
    if (!snapshot || !readReady || intentBlocked) throw new Error('STALE_PREVIEW');
    return {
      owner: snapshot.owner,
      vault: snapshot.vault,
      pass: snapshot.pass,
      usdc: view.manifest.usdc,
      blockTimestamp: snapshot.blockTimestamp,
      stocks: snapshot.stocks.map((v) => v.token),
      stateVersion: snapshot.stateVersion,
    };
  };
  const preview = async () => {
    setBusy(true);
    setNotice('');
    try {
      await client.assertOwner(identity());
      const input = formAction(fields, snapshot!.unitNav);
      const value = (await testnetApi(`/api/testnet/vaults/${view.id}/prepare`, {
        action: input,
      })) as Prepared;
      if (
        value.manifestDigest !== view.manifest.manifestDigest ||
        value.snapshotHash !== snapshot!.blockHash ||
        JSON.stringify(value.transaction) !== JSON.stringify(ownerAction(identity(), input))
      )
        throw new Error('STALE_PREVIEW');
      setPrepared({ value, input });
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!prepared) return;
    setBusy(true);
    setNotice('');
    const intent: Pending = { operationId: prepared.value.operationId, hash: null, kind };
    try {
      const latest = (await testnetApi('/api/testnet/vaults')) as { vaults: VaultView[] };
      if (latest.vaults.find((v) => v.id === view.id)?.snapshot?.blockHash !== prepared.value.snapshotHash)
        throw new Error('STALE_PREVIEW');
      // Write before asking the wallet. An unknown response blocks repeat submission across reloads.
      localStorage.setItem(key, JSON.stringify(intent));
      setPending(intent);
      const hash = await client.send(identity(), prepared.input, prepared.value.transaction);
      const submitted = { ...intent, hash };
      localStorage.setItem(key, JSON.stringify(submitted));
      if (mounted.current) {
        setPending(submitted);
        setPrepared(null);
        setNotice('交易哈希已记录，等待链上核验。');
      }
      if (intent.operationId)
        await testnetApi(`/api/testnet/vaults/${view.id}/observe`, {
          operationId: intent.operationId,
          transactionHash: hash,
        });
    } catch (error) {
      if ((error as { code?: unknown }).code === 4001) {
        localStorage.removeItem(key);
        setPending(null);
        setNotice('你已取消钱包确认。');
      } else setNotice(message(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const recover = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)) throw new Error();
      const next = { ...pending, hash: recoveryHash.toLowerCase() };
      if (pending.operationId)
        await testnetApi(`/api/testnet/vaults/${view.id}/observe`, {
          operationId: pending.operationId,
          transactionHash: next.hash,
        });
      localStorage.setItem(key, JSON.stringify(next));
      setPending(next);
      setNotice('已记录待核验哈希。');
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vault-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">独立用户账户</p>
          <h2>{view.id}</h2>
          <p className="muted">
            执行服务：{view.execution?.state ?? 'NOT_CONFIGURED'}。池报价超过授权滑点时暂停成交。
          </p>
        </div>
        <span className="pill">
          {snapshot?.closed
            ? '已关闭'
            : snapshot?.liquidating
              ? '清仓中'
              : view.status === 'HEALTHY'
                ? '已对账'
                : view.status}
        </span>
      </div>
      {!readReady && (
        <p className="notice" role="status">
          账户读取尚未完成或已过期。以下为缓存状态，新交易预览与确认已暂停；刷新只读取状态。
        </p>
      )}
      <p className="address">Vault · {view.manifest.vault}</p>
      {!snapshot ? (
        <p>等待链上身份验证与历史同步，暂不可操作。</p>
      ) : (
        <>
          <dl className="metrics">
            <div>
              <dt>总资产 AF-USDC</dt>
              <dd>{money(snapshot.vaultEquity)}</dd>
            </div>
            <div>
              <dt>个人累计盈亏</dt>
              <dd>{money(view.performance?.pnlUsdc)}</dd>
            </div>
            <div>
              <dt>本金容量</dt>
              <dd>{money(snapshot.principalBasis)}</dd>
            </div>
            <div>
              <dt>锁定 PASS</dt>
              <dd>{money(snapshot.lockedPass, 18)}</dd>
            </div>
            <div>
              <dt>闲置现金</dt>
              <dd>{money(snapshot.idleCash)}</dd>
            </div>
            <div>
              <dt>单位净值 AF-USDC</dt>
              <dd>{money(snapshot.unitNav)}</dd>
            </div>
            <div>
              <dt>策略现金</dt>
              <dd>{money(snapshot.runtimeCash)}</dd>
            </div>
          </dl>
          <table>
            <thead>
              <tr>
                <th>测试标的</th>
                <th>持仓</th>
                <th>参考中间价</th>
                <th>已核验持仓成本 AF-USDC</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.stocks.map((s) => (
                <tr key={s.token}>
                  <td>{s.symbol}</td>
                  <td>{money(s.position, 18)}</td>
                  <td>{s.priceValid ? money(s.priceUsdc) : '报价过期'}</td>
                  <td>
                    {money(view.performance?.positions.find((p) => p.stock === s.token)?.costBasisUsdc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            个人盈亏由已核验资金流、成交和持仓复算。DEX 费用与价格影响计入实际成交；执行者支付的 ETH gas
            单独记录。参考价用于估值，V3 成交价用于记账。当前 API 未提供已核验的平台 gas
            金额，页面不推算该金额。
          </p>
          <details>
            <summary>执行权限与链上证据</summary>
            <p className="address">执行地址：{snapshot.grant.executor}</p>
            <p>
              到期：
              {snapshot.grant.expiresAt === '0'
                ? '未授权'
                : new Date(Number(snapshot.grant.expiresAt) * 1000).toLocaleString()}{' '}
              · 单笔上限 {money(snapshot.grant.maxOrderUsdc)} AF-USDC · 累计买入上限{' '}
              {money(snapshot.grant.maxTotalBuyUsdc)} AF-USDC · 最大滑点 {snapshot.grant.maxSlippageBps} bps
            </p>
            <p>
              区块 {snapshot.blockNumber} · {snapshot.valuation === 'VALID' ? '估值有效' : '估值暂停'}
            </p>
            <p className="address">{snapshot.blockHash}</p>
            <p>仅 L2 软确认，未证明 L1 最终性。</p>
          </details>
          {intentBlocked ? (
            <p role="alert">待确认记录需要人工核对。页面保留原记录并阻止新提交。</p>
          ) : pending ? (
            <div className="review">
              <h3>待核验交易 · {labels[pending.kind]}</h3>
              <p>
                {testnetOperationMessage(operation?.state, operation?.productReady)}
                。这笔交易未完成核验前，页面不会重复发送。
              </p>
              {pending.hash ? (
                <a
                  href={`${'https://explorer.testnet.chain.robinhood.com'}/tx/${pending.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看交易哈希
                </a>
              ) : (
                <>
                  <p>请从钱包历史中找到本次交易哈希，填入后继续核验。没有哈希时联系部署者，不要重新提交。</p>
                  <input
                    aria-label="恢复交易哈希"
                    value={recoveryHash}
                    onChange={(e) => setRecoveryHash(e.target.value)}
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      void recover();
                    }}
                  >
                    核验已有交易
                  </button>
                </>
              )}
              {operation?.failedFinalConfirmed && (
                <p>
                  链上已核验本次交易失败，资金状态未按本次调用改变。历史记录仍保留。
                  <button
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        try {
                          await client.assertOwner(identity());
                          const latest = (await testnetApi(
                            `/api/testnet/vaults/${view.id}/operations/${pending.operationId}`,
                          )) as { failedFinalConfirmed?: boolean };
                          if (!latest.failedFinalConfirmed) throw new Error('STALE_PREVIEW');
                          localStorage.removeItem(key);
                          setPending(null);
                          setPrepared(null);
                          setOperation(null);
                          await onRefresh();
                        } catch (error) {
                          setNotice(message(error));
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    已核对失败，重新预览
                  </button>
                </p>
              )}
              {pending.operationId === null && (
                <p>
                  代币授权由钱包确认；下一次存入仍由合约检查额度。
                  <button
                    disabled={busy || !pending.hash}
                    onClick={() => {
                      localStorage.removeItem(key);
                      setPending(null);
                      void onRefresh();
                    }}
                  >
                    已在钱包核对授权，继续
                  </button>
                </p>
              )}
            </div>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void preview();
                }}
              >
                <label>
                  账户操作
                  <select
                    value={kind}
                    onChange={(e) => {
                      setFields({ kind: e.target.value, boundMode: 'PERCENT' });
                      setPrepared(null);
                    }}
                  >
                    {Object.entries(labels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {['DEPOSIT', 'WITHDRAW', 'ALLOCATE', 'DEALLOCATE', 'APPROVE_PASS', 'APPROVE_USDC'].includes(
                  kind,
                ) && field('amount', '金额（AF-USDC，最多 6 位小数）')}
                {kind === 'DEPOSIT' && (
                  <p className="muted">
                    存入前分别确认 AF-USDC 与 PASS 额度。1 AF-USDC 本金容量锁定 1 PASS；利润不增加 PASS 占用。
                  </p>
                )}
                {kind === 'WITHDRAW' && (
                  <p className="muted">
                    先提利润，再退出本金容量并解锁 PASS。有已记账持仓时不能部分提取本金。
                  </p>
                )}
                {kind === 'DEALLOCATE' && (
                  <p className="muted">
                    仅撤回已有策略现金；现金不足会拒绝，不自动卖出持仓。这一步不解锁 PASS。
                  </p>
                )}
                {kind === 'AUTHORIZE' && (
                  <div className="form-grid">
                    {field('executor', '平台受限执行地址')}
                    {field('expiresAt', '到期时间（Unix 秒）')}
                    {field('liquidationWindow', '事先授权清仓期限（秒）')}
                    {field('maxOrder', '单笔上限（AF-USDC）')}
                    {field('maxTotal', '累计买入上限（AF-USDC）')}
                    {field('maxSlippageBps', '最大滑点（bps，100 bps = 1%）')}
                  </div>
                )}
                {kind === 'BOUNDS' && (
                  <>
                    <label>
                      组合清仓上下限
                      <select
                        value={fields.boundMode}
                        onChange={(e) => {
                          setFields({ ...fields, boundMode: e.target.value });
                          setPrepared(null);
                        }}
                      >
                        <option value="PERCENT">相对当前单位净值百分比</option>
                        <option value="ABSOLUTE">具体单位净值</option>
                      </select>
                    </label>
                    <div className="form-grid">
                      {field('lower', fields.boundMode === 'PERCENT' ? '亏损触发幅度（%）' : '单位净值下限')}
                      {field('upper', fields.boundMode === 'PERCENT' ? '盈利触发幅度（%）' : '单位净值上限')}
                      {snapshot.stocks.flatMap((s) => [
                        field('lower' + s.symbol, s.symbol + ' 参考价格下限（AF-USDC）'),
                        field('upper' + s.symbol, s.symbol + ' 参考价格上限（AF-USDC）'),
                      ])}
                    </div>
                    <p className="muted">
                      空白或 0
                      关闭该项。百分比以本次预览的单位净值为基准，资金追加／撤回按单位净值核算；触碰任一有效上下限后进入卖出清仓。
                    </p>
                  </>
                )}
                {kind === 'STOP' && (
                  <p>确认后立刻停止新增买入并清仓。成交需要有效行情和可用流动性；页面会保留未完成仓位。</p>
                )}
                {kind === 'REVOKE' && (
                  <p>撤销执行地址后，平台不能继续自动清仓。剩余仓位可由 owner 手动恢复卖出。</p>
                )}
                {kind === 'CLOSE' && (
                  <p>须先清空全部已记账持仓；剩余资产退回 owner，剩余本金容量归零，全部锁定 PASS 返还。</p>
                )}
                {kind === 'RESCUE_TOKEN' && field('token', '意外转入代币地址')}
                {kind === 'RECOVERY_SELL' && (
                  <>
                    <label>
                      卖出测试标的
                      <select
                        value={fields.stock ?? ''}
                        onChange={(e) => {
                          setFields({ ...fields, stock: e.target.value });
                          setPrepared(null);
                        }}
                      >
                        <option value="">选择标的</option>
                        {snapshot.stocks.map((s) => (
                          <option key={s.token} value={s.token}>
                            {s.symbol}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field('amount', '卖出数量（最多 18 位小数）')}
                    {field('minimum', '最低收到 AF-USDC')}
                    {field('deadline', '订单截止时间（Unix 秒）')}
                    <p className="muted">
                      仅由 owner 签署卖出；不增加平台权限。最低收到金额需与最新池报价核对。
                    </p>
                  </>
                )}
                <button disabled={busy || !readReady || view.status !== 'HEALTHY'} type="submit">
                  {busy ? '处理中…' : '预览待签交易'}
                </button>
              </form>
              {prepared && (
                <div className="review">
                  <h3>确认 · {labels[kind]}</h3>
                  <p>网络：Robinhood Testnet（46630）</p>
                  <p className="address">发送者：{prepared.value.transaction.from}</p>
                  <p className="address">合约：{prepared.value.transaction.to}</p>
                  <p>ETH 转账金额：0；钱包会另外提示网络费用。</p>
                  <pre>{JSON.stringify(prepared.input, null, 2)}</pre>
                  <details>
                    <summary>查看准确调用数据</summary>
                    <p className="address">{prepared.value.transaction.data}</p>
                  </details>
                  <button
                    disabled={busy || !readReady}
                    onClick={() => {
                      void confirm();
                    }}
                  >
                    在 owner 钱包中确认
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => setPrepared(null)}>
                    取消预览
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
    </section>
  );
}
export function TestnetPage() {
  const [client, setClient] = useState<TestnetWalletClient | null>(null);
  const [reader] = useState(
    () => new TestnetAccountReader<VaultView>(() => testnetApi('/api/testnet/vaults')),
  );
  const [account, setAccount] = useState(reader.snapshot);
  const [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const owner = account.owner,
    vaults = account.vaults;
  const viewEpoch = useRef(0);
  useEffect(() => reader.subscribe(setAccount), [reader]);
  const refresh = useCallback(async () => {
    await reader.refresh();
  }, [reader]);
  useEffect(() => {
    const provider = (window as unknown as { ethereum?: Provider }).ethereum;
    if (!provider) return;
    const wallet = new TestnetWalletClient(provider);
    setClient(wallet);
    const invalidate = () => {
      ++viewEpoch.current;
      reader.connect(null);
      setNotice('钱包账户或网络已变化，请重新登录。');
      void wallet.logout().catch(() => {});
    };
    provider.on?.('accountsChanged', invalidate);
    provider.on?.('chainChanged', invalidate);
    return () => {
      provider.removeListener?.('accountsChanged', invalidate);
      provider.removeListener?.('chainChanged', invalidate);
    };
  }, [reader]);
  useEffect(() => {
    if (!owner) return;
    return pollTestnetAccount(reader);
  }, [owner, reader]);
  const login = async () => {
    if (!client) {
      setNotice('请使用支持 Ethereum 的浏览器钱包。');
      return;
    }
    setBusy(true);
    setNotice('');
    const epoch = ++viewEpoch.current;
    reader.connect(null);
    try {
      const identity = await client.login();
      if (epoch !== viewEpoch.current) return;
      reader.connect(identity);
      await refresh();
    } catch (error) {
      if (epoch === viewEpoch.current) setNotice(message(error));
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    ++viewEpoch.current;
    reader.connect(null);
    try {
      await client?.logout();
    } catch (error) {
      setNotice(message(error));
    }
  };
  const backup = async () => {
    setBusy(true);
    try {
      const result = (await testnetApi('/api/testnet/backups', {})) as { state: string; createdAt: number };
      setNotice(
        result.state === 'VERIFIED'
          ? `备份已验证：${new Date(result.createdAt).toLocaleString()}`
          : '备份尚未验证。',
      );
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="testnet-shell" data-testnet-phase={account.phase}>
      <a className="skip-link" href="#owner-steps">
        跳到 owner 操作步骤
      </a>
      <header>
        <a className="brand" href="/">
          AlphaForge<span>TESTNET</span>
        </a>
        <div>
          {owner ? (
            <>
              <span className="connected">
                {owner.slice(0, 8)}…{owner.slice(-4)}
              </span>
              <button
                className="secondary"
                onClick={() => {
                  void logout();
                }}
              >
                退出
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={() => {
                void login();
              }}
            >
              {busy ? '等待钱包…' : '连接钱包并登录'}
            </button>
          )}
        </div>
      </header>
      <section className="intro">
        <p className="eyebrow">独立托管 · 有限策略授权</p>
        <h1>
          你的策略资金，
          <br />
          由你的钱包控制。
        </h1>
        <p>
          Robinhood Testnet 上验证 Vault、V3 交易和个人绩效。MSFT、NVDA、AAPL
          为真实行情映射的测试替身，不是官方 Stock Token；测试资产无真实资金价值。
        </p>
      </section>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <nav className="owner-journey" aria-label="Testnet owner steps" id="owner-steps" tabIndex={-1}>
        <h2>Owner 操作路径</h2>
        <ol>
          <li>连接普通 EOA 钱包并登录；等待你的 Vault 部署证据与链上核验。</li>
          <li>分别授权 AF-USDC 与 PASS，再存入并分配策略资金。</li>
          <li>填写有限执行地址、到期、清仓窗口、买入预算与滑点；预览后在钱包确认。</li>
          <li>查看已有交易核验、持仓、个人净值及平台 ETH gas 记录。哈希不等于成交。</li>
          <li>停止进入清仓；撤销权限后由 owner 恢复卖出。持仓清空后关闭并取回剩余 PASS。</li>
        </ol>
      </nav>
      {owner && (
        <p role="status" data-testnet-read-state>
          {account.phase === 'LOADING'
            ? '正在读取 owner 账户，请等待。'
            : account.phase === 'STALE' || account.phase === 'DISCONNECTED'
              ? '账户服务暂不可用。缓存不代表当前链上状态；请刷新，页面不会重复发送交易。'
              : account.phase === 'EMPTY'
                ? '读取已完成：该 owner 尚无已配置 Vault。'
                : '当前 owner 账户读取已完成。'}
        </p>
      )}
      {owner ? (
        <>
          <div className="section-title">
            <h2>我的 Vault</h2>
            <div>
              <button
                className="secondary"
                disabled={busy || account.phase !== 'READY' || !vaults.length}
                onClick={() => {
                  void backup();
                }}
              >
                备份并验证
              </button>
              <button
                className="secondary"
                onClick={() => {
                  void refresh().catch((error) => setNotice(message(error)));
                }}
              >
                刷新链上状态
              </button>
            </div>
          </div>
          {vaults.length ? (
            vaults.map((view) => (
              <VaultCard
                key={view.manifest.manifestDigest + owner}
                view={view}
                client={client!}
                onRefresh={refresh}
                readReady={account.phase === 'READY'}
              />
            ))
          ) : account.phase !== 'EMPTY' ? (
            <section className="vault-card">
              <h2>{account.phase === 'LOADING' ? '正在读取 Vault' : 'Vault 读取未完成'}</h2>
              <p>尚未取得有效账户列表，不能据此判断账户为空。请刷新链上状态。</p>
            </section>
          ) : (
            <section className="vault-card">
              <h2>尚无已配置的 Vault</h2>
              <p>
                登录已完成。部署者需要提供与你的 owner
                地址绑定的测试网部署证据，完成链上核验后账户会出现在这里。
              </p>
            </section>
          )}
        </>
      ) : (
        <section className="vault-card">
          <h2>连接 owner 钱包开始</h2>
          <p>登录签名只用于确认身份。存款、提款和执行授权分别由钱包签署，不会因登录自动授予交易权限。</p>
        </section>
      )}
      <footer>
        <p>
          个人测试网收益与公开策略业绩分开记录。Builder
          发布、销售、租金、绩效收费、回购和二级市场商业结算：本轮为模拟展示。策略加密不在本次范围。
        </p>
      </footer>
    </main>
  );
}
