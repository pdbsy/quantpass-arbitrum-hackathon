import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Interface, Transaction, Wallet, getCreateAddress, id } from 'ethers';
import { ROBINHOOD_CHAIN_TESTNET } from '../packages/robinhood-chain/src/network.ts';
import { prepareDeployment } from '../tools/launch-market/prepare.ts';
import { qualifyTargetArtifacts, targetPlanDigest } from '../tools/launch-market/target-preflight.ts';
import {
  DeploymentExecution,
  qualifyDeploymentExecution,
} from '../tools/launch-market/deployment-execution.mjs';

// Entirely offline: random memory keys, a synthetic RPC and synthetic receipts.
// The admission-shaped report is a test fixture, not new Slither scan evidence.
const repository = resolve(new URL('..', import.meta.url).pathname),
  now = Math.floor(Date.parse('2026-10-10T05:00:00Z') / 1000),
  review = JSON.parse(
    readFileSync(resolve(repository, 'contracts/deployment/slither-admissions.json'), 'utf8'),
  ),
  report = {
    success: true,
    error: null,
    results: {
      detectors: review.findings.map((finding) => {
        const [parent, name] = finding.function.split('.');
        const elementType = finding.elementType ?? 'function';
        return {
          id: finding.id,
          check: finding.check,
          impact: finding.impact,
          confidence: finding.confidence,
          elements: [
            {
              type: elementType,
              name: elementType === 'contract' ? finding.function : name,
              type_specific_fields: { parent: { name: parent } },
              source_mapping: {
                filename_relative: review.findingSourcePaths[finding.id].replace(/^contracts\//, ''),
              },
            },
          ],
        };
      }),
    },
  };
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = (value) => '0x' + BigInt(value).toString(16);
const lower = (value) => value?.toLowerCase() ?? null;

async function setup({ distinctAdmin = false, changes = {} } = {}) {
  const deployer = Wallet.createRandom(),
    administrator = distinctAdmin ? Wallet.createRandom() : deployer;
  const inputs = {
    chainId: 46630,
    deployer: deployer.address,
    administrator: administrator.address,
    nonce: 0,
    quoteSigner: Wallet.createRandom().address,
    claimSigner: Wallet.createRandom().address,
    tslaLpRecipient: '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf',
    amznLpRecipient: '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf',
    usdcSupplyRaw: '2000000000000',
    conversionUsdcRaw: '100000000000',
    conversionEthRaw: '2000000000000000',
    stockReserveUsdcRaw: '100000000000',
    stockReserveUnitsRaw: '500000000000000000000000',
    ethPerTransactionRaw: '200000000000000',
    ethPerAccountDailyRaw: '1000000000000000',
    ethGlobalDailyRaw: '1600000000000000',
    ethMinimumReserveRaw: '200000000000000',
    ...changes,
  };
  const plan = await prepareDeployment(inputs);
  const budget = {
    maxGasPerTransactionRaw: '8000000',
    maxFeePerGasRaw: '20000000',
    maxPriorityFeePerGasRaw: '0',
    maxTotalGasCostWei: '7000000000000000',
    maxTotalNativeValueWei: '2000000000000000',
    minimumRemainingEthRaw: '500000000000000',
    maxHeadAgeSeconds: 60,
  };
  const approval = {
    chainId: 46630,
    environment: 'ONCHAIN_TESTNET',
    authorization: 'I_AUTHORIZE_FAIR_LAUNCH_DEPLOYMENT_46630',
    approvalRef: 'OFFLINE_TEST_FIXTURE_NOT_USER_AUTHORIZATION',
    expiresAt: now + 3600,
    planDigest: targetPlanDigest(plan),
    inputsDigest: targetPlanDigest(inputs),
    budgetDigest: targetPlanDigest(budget),
    artifactDigest: qualifyTargetArtifacts(repository).digest,
    slitherReportSha256: sha(report),
    slitherReviewSha256: sha(review),
  };
  const qualification = { plan, inputs, budget, approval, report, review, repository, now };
  const qualified = await qualifyDeploymentExecution(qualification);
  const root = mkdtempSync(resolve(tmpdir(), 'alphaforge-deployment-test-')),
    journalDirectory = resolve(root, 'journal'),
    nonceDirectory = resolve(root, 'nonce');
  mkdirSync(nonceDirectory, { mode: 0o700 });
  const fixture = {
    head: 100n,
    time: now,
    chainId: '0xb626',
    nonces: new Map(),
    codes: new Set(),
    receipts: new Map(),
    transactions: new Map(),
    calls: [],
    signCount: 0,
    sendCount: 0,
    sendFailure: false,
    revert: false,
    verificationFailure: false,
    reorgBlock: null,
    balance: 10n ** 18n,
    estimate: 1000000n,
    executionLimit: 32000000n,
  };
  const blockHash = (number) => id('offline block ' + String(number));
  const rpc = {
    endpoint: ROBINHOOD_CHAIN_TESTNET.rpcUrl,
    request: async (method, params) => {
      fixture.calls.push({ method, params });
      switch (method) {
        case 'eth_chainId':
          return fixture.chainId;
        case 'eth_getBlockByNumber': {
          const number = params[0] === 'latest' ? fixture.head : BigInt(params[0]);
          return {
            number: hex(number),
            hash: number === fixture.reorgBlock ? id('offline reorg') : blockHash(number),
            timestamp: hex(fixture.time),
          };
        }
        case 'eth_getTransactionCount':
          return hex(fixture.nonces.get(lower(params[0])) ?? 0n);
        case 'eth_getBalance':
          return hex(fixture.balance);
        case 'eth_gasPrice':
          return '0x989680';
        case 'eth_call':
          return new Interface([
            'function getGasAccountingParams() view returns(uint256,uint256,uint256)',
          ]).encodeFunctionResult('getGasAccountingParams', [7000000, 32000000, fixture.executionLimit]);
        case 'eth_estimateGas':
          return hex(fixture.estimate);
        case 'eth_getCode':
          return fixture.codes.has(lower(params[0])) ? '0x6000' : '0x';
        case 'eth_getTransactionReceipt':
          return fixture.receipts.get(params[0]) ?? null;
        case 'eth_getTransactionByHash':
          return fixture.transactions.get(params[0]) ?? null;
        case 'eth_sendRawTransaction': {
          fixture.sendCount++;
          const raw = params[0],
            parsed = Transaction.from(raw);
          // Observe the actual private journal before the injected send executes.
          const db = new DatabaseSync(resolve(journalDirectory, 'fair-launch-deployment.sqlite'), {
            readOnly: true,
          });
          try {
            const row = db
              .prepare('SELECT * FROM deployment_actions WHERE transaction_hash=?')
              .get(parsed.hash);
            assert.equal(row.state, 'BROADCAST_UNCERTAIN');
            assert.equal(row.raw_transaction, raw);
            assert.equal(row.transaction_hash, parsed.hash);
          } finally {
            db.close();
          }
          fixture.head++;
          const receipt = {
            transactionHash: parsed.hash,
            from: lower(parsed.from),
            to: lower(parsed.to),
            status: fixture.revert ? '0x0' : '0x1',
            gasUsed: hex(fixture.estimate),
            effectiveGasPrice: '0x989680',
            blockNumber: hex(fixture.head),
            blockHash: blockHash(fixture.head),
            contractAddress: parsed.to
              ? null
              : lower(getCreateAddress({ from: parsed.from, nonce: parsed.nonce })),
            logs: [],
          };
          fixture.receipts.set(parsed.hash, receipt);
          fixture.transactions.set(parsed.hash, {
            hash: parsed.hash,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash,
            from: lower(parsed.from),
            to: lower(parsed.to),
            input: parsed.data,
            chainId: hex(parsed.chainId),
            type: hex(parsed.type),
            nonce: hex(parsed.nonce),
            value: hex(parsed.value),
            gas: hex(parsed.gasLimit),
            maxFeePerGas: hex(parsed.maxFeePerGas),
            maxPriorityFeePerGas: hex(parsed.maxPriorityFeePerGas),
          });
          fixture.nonces.set(lower(parsed.from), BigInt(parsed.nonce) + 1n);
          if (receipt.contractAddress && !fixture.revert) fixture.codes.add(receipt.contractAddress);
          if (fixture.sendFailure) throw new Error('offline transport uncertainty after mining');
          return parsed.hash;
        }
        default:
          throw new Error('Unexpected fixture RPC method');
      }
    },
  };
  const signers = [...new Set([deployer, administrator])].map((wallet) => ({
    address: wallet.address,
    sign: async (transaction) => {
      fixture.signCount++;
      // This key was generated in this isolated test, never a configured real key.
      return wallet.signTransaction({ ...transaction, nonce: Number(transaction.nonce), type: 2 });
    },
  }));
  const options = {
    qualified,
    rpc,
    signers,
    journalDirectory,
    nonceDirectory,
    now: () => fixture.time,
    verifyAction: async ({ index, receipt }) => {
      if (fixture.verificationFailure) throw new Error('offline verification failure');
      if (fixture.reorgAfterVerification) fixture.reorgBlock = BigInt(receipt.blockNumber);
      if (fixture.depthChangeAfterVerification) fixture.head = BigInt(receipt.blockNumber) + 1n;
      return {
        verified: true,
        actionIndex: index,
        planDigest: approval.planDigest,
        blockHash: receipt.blockHash,
      };
    },
  };
  const engine = new DeploymentExecution(options);
  return {
    engine,
    fixture,
    options,
    qualification,
    root,
    cleanup: () => {
      engine.close();
      rmSync(root, { recursive: true, force: true });
    },
    confirm: async (active = engine) => {
      fixture.head += 2n;
      return active.reconcile();
    },
  };
}

test('ordinary product wallet cannot become any privileged deployment, admin, signer or LP identity', async () => {
  const f = await setup();
  try {
    for (const role of [
      'deployer',
      'administrator',
      'quoteSigner',
      'claimSigner',
      'tslaLpRecipient',
      'amznLpRecipient',
    ]) {
      const q = structuredClone(f.qualification);
      q.inputs[role] = '0x5a2Acf1a388FE4f19aEfFA404e07E916B5b07B77';
      await assert.rejects(qualifyDeploymentExecution(q), /ORDINARY_USER_ROLE_FORBIDDEN/);
    }
    assert.equal(f.fixture.signCount, 0);
    assert.equal(f.fixture.sendCount, 0);
  } finally {
    f.cleanup();
  }
});

test('explicit inputs, exact approval, plan, artifacts, security and finite budgets are required', async () => {
  const f = await setup();
  try {
    for (const change of [
      (q) => {
        q.approval.chainId = 1;
      },
      (q) => {
        q.approval.environment = 'MAINNET';
      },
      (q) => {
        q.approval.expiresAt = now;
      },
      (q) => {
        q.approval.authorization = 'RESIDUAL_RISK_ACCEPTANCE_ONLY';
      },
      (q) => {
        q.plan.actions[0].unsigned.value = '1';
      },
      (q) => {
        q.inputs.usdcSupplyRaw = '2000000000001';
      },
      (q) => {
        q.approval.artifactDigest = id('wrong artifact');
      },
      (q) => {
        q.report.results.detectors.pop();
      },
      (q) => {
        q.approval.slitherReviewSha256 = '0'.repeat(64);
      },
      (q) => {
        q.budget.maxTotalGasCostWei = '1';
        q.approval.budgetDigest = targetPlanDigest(q.budget);
      },
      (q) => {
        q.budget.maxTotalNativeValueWei = '1';
        q.approval.budgetDigest = targetPlanDigest(q.budget);
      },
      (q) => {
        q.inputs.claimSigner = q.inputs.deployer;
      },
    ]) {
      const q = structuredClone(f.qualification);
      change(q);
      await assert.rejects(qualifyDeploymentExecution(q));
    }
    assert.throws(
      () => new DeploymentExecution({ ...f.options, qualified: structuredClone(f.options.qualified) }),
      /QUALIFICATION_REQUIRED/,
    );
    assert.throws(() => new DeploymentExecution({ ...f.options, signers: [] }), /SIGNER_IDENTITY/);
  } finally {
    f.cleanup();
  }
});

test('signed envelope is durable before one broadcast; three inclusive blocks and state verification gate progression', async () => {
  const f = await setup();
  try {
    const sent = await f.engine.next();
    assert.equal(sent.index, 0);
    assert.equal(sent.state, 'BROADCAST_UNCERTAIN');
    assert.equal((await f.engine.reconcile()).state, 'INCLUDED');
    await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
    f.fixture.head++;
    assert.equal((await f.engine.reconcile()).state, 'INCLUDED');
    f.fixture.head++;
    assert.equal((await f.engine.reconcile()).confirmedActions, 1);
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 1);
    assert.equal(JSON.stringify(f.engine.status()).includes('raw_transaction'), false);
  } finally {
    f.cleanup();
  }
});

