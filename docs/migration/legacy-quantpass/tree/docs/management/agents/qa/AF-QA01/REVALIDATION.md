# AF-QA01 F01–F03 / Q01 Independent Revalidation

Agent: Macbeth05 · Task: AF-QA01 · Status: READY FOR REVIEW

## Exact inputs

- Original SHA: `708ab59181fe7b372c89f866125a1ffa26cef5be`。
- Intermediate Fix SHA: `0beef3ad9608dcc676c73fdb287f1dd90e29fd16`。
- **Final Fix SHA: `f66faa10c2a22f56048b04416cd83a2e8e9dd481`**。
- Frozen Contract: `73230c43e464cd1b579fa16a6425756291ef9e8e`。
- [Q01 决策与原始 Finding 确认](https://github.com/pdbsy/quantpass/pull/8#issuecomment-5646423661)。
- [作者初始 Fix 交付](https://github.com/pdbsy/quantpass/pull/7#issuecomment-5646442419)；最终 Fix 由后续用户协调消息指定，已通过 PR #7 head 和 Git 实际提交核验。
- [Macbeth05 真实复验结果](https://github.com/pdbsy/quantpass/pull/6#issuecomment-5646507616)。

## Environment and isolation

Worker root：`<SOURCE_ROOT>`。

本 Worker 使用 git archive 展开两个准确提交到自己的 `.checks/af-qa01/candidates/<SHA>`；这是公开源码快照，不是其他 Worker 的工作区。Node `v24.21.0` / npm `11.19.1` 由既有 fnm 提供，满足仓库 engines；与作者 Node24.12.0/npm11.6.2 不同，未伪称相同环境。`npm ci --ignore-scripts --no-audit --no-fund --cache .checks/npm-cache` 实际安装 192 包，缓存及依赖仅在自身工作区。未执行依赖审计，不因安装成功声称 audit PASS。

两个候选的 package-lock.json 均与安装基准 master `0a813de422a02a2b3f0ade7eee693f0d2491ec33` 完全一致。测试通过正常 Fastify app.inject 请求和真实本地 SQLite 运行；没有启动外部网络监听或访问真实账户。每次 harness 用 mkdtemp 创建自己的虚构 Alice/Bob 数据，finally/after 关闭应用。

最终测试后逐 blob 比较公开 Git tree 与快照的 117 个文件，全部一致。测试只新增忽略目录内的临时数据；未修改候选源码或作者测试来取得通过。

## 实际执行

1. `0beef3ad`：独立运行作者的 product-api.test.ts，14/14 通过；QA 自编补充脚本 5 组通过。
2. 收到最终 `f66faa10c2a22f56048b04416cd83a2e8e9dd481` 后，独立比较 diff：仅四个 docs/test 文件变化，其中新增 43 行正常回读/终态审计测试；生产代码未变。仍重新展开并完整重跑，未继承旧 PASS。
3. 在最终快照目录运行：

```sh
fnm exec --using v24.21.0 -- node --test test/product-api.test.ts
```

真实结果：15 tests、15 pass、0 fail、0 skipped，退出码 0。包含 canonical resources、pending、错误、分页、兼容、持久化/备份和已有防御性状态校验测试。作者写的测试已由本 Worker 先阅读再独立执行，和单纯引用作者结果区分。

4. 在 Worker root 运行 QA 自己编写的正常功能断言：

```sh
fnm exec --using v24.21.0 -- node .checks/af-qa01/revalidate-f01-f03-final.mjs
```

真实结果：5 组通过，退出码 0；原始源码完整附在本文末尾，执行前只把候选路径从 0beef3ad 改为最终 SHA，断言未更改。

## Finding revalidation

| Finding | Original SHA | Fix SHA | Revalidation | 精确证据/范围 |
| --- | --- | --- | --- | --- |
| F01 | `708ab59181fe7b372c89f866125a1ffa26cef5be` | `f66faa10c2a22f56048b04416cd83a2e8e9dd481` | PASS / RESOLVED | canonical 空账户必要字段、not_started/null；两个策略领取后关系、Pass whole units/allowance 均核对；legacy account 兼容有作者回归 |
| F02 | `708ab59181fe7b372c89f866125a1ffa26cef5be` | `f66faa10c2a22f56048b04416cd83a2e8e9dd481` | PASS / RESOLVED | 实际 deposit/allocate/start/reserve/withdraw/stop 得到小写 order/withdrawal/pending、operationId、字符串金额；stopping 无 STOP 项；取消/完成后 live 集合移除，终态留 audit |
| F03 | `708ab59181fe7b372c89f866125a1ffa26cef5be` | `f66faa10c2a22f56048b04416cd83a2e8e9dd481` | PASS / RESOLVED | 原未批准错误码已从实现移除；正常缺失资源、未登录、无效参数和未知路由返回冻结 error 值；canonical envelope 与 legacy 可选元数据分开 |

三个 Finding 关闭仅针对最终准确 Fix SHA，不代表任何后续提交或其他审阅范围通过。

## Q01 canonical / legacy

- `/api/v1/strategies` 与 `/api/v1/vaults`：items/nextCursor，limit 1/100、正常 opaque cursor 原样续页，无重复；0/101 拒绝。
- 构造 51 条正常账本命令的 audit：canonical 默认返回 50 条（revision 51..2），nextCursor 原样续页得到 revision 1，重复读取逻辑一致；显式 limit 1/100 分别返回 1/51。
- 同一 ledger 的 legacy audit 无参数返回 51 条，证明没有错误改成 canonical 50 默认；旧数组字段、core-only 默认和两策略显式访问由专项回归覆盖。
- 读取 canonical routes 的默认值均为 50。策略和 vault 当前只有两个登记项，运行结果不能单独证明其 50 条截断边界；audit 51 条场景提供了实际截断证据。未虚构 51 个策略。

## Test log and reproducibility

最终 product suite 日志 SHA-256：`68f579efc65bb8350a38cbef141c1c9c682adaceeba516bd3936fc948ec768c8`。

```text
✔ AF-BE01 versioned catalog supplies matching detail and only registered simulations (91.324167ms)
✔ AF-BE01 account totals are exact and independent of vault pagination and other owners (31.689625ms)
✔ AF-BE01 strategy-scoped vault lookup and duplicate claims preserve separate ledgers (21.255125ms)
✔ AF-BE01 product balances and pending operations follow real ledger transitions (18.934792ms)
✔ AF-BE01 list and audit pagination are bounded and reject malformed pagination (16.772041ms)
✔ AF-BE01 structured errors and exact input bounds preserve economic state (16.198666ms)
✔ AF-BE01 damaged account data returns a generic failure without partial totals (12.9685ms)
✔ AF-BE01 account and strategy views survive restart and legacy SQLite backup (36.449167ms)
✔ AF-BE01 six UI fixtures match real API journeys and preserve pending/stop meaning (76.098875ms)
✔ AF-BE01 legacy vault list stays core-bound with satellite-only and mixed accounts (11.622666ms)
✔ AF-BE01 frozen canonical resources bind absence, passes, balances and pending operations (13.843083ms)
✔ AF-BE01 canonical opaque cursors continue deterministic pages and reject invalid binding (21.504792ms)
✔ AF-BE01 canonical errors are exactly the frozen envelope at every boundary (12.459ms)
✔ AF-BE01 invalid persisted state is internal even when its digest matches (10.512375ms)
✔ AF-BE01 canonical readback and terminal audit preserve completed and cancelled operations (15.685041ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 530.216125
```

QA 脚本 SHA-256：`ca2361d24aa1107faee2e7265d319639a876f049b8e81c66e878d987dbdb8032`。

QA 输出 SHA-256：`5acc6bb836e37fc7cca7ed631095cdf0d8c831a83c15c5978f7f8f4c91b886da`。

```text
PASS F01 canonical empty/claimed multi-strategy account and Pass units
PASS F02 exact pending shape, stopping has no STOP item, terminal operations removed
PASS F03 ordinary canonical and legacy missing-resource errors use frozen codes
PASS Q01 canonical audit default 50/continuation/order vs legacy default 100 on 51 events
PASS Q01 canonical collections, limit bounds, opaque cursor roundtrip and legacy arrays
RESULT 5 independent QA groups passed; Fix SHA f66faa10c2a22f56048b04416cd83a2e8e9dd481
```

日志保存在本 Worker `.checks/af-qa01/`，没有 cookie、秘密或其他 Worker 数据。下方脚本可从附录保存为命令指定路径，在自己的同布局快照/锁定依赖目录重现；不是产品代码。

## Coverage limits

Browser verification: NOT RUN。没有浏览器、外部网络 smoke test、进程级 server restart、Forge、完整安全扫描、全部根工程 check/gates 或最终跨 PR 组合套件运行声明。已有测试对应用实例/store 重建、备份与防御性状态失败的专项通过，不自动等价于生产安全审计。

Open findings: 0；Resolved findings: 3。Backend 专项修复 READY FOR REVIEW。整体 Integration recommendation: BLOCKED，仍待 UI/Chain 候选、组合 SHA 和剩余独立验收。

## QA supplement source

```js
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const candidate = resolve('.checks/af-qa01/candidates/f66faa10c2a22f56048b04416cd83a2e8e9dd481');
process.chdir(candidate);
const { productHarness } = await import(pathToFileURL(resolve('test/helpers/product-api.ts')));
const h = await productHarness();
const check = (label) => process.stdout.write(`PASS ${label}\n`);
try {
  const cookie = await h.login();
  async function read(url, payload) {
    const response = await h.request(cookie, url, payload);
    assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
    return response.json();
  }
  const empty = await read('/api/v1/account');
  assert.equal(empty.schemaVersion, 1);
  assert.equal(empty.scope, 'TEST_ONLY');
  assert.equal(empty.ownerId, 'alice');
  assert.ok(empty.strategies.length >= 2);
  for (const item of empty.strategies) {
    assert.equal(item.ownerId, 'alice');
    assert.equal(item.vaultId, null);
    assert.equal(item.status, 'not_started');
  }
  for (const pass of empty.passBalances) {
    assert.equal(pass.total, '0');
    assert.equal(pass.allowance, '0');
  }
  let vault = await read('/api/v1/vaults', { strategyId: 'core-flow-demo' });
  const satellite = await read('/api/v1/vaults', { strategyId: 'satellite-flow-demo' });
  const account = await read('/api/v1/account');
  for (const state of [vault, satellite]) {
    assert.equal(account.strategies.find((s) => s.strategyId === state.strategyId).vaultId, state.vaultId);
    const pass = account.passBalances.find((p) => p.strategyId === state.strategyId);
    assert.equal(pass.total, '1000');
    assert.equal(pass.allowance, '1000000000');
    assert.equal(BigInt(pass.allowance), BigInt(pass.total) * 1000000n);
  }
  check('F01 canonical empty/claimed multi-strategy account and Pass units');
  async function command(id, type, fields = {}) {
    const result = await read(`/api/v1/vaults/${vault.vaultId}/commands`, {
      id, type, expectedRevision: vault.revision, ...fields,
    });
    vault = result.vault;
  }
  await command('qa-deposit', 'deposit', { amount: '1500000000' });
  await command('qa-allocate', 'allocate', { amount: '1000000000' });
  await command('qa-start', 'start');
  await command('qa-reserve', 'reserveBuy', { orderId: 'qa-order', amount: '200000000' });
  await command('qa-withdraw', 'requestWithdrawal', { amount: '500000000' });
  await command('qa-stop', 'stop');
  assert.equal(vault.status, 'stopping');
  assert.deepEqual(vault.pendingOperations.slice().sort((a, b) => a.kind.localeCompare(b.kind)), [
    { operationId: 'qa-order', kind: 'order', status: 'pending', amount: '200000000' },
    { operationId: 'qa-withdraw', kind: 'withdrawal', status: 'pending', amount: '500000000' },
  ]);
  await command('qa-cancel-order', 'cancelOrder', { orderId: 'qa-order' });
  await command('qa-cancel-withdraw', 'cancelWithdrawal', { withdrawalId: 'qa-withdraw' });
  assert.deepEqual(vault.pendingOperations, []);
  check('F02 exact pending shape, stopping has no STOP item, terminal operations removed');
  for (const [identity, url, status, error] of [
    ['', '/api/v1/account', 401, 'SESSION_REQUIRED'],
    [cookie, '/api/v1/strategies/qa-missing', 409, 'UNKNOWN_STRATEGY'],
    [cookie, '/api/v1/vaults/qa-missing', 404, 'VAULT_NOT_FOUND'],
    [cookie, '/api/v1/vaults?limit=0', 400, 'INVALID_REQUEST'],
  ]) {
    const response = await h.request(identity, url);
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), { error });
  }
  assert.deepEqual((await h.request(cookie, '/api/v1/qa-missing-route')).json(), { error: 'INVALID_REQUEST' });
  assert.equal((await h.request(cookie, '/api/strategies/qa-missing')).json().error, 'UNKNOWN_STRATEGY');
  assert.equal((await h.request(cookie, '/api/qa-missing-route')).json().error, 'INVALID_REQUEST');
  check('F03 ordinary canonical and legacy missing-resource errors use frozen codes');
  while (vault.revision < 51) await command(`qa-page-${vault.revision}`, 'deposit', { amount: '1' });
  const auditPath = `/api/v1/vaults/${vault.vaultId}/audit`;
  const page = await read(auditPath);
  assert.equal(page.items.length, 50);
  assert.equal(page.items[0].revision, 51);
  assert.equal(page.items.at(-1).revision, 2);
  assert.equal(typeof page.nextCursor, 'string');
  const nextUrl = `${auditPath}?cursor=${encodeURIComponent(page.nextCursor)}`;
  const tail = await read(nextUrl);
  assert.deepEqual(tail.items.map((e) => e.revision), [1]);
  assert.equal(tail.nextCursor, null);
  assert.deepEqual(await read(nextUrl), tail);
  assert.equal((await read(`${auditPath}?limit=1`)).items.length, 1);
  assert.equal((await read(`${auditPath}?limit=100`)).items.length, 51);
  const legacyAudit = await read(`/api/vaults/${vault.vaultId}/audit`);
  assert.equal(legacyAudit.length, 51);
  assert.equal(legacyAudit[0].revision, 51);
  check('Q01 canonical audit default 50/continuation/order vs legacy default 100 on 51 events');
  for (const collection of ['/api/v1/strategies', '/api/v1/vaults']) {
    const first = await read(`${collection}?limit=1`);
    assert.equal(first.items.length, 1);
    assert.equal(typeof first.nextCursor, 'string');
    const second = await read(`${collection}?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    const key = collection.endsWith('/strategies') ? 'strategyId' : 'vaultId';
    assert.notEqual(first.items[0][key], second.items[0][key]);
    assert.equal((await read(`${collection}?limit=100`)).items.length, 2);
  }
  for (const collection of ['/api/v1/strategies', '/api/v1/vaults', auditPath]) {
    for (const limit of [0, 101]) {
      const result = await h.request(cookie, `${collection}?limit=${limit}`);
      assert.equal(result.statusCode, 400);
      assert.deepEqual(result.json(), { error: 'INVALID_REQUEST' });
    }
  }
  assert.ok(Array.isArray(await read('/api/strategies')));
  const legacyVaults = await read('/api/vaults');
  assert.deepEqual(legacyVaults.map((v) => v.vaultId), [vault.vaultId]);
  check('Q01 canonical collections, limit bounds, opaque cursor roundtrip and legacy arrays');
  process.stdout.write('RESULT 5 independent QA groups passed; Fix SHA f66faa10c2a22f56048b04416cd83a2e8e9dd481\n');
} finally {
  await h.app.close();
}
```