test('uncertain broadcast recovers by the same hash after restart and never signs or sends again', async () => {
  const f = await setup();
  let reopened;
  try {
    f.fixture.sendFailure = true;
    await assert.rejects(f.engine.next(), /BROADCAST_UNCERTAIN/);
    const originalHash = f.engine.status().actions[0].transactionHash;
    f.engine.close();
    reopened = new DeploymentExecution(f.options);
    await assert.rejects(reopened.next(), /RECOVERY_REQUIRED/);
    const result = await f.confirm(reopened);
    assert.equal(result.actions[0].transactionHash, originalHash);
    assert.equal(result.confirmedActions, 1);
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 1);
  } finally {
    reopened?.close();
    f.cleanup();
  }
});

test('expired execution approval still permits watch-only confirmation with no signer or new broadcast', async () => {
  const f = await setup();
  let watcher;
  try {
    await f.engine.next();
    f.engine.close();
    f.fixture.time += 3601;
    await assert.rejects(qualifyDeploymentExecution({ ...f.qualification, now: f.fixture.time }), /APPROVAL/);
    const qualified = await qualifyDeploymentExecution({
      ...f.qualification,
      now: f.fixture.time,
      recoveryOnly: true,
    });
    watcher = new DeploymentExecution({ ...f.options, qualified, signers: [] });
    const result = await f.confirm(watcher);
    assert.equal(result.confirmedActions, 1);
    assert.equal(result.mode, 'WATCH_ONLY');
    await assert.rejects(watcher.next(), /WATCH_ONLY/);
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 1);
  } finally {
    watcher?.close();
    f.cleanup();
  }
});

test('unknown transaction remains recoverable by hash only and cannot be resent', async () => {
  const f = await setup();
  try {
    const sent = await f.engine.next();
    f.fixture.receipts.delete(sent.transactionHash);
    const outcome = await f.engine.reconcile();
    assert.equal(outcome.state, 'RECOVERY_REQUIRED');
    assert.equal(outcome.transactionHash, sent.transactionHash);
    await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 1);
  } finally {
    f.cleanup();
  }
});

test('wrong signed payload and mismatched canonical receipt cannot advance the plan', async () => {
  for (const kind of ['signature', 'receipt']) {
    const f = await setup();
    try {
      if (kind === 'signature') {
        const original = f.options.signers[0].sign;
        f.options.signers[0].sign = (transaction) => original({ ...transaction, value: '1' });
        await assert.rejects(f.engine.next(), /SIGNED_TRANSACTION/);
        assert.equal(f.engine.status().actions[0].state, 'RESERVED');
        assert.equal(f.fixture.sendCount, 0);
      } else {
        const sent = await f.engine.next();
        f.fixture.receipts.get(sent.transactionHash).transactionHash = id('wrong receipt');
        await assert.rejects(f.confirm(), /RECEIPT_MISMATCH/);
        await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
        assert.equal(f.fixture.sendCount, 1);
      }
    } finally {
      f.cleanup();
    }
  }
});

test('complete 41-action plan preserves all 15 CREATEs before configuration and is idempotent on restart', async () => {
  const f = await setup({ distinctAdmin: true });
  let reopened;
  try {
    for (let i = 0; i < 41; i++) {
      const sent = await f.engine.next();
      const action = f.qualification.plan.actions[sent.index];
      assert.equal(action.unsigned.to === null, i < 15);
      await f.confirm();
    }
    const finished = await f.engine.next();
    assert.equal(finished.state, 'EXECUTABLE_PLAN_CONFIRMED');
    assert.equal(finished.confirmedActions, 41);
    assert.equal(finished.references.length, 2);
    assert.ok(finished.references.every((entry) => entry.status.startsWith('NOT_RUN')));
    f.engine.close();
    reopened = new DeploymentExecution(f.options);
    assert.equal((await reopened.next()).confirmedActions, 41);
    assert.equal(f.fixture.signCount, 41);
    assert.equal(f.fixture.sendCount, 41);
    assert.equal(f.fixture.nonces.get(f.qualification.inputs.deployer.toLowerCase()), 15n);
    assert.equal(f.fixture.nonces.get(f.qualification.inputs.administrator.toLowerCase()), 26n);
  } finally {
    reopened?.close();
    f.cleanup();
  }
});

test('wrong network, exhausted funds, excessive gas, expiry and changed deployment nonce reject before signing', async () => {
  for (const change of [
    (f) => {
      f.chainId = '0x1';
    },
    (f) => {
      f.balance = 0n;
    },
    (f) => {
      f.estimate = 8000001n;
    },
    (f) => {
      f.executionLimit = 7999999n;
    },
    (f) => {
      f.time += 3601;
    },
    (f, q) => {
      f.nonces.set(q.inputs.deployer.toLowerCase(), 1n);
    },
  ]) {
    const f = await setup();
    try {
      change(f.fixture, f.qualification);
      await assert.rejects(f.engine.next());
      assert.equal(f.fixture.signCount, 0);
      assert.equal(f.fixture.sendCount, 0);
    } finally {
      f.cleanup();
    }
  }
});

test('expiry, nonce, funds and estimated gas changes during signing leave durable SIGNED state without broadcasting', async () => {
  for (const change of [
    (f) => {
      f.time += 3601;
    },
    (f, q) => {
      f.nonces.set(q.inputs.deployer.toLowerCase(), 1n);
    },
    (f) => {
      f.balance = 0n;
    },
    (f) => {
      f.estimate = 1250001n;
    },
  ]) {
    const f = await setup();
    try {
      const originalSign = f.options.signers[0].sign;
      f.options.signers[0].sign = async (transaction) => {
        const signed = await originalSign(transaction);
        change(f.fixture, f.qualification);
        return signed;
      };
      await assert.rejects(f.engine.next());
      assert.equal(f.engine.status().actions[0].state, 'SIGNED');
      assert.equal(f.fixture.signCount, 1);
      assert.equal(f.fixture.sendCount, 0);
      await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
    } finally {
      f.cleanup();
    }
  }
});

test('approval expiring during the final estimate cannot claim or broadcast a signed envelope', async () => {
  const f = await setup();
  try {
    const originalRequest = f.options.rpc.request;
    f.options.rpc.request = async (method, params) => {
      const result = await originalRequest(method, params);
      if (method === 'eth_estimateGas' && params[0].gas !== undefined)
        f.fixture.time = f.qualification.approval.expiresAt + 1;
      return result;
    };
    await assert.rejects(f.engine.next(), /TRANSMISSION_EXPIRED/);
    assert.equal(f.engine.status().actions[0].state, 'SIGNED');
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 0);
  } finally {
    f.cleanup();
  }
});

test('expiry during the final pre-sign balance read leaves the reservation without invoking the signer', async () => {
  const f = await setup();
  try {
    const originalRequest = f.options.rpc.request;
    let balanceReads = 0;
    f.options.rpc.request = async (method, params) => {
      const result = await originalRequest(method, params);
      if (method === 'eth_getBalance' && ++balanceReads === 2)
        f.fixture.time = f.qualification.approval.expiresAt + 1;
      return result;
    };
    await assert.rejects(f.engine.next(), /SIGNING_EXPIRED/);
    assert.equal(f.engine.status().actions[0].state, 'RESERVED');
    assert.equal(f.engine.status().actions[0].transactionHash, null);
    assert.equal(f.fixture.signCount, 0);
    assert.equal(f.fixture.sendCount, 0);
    await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
  } finally {
    f.cleanup();
  }
});

test('expiry during the durable broadcast claim prevents send and preserves hash-only recovery', async () => {
  const f = await setup();
  const originalPrepare = DatabaseSync.prototype.prepare;
  try {
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (sql.includes("SET state='BROADCAST_UNCERTAIN'")) {
        const originalRun = statement.run.bind(statement);
        statement.run = (...args) => {
          const result = originalRun(...args);
          f.fixture.time = f.qualification.approval.expiresAt + 1;
          return result;
        };
      }
      return statement;
    };
    await assert.rejects(f.engine.next(), /TRANSMISSION_EXPIRED/);
    const recorded = f.engine.status().actions[0];
    assert.equal(recorded.state, 'BROADCAST_UNCERTAIN');
    assert.match(recorded.transactionHash, /^0x[0-9a-f]{64}$/);
    const outcome = await f.engine.reconcile();
    assert.equal(outcome.state, 'RECOVERY_REQUIRED');
    assert.equal(outcome.transactionHash, recorded.transactionHash);
    await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 0);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    f.cleanup();
  }
});

test('reverted transaction, failed state verification and canonical reorg stop all later actions', async () => {
  for (const kind of ['revert', 'verification', 'reorg']) {
    const f = await setup();
    try {
      if (kind === 'revert') f.fixture.revert = true;
      if (kind === 'verification') f.fixture.verificationFailure = true;
      const sent = await f.engine.next();
      if (kind === 'reorg')
        f.fixture.reorgBlock = BigInt(f.fixture.receipts.get(sent.transactionHash).blockNumber);
      await assert.rejects(f.confirm(), /REVERTED|STATE_VERIFICATION|REORG/);
      await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
      assert.equal(f.fixture.signCount, 1);
      assert.equal(f.fixture.sendCount, 1);
    } finally {
      f.cleanup();
    }
  }
});

test('failed signing keeps a reserved action and does not allow retry after restart', async () => {
  const f = await setup();
  let reopened;
  try {
    f.options.signers[0].sign = async () => {
      throw new Error('offline signer rejection');
    };
    await assert.rejects(f.engine.next(), /SIGNER_FAILED/);
    assert.equal(f.engine.status().actions[0].state, 'RESERVED');
    f.engine.close();
    reopened = new DeploymentExecution(f.options);
    await assert.rejects(reopened.next(), /RECOVERY_REQUIRED/);
    await assert.rejects(reopened.reconcile(), /RECOVERY_REQUIRED/);
    assert.equal(f.fixture.sendCount, 0);
  } finally {
    reopened?.close();
    f.cleanup();
  }
});

test('an external nonce insertion after a confirmed deployment and parallel signer ownership are rejected', async () => {
  const f = await setup();
  try {
    assert.throws(() => new DeploymentExecution(f.options), /OWNERSHIP_LOCKED/);
    await f.engine.next();
    await f.confirm();
    f.fixture.nonces.set(f.qualification.inputs.deployer.toLowerCase(), 2n);
    await assert.rejects(f.engine.next(), /NONCE_CHANGED/);
    assert.equal(f.fixture.signCount, 1);
  } finally {
    f.cleanup();
  }
});

test('previous confirmations are checked against real receipts before any later action', async () => {
  const f = await setup();
  try {
    const sent = await f.engine.next();
    await f.confirm();
    f.fixture.receipts.delete(sent.transactionHash);
    await assert.rejects(f.engine.next(), /PREVIOUS_RECEIPT_UNAVAILABLE/);
    assert.equal(f.fixture.signCount, 1);
    assert.equal(f.fixture.sendCount, 1);
  } finally {
    f.cleanup();
  }
});

test('a historical reorg remains readable and blocks all later signing or broadcasting', async () => {
  const f = await setup();
  try {
    const first = await f.engine.next();
    await f.confirm();
    await f.engine.next();
    await f.confirm();
    f.fixture.reorgBlock = BigInt(f.fixture.receipts.get(first.transactionHash).blockNumber);
    await assert.rejects(f.engine.next(), /DEPLOYMENT_REORG/);
    const status = f.engine.status();
    assert.equal(status.actions[0].state, 'REORGED');
    assert.equal(status.actions[1].state, 'CONFIRMED');
    assert.equal((await f.engine.reconcile()).state, 'RECOVERY_REQUIRED');
    await assert.rejects(f.engine.next(), /RECOVERY_REQUIRED/);
    assert.equal(f.fixture.signCount, 2);
    assert.equal(f.fixture.sendCount, 2);
  } finally {
    f.cleanup();
  }
});

test('reorg or lost confirmation depth during final state verification cannot mark an action confirmed', async () => {
  for (const kind of ['reorg', 'depth']) {
    const f = await setup();
    try {
      await f.engine.next();
      if (kind === 'reorg') {
        f.fixture.reorgAfterVerification = true;
        await assert.rejects(f.confirm(), /DEPLOYMENT_REORG/);
        assert.equal(f.engine.status().actions[0].state, 'REORGED');
        assert.equal((await f.engine.reconcile()).state, 'RECOVERY_REQUIRED');
      } else {
        f.fixture.depthChangeAfterVerification = true;
        assert.equal((await f.confirm()).state, 'INCLUDED');
        assert.equal(f.engine.status().confirmedActions, 0);
        assert.equal(f.engine.status().actions[0].state, 'BROADCAST_UNCERTAIN');
        f.fixture.depthChangeAfterVerification = false;
        f.fixture.head++;
        assert.equal((await f.engine.reconcile()).confirmedActions, 1);
      }
      assert.equal(f.fixture.signCount, 1);
      assert.equal(f.fixture.sendCount, 1);
    } finally {
      f.cleanup();
    }
  }
});
