import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Interface, Transaction, getAddress, getCreateAddress, keccak256 } from 'ethers';
import { privateServerStorage } from '../../packages/testnet/src/private-storage.ts';
import { claimNonceOwnership } from '../../packages/testnet/src/nonce-ownership.ts';
import { ROBINHOOD_CHAIN_TESTNET } from '../../packages/robinhood-chain/src/network.ts';
import { evaluateSlitherAdmissions } from '../ci/slither-review.mjs';
import { prepareDeployment } from './prepare.ts';
import { qualifyTargetArtifacts, targetPlanDigest } from './target-preflight.ts';

// This component has no CLI, provider constructor, key reader or default signer.
// A separately reviewed operator integration must supply real signing and
// contract-state verification. Tests supply isolated transports and signers.
const ordinaryUser = '0x5a2acf1a388fe4f19aeffa404e07e916b5b07b77';
const qualifications = new WeakSet();
const gasInfo = new Interface(['function getGasAccountingParams() view returns(uint256,uint256,uint256)']);
const fail = (code) => {
  throw new Error(code);
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uint = (value, positive = false) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) fail('DEPLOYMENT_INTEGER');
  const n = BigInt(value);
  if (n >= 2n ** 256n || (positive && !n)) fail('DEPLOYMENT_INTEGER');
  return n;
};
const rpcUint = (value) => {
  if (typeof value !== 'string' || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))
    fail('DEPLOYMENT_RPC_RESPONSE');
  return BigInt(value);
};
const hex = (value) => '0x' + BigInt(value).toString(16);
const address = (value) => {
  const result = getAddress(value).toLowerCase();
  if (/^0x0+$/.test(result)) fail('DEPLOYMENT_IDENTITY');
  return result;
};
const hash = (value) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('DEPLOYMENT_RPC_RESPONSE');
  return value.toLowerCase();
};
function budgetPolicy(budget, plan) {
  if (
    !exact(budget, [
      'maxGasPerTransactionRaw',
      'maxFeePerGasRaw',
      'maxPriorityFeePerGasRaw',
      'maxTotalGasCostWei',
      'maxTotalNativeValueWei',
      'minimumRemainingEthRaw',
      'maxHeadAgeSeconds',
    ]) ||
    !Number.isSafeInteger(budget.maxHeadAgeSeconds) ||
    budget.maxHeadAgeSeconds < 1 ||
    budget.maxHeadAgeSeconds > 60
  )
    fail('DEPLOYMENT_BUDGET');
  const gas = uint(budget.maxGasPerTransactionRaw, true),
    fee = uint(budget.maxFeePerGasRaw, true);
  if (
    gas > 32000000n ||
    uint(budget.maxPriorityFeePerGasRaw) > fee ||
    uint(budget.minimumRemainingEthRaw, true) === 0n ||
    BigInt(plan.actions.filter((action) => action.unsigned).length) * gas * fee >
      uint(budget.maxTotalGasCostWei, true) ||
    plan.actions.reduce((sum, action) => sum + (action.unsigned ? uint(action.unsigned.value) : 0n), 0n) >
      uint(budget.maxTotalNativeValueWei, true)
  )
    fail('DEPLOYMENT_BUDGET');
}

/** Qualifies an explicit immutable approval; residual-risk review alone grants no signing authority. */
export async function qualifyDeploymentExecution({
  plan,
  inputs,
  budget,
  approval,
  report,
  review,
  repository,
  now,
  recoveryOnly = false,
}) {
  if (!Number.isSafeInteger(now) || now < 0 || typeof recoveryOnly !== 'boolean') fail('DEPLOYMENT_TIME');
  if (
    !exact(approval, [
      'chainId',
      'environment',
      'authorization',
      'approvalRef',
      'expiresAt',
      'planDigest',
      'inputsDigest',
      'budgetDigest',
      'artifactDigest',
      'slitherReportSha256',
      'slitherReviewSha256',
    ]) ||
    approval.chainId !== 46630 ||
    approval.environment !== 'ONCHAIN_TESTNET' ||
    approval.authorization !== 'I_AUTHORIZE_FAIR_LAUNCH_DEPLOYMENT_46630' ||
    typeof approval.approvalRef !== 'string' ||
    !approval.approvalRef.length ||
    approval.approvalRef.length > 256 ||
    !Number.isSafeInteger(approval.expiresAt) ||
    approval.expiresAt < 1 ||
    (!recoveryOnly && approval.expiresAt <= now) ||
    approval.expiresAt - now > 86400
  )
    fail('DEPLOYMENT_APPROVAL');
  for (const role of [
    'deployer',
    'administrator',
    'quoteSigner',
    'claimSigner',
    'tslaLpRecipient',
    'amznLpRecipient',
  ])
    if (address(inputs[role]) === ordinaryUser) fail('ORDINARY_USER_ROLE_FORBIDDEN');
  const offline = [address(inputs.quoteSigner), address(inputs.claimSigner)];
  if (
    offline[0] === offline[1] ||
    offline.includes(address(inputs.deployer)) ||
    offline.includes(address(inputs.administrator))
  )
    fail('DEPLOYMENT_SIGNER_SEPARATION');
  const expected = await prepareDeployment(copy(inputs));
  if (
    expected.actions.some(
      (action) => action.unsigned?.to === null && (action.unsigned.data.length - 2) / 2 > 49152,
    )
  )
    fail('DEPLOYMENT_INITCODE_SIZE');
  if (
    targetPlanDigest(plan) !== targetPlanDigest(expected) ||
    approval.planDigest !== targetPlanDigest(expected) ||
    approval.inputsDigest !== targetPlanDigest(inputs) ||
    approval.budgetDigest !== targetPlanDigest(budget)
  )
    fail('DEPLOYMENT_PLAN_MISMATCH');
  budgetPolicy(budget, expected);
  const artifacts = qualifyTargetArtifacts(repository);
  if (
    approval.artifactDigest !== artifacts.digest ||
    approval.slitherReportSha256 !== sha(report) ||
    approval.slitherReviewSha256 !== sha(review) ||
    report?.success !== true ||
    !Array.isArray(report?.results?.detectors) ||
    report.results.detectors.length !== review?.findings?.length
  )
    fail('DEPLOYMENT_SECURITY_BINDING');
  evaluateSlitherAdmissions(report, review, repository, now * 1000, {
    chainId: 46630,
    environment: 'ONCHAIN_TESTNET',
  });
  const qualified = freeze({
    plan: expected,
    budget: copy(budget),
    approval: copy(approval),
    report: copy(report),
    review: copy(review),
    repository: resolve(repository),
    recoveryOnly,
    bindingDigest: targetPlanDigest({ plan: expected, budget, approval }),
  });
  qualifications.add(qualified);
  return qualified;
}

const schema = [
  'CREATE TABLE deployment_identity (id INTEGER PRIMARY KEY CHECK(id=1), binding_digest TEXT NOT NULL) STRICT',
  "CREATE TABLE deployment_actions (action_index INTEGER PRIMARY KEY, transaction_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('RESERVED','SIGNED','BROADCAST_UNCERTAIN','CONFIRMED','REVERTED','REORGED','VERIFICATION_FAILED')), raw_transaction TEXT, transaction_hash TEXT UNIQUE, receipt_json TEXT) STRICT",
];
function validateSigned(transaction, raw) {
  if (typeof raw !== 'string' || !/^0x(?:[a-fA-F0-9]{2}){1,65536}$/.test(raw))
    fail('DEPLOYMENT_SIGNED_TRANSACTION');
  let parsed;
  try {
    parsed = Transaction.from(raw);
  } catch {
    fail('DEPLOYMENT_SIGNED_TRANSACTION');
  }
  if (
    !parsed.isSigned() ||
    parsed.type !== 2 ||
    parsed.chainId !== 46630n ||
    parsed.from?.toLowerCase() !== transaction.from ||
    parsed.to?.toLowerCase() !== (transaction.to ?? undefined) ||
    parsed.data.toLowerCase() !== transaction.data.toLowerCase() ||
    String(parsed.nonce) !== transaction.nonce ||
    parsed.value !== uint(transaction.value) ||
    parsed.gasLimit !== uint(transaction.gasLimit) ||
    parsed.maxFeePerGas !== uint(transaction.maxFeePerGas) ||
    parsed.maxPriorityFeePerGas !== uint(transaction.maxPriorityFeePerGas) ||
    parsed.accessList?.length !== 0 ||
    !parsed.hash ||
    parsed.hash !== keccak256(raw)
  )
    fail('DEPLOYMENT_SIGNED_TRANSACTION');
  return parsed.hash;
}

/** Injected execution engine only. A signing or broadcast failure never releases the attempted action. */
export class DeploymentExecution {
  #qualified;
  #rpc;
  #signers;
  #verify;
  #now;
  #storage;
  #nonceOwnership;
  #db;
  #busy = false;
  #closed = false;
  constructor({ qualified, rpc, signers, verifyAction, journalDirectory, nonceDirectory, now }) {
    if (
      !qualifications.has(qualified) ||
      rpc?.endpoint !== ROBINHOOD_CHAIN_TESTNET.rpcUrl ||
      typeof rpc.request !== 'function' ||
      typeof verifyAction !== 'function' ||
      typeof now !== 'function'
    )
      fail('DEPLOYMENT_QUALIFICATION_REQUIRED');
    this.#qualified = qualified;
    this.#rpc = rpc;
    this.#verify = verifyAction;
    this.#now = now;
    const actors = [
      ...new Set([address(qualified.plan.inputs.deployer), address(qualified.plan.inputs.administrator)]),
    ];
    this.#signers = new Map();
    for (const signer of signers) {
      const actor = address(signer.address);
      if (!actors.includes(actor) || this.#signers.has(actor) || typeof signer.sign !== 'function')
        fail('DEPLOYMENT_SIGNER_IDENTITY');
      this.#signers.set(actor, signer);
    }
    if (
      (qualified.recoveryOnly && this.#signers.size !== 0) ||
      (!qualified.recoveryOnly && this.#signers.size !== actors.length)
    )
      fail('DEPLOYMENT_SIGNER_IDENTITY');
    try {
      this.#nonceOwnership = claimNonceOwnership(
        nonceDirectory,
        actors,
        targetPlanDigest({
          purpose: 'FAIR_LAUNCH_DEPLOYMENT',
          journalDirectory: resolve(journalDirectory),
          binding: qualified.bindingDigest,
        }),
      );
      this.#storage = privateServerStorage(journalDirectory, 16 * 1024 * 1024);
      this.#storage.bindIdentity('RESTRICTED_TESTNET_EXECUTOR', qualified.bindingDigest);
      this.#db = new DatabaseSync(this.#storage.databasePath('fair-launch-deployment', 1095124048));
      const tables = this.#db
        .prepare("SELECT sql FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all()
        .map((row) => row.sql)
        .sort();
      const version = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (!tables.length && version === 0) {
        this.#db.exec('BEGIN IMMEDIATE');
        for (const ddl of schema) this.#db.exec(ddl);
        this.#db.prepare('INSERT INTO deployment_identity VALUES(1,?)').run(qualified.bindingDigest);
        this.#db.exec('PRAGMA user_version=1; COMMIT');
      } else if (
        version !== 1 ||
        JSON.stringify(tables) !== JSON.stringify([...schema].sort()) ||
        this.#db.prepare('SELECT binding_digest FROM deployment_identity').get()?.binding_digest !==
          qualified.bindingDigest
      )
        fail('DEPLOYMENT_JOURNAL_IDENTITY');
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000');
      this.#rows();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  #rows() {
    if (this.#closed || this.#db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
      fail('DEPLOYMENT_JOURNAL_CORRUPT');
    const rows = this.#db.prepare('SELECT * FROM deployment_actions ORDER BY action_index').all();
    const actions = this.#qualified.plan.actions;
    const indices = actions.flatMap((action, index) => (action.unsigned ? [index] : []));
    for (const [position, row] of rows.entries()) {
      const action = actions[row.action_index];
      const tx = JSON.parse(row.transaction_json);
      if (
        row.action_index !== indices[position] ||
        (position < rows.length - 1 && !['CONFIRMED', 'REORGED'].includes(row.state)) ||
        !action?.unsigned ||
        !exact(tx, [
          'chainId',
          'from',
          'to',
          'data',
          'value',
          'nonce',
          'type',
          'gasLimit',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
        ]) ||
        tx.chainId !== '46630' ||
        tx.type !== '2' ||
        tx.from !== address(action.caller) ||
        tx.to !== (action.unsigned.to ? address(action.unsigned.to) : null) ||
        tx.data !== action.unsigned.data ||
        tx.value !== action.unsigned.value ||
        !/^(0|[1-9][0-9]{0,9})$/.test(tx.nonce) ||
        BigInt(tx.nonce) > 2147483647n ||
        uint(tx.gasLimit, true) > uint(this.#qualified.budget.maxGasPerTransactionRaw) ||
        tx.maxFeePerGas !== this.#qualified.budget.maxFeePerGasRaw ||
        tx.maxPriorityFeePerGas !== this.#qualified.budget.maxPriorityFeePerGasRaw ||
        (action.nonce !== undefined && tx.nonce !== String(action.nonce)) ||
        rows.slice(0, position).some((earlier) => {
          const previous = JSON.parse(earlier.transaction_json);
          return previous.from === tx.from && previous.nonce === tx.nonce;
        })
      )
        fail('DEPLOYMENT_JOURNAL_CORRUPT');
      if (row.state === 'RESERVED') {
        if (row.raw_transaction !== null || row.transaction_hash !== null || row.receipt_json !== null)
          fail('DEPLOYMENT_JOURNAL_CORRUPT');
      } else if (validateSigned(tx, row.raw_transaction) !== row.transaction_hash)
        fail('DEPLOYMENT_JOURNAL_CORRUPT');
      if (row.state === 'CONFIRMED') {
        const receipt = JSON.parse(row.receipt_json);
        if (
          receipt.transactionHash !== row.transaction_hash ||
          rpcUint(receipt.status) !== 1n ||
          rpcUint(receipt.gasUsed) > uint(tx.gasLimit) ||
          rpcUint(receipt.effectiveGasPrice) > uint(tx.maxFeePerGas)
        )
          fail('DEPLOYMENT_JOURNAL_CORRUPT');
      }
    }
    return rows;
  }
  status() {
    const rows = this.#rows();
    return {
      planDigest: this.#qualified.approval.planDigest,
      mode: this.#qualified.recoveryOnly ? 'WATCH_ONLY' : 'INJECTED_EXECUTION_ENGINE',
      confirmedActions: rows.filter((row) => row.state === 'CONFIRMED').length,
      executableActions: this.#qualified.plan.actions.filter((action) => action.unsigned).length,
      actions: rows.map((row) => ({
        index: row.action_index,
        state: row.state,
        transactionHash: row.transaction_hash,
      })),
      references: this.#qualified.plan.actions
        .filter((action) => !action.unsigned)
        .map((action) => ({ operation: action.operation, status: 'NOT_RUN_REQUIRES_FRESH_TEST_REFERENCE' })),
    };
  }
  async #admission(signing = true) {
    const now = this.#now();
    await qualifyDeploymentExecution({
      ...this.#qualified,
      inputs: this.#qualified.plan.inputs,
      now,
      recoveryOnly: !signing,
    });
    if (rpcUint(await this.#rpc.request('eth_chainId', [])) !== 46630n) fail('DEPLOYMENT_CHAIN');
    const head = await this.#rpc.request('eth_getBlockByNumber', ['latest', false]);
    hash(head?.hash);
    rpcUint(head?.number);
    const timestamp = rpcUint(head.timestamp);
    if (timestamp > BigInt(now) || BigInt(now) - timestamp > BigInt(this.#qualified.budget.maxHeadAgeSeconds))
      fail('DEPLOYMENT_HEAD_STALE');
    // Confirming an already submitted transaction does not grant another signature.
    if (!signing) return head;
    // Nitro's header gasLimit is not the transaction execution limit.
    const encoded = await this.#rpc.request('eth_call', [
      {
        to: '0x000000000000000000000000000000000000006c',
        data: gasInfo.encodeFunctionData('getGasAccountingParams'),
      },
      head.number,
    ]);
    const executionLimit = BigInt(gasInfo.decodeFunctionResult('getGasAccountingParams', encoded)[2]);
    if (
      executionLimit <= 0n ||
      executionLimit > 32000000n ||
      uint(this.#qualified.budget.maxGasPerTransactionRaw) > executionLimit
    )
      fail('DEPLOYMENT_NETWORK_GAS_LIMIT');
    const fee = rpcUint(await this.#rpc.request('eth_gasPrice', []));
    if (!fee || fee > uint(this.#qualified.budget.maxFeePerGasRaw)) fail('DEPLOYMENT_GAS_PRICE');
    return head;
  }
  async #funds(actor, gasCost, value) {
    const balance = rpcUint(await this.#rpc.request('eth_getBalance', [actor, 'latest']));
    if (balance < gasCost + value + uint(this.#qualified.budget.minimumRemainingEthRaw))
      fail('DEPLOYMENT_ETH_FUNDS');
  }
  #deadline(code = 'DEPLOYMENT_TRANSMISSION_EXPIRED') {
    const current = this.#now();
    if (
      !Number.isSafeInteger(current) ||
      current < 0 ||
      current >= this.#qualified.approval.expiresAt ||
      current * 1000 >= Date.parse(this.#qualified.review.expiresAt)
    )
      fail(code);
  }
  async #nonce(actor) {
    const [latest, pending] = await Promise.all([
      this.#rpc.request('eth_getTransactionCount', [actor, 'latest']),
      this.#rpc.request('eth_getTransactionCount', [actor, 'pending']),
    ]);
    const nonce = rpcUint(latest);
    if (nonce !== rpcUint(pending) || nonce > 2147483647n) fail('DEPLOYMENT_NONCE_UNCERTAIN');
    return nonce;
  }
  async #canonical(rows) {
    for (const row of rows.filter((item) => item.state === 'CONFIRMED')) {
      const receipt = JSON.parse(row.receipt_json);
      const block = await this.#rpc.request('eth_getBlockByNumber', [receipt.blockNumber, false]);
      if (hash(block?.hash) !== hash(receipt.blockHash)) {
        this.#db
          .prepare("UPDATE deployment_actions SET state='REORGED' WHERE action_index=?")
          .run(row.action_index);
        fail('DEPLOYMENT_REORG');
      }
      // A local CONFIRMED label cannot replace the actual successful receipt.
      const actual = await this.#rpc.request('eth_getTransactionReceipt', [row.transaction_hash]);
      if (!actual || targetPlanDigest(actual) !== targetPlanDigest(receipt))
        fail('DEPLOYMENT_PREVIOUS_RECEIPT_UNAVAILABLE');
    }
  }
  async next() {
    if (this.#qualified.recoveryOnly) fail('DEPLOYMENT_WATCH_ONLY');
    if (this.#busy) fail('DEPLOYMENT_BUSY');
    this.#busy = true;
    try {
      const rows = this.#rows();
      if (rows.some((row) => row.state !== 'CONFIRMED')) fail('DEPLOYMENT_RECOVERY_REQUIRED');
      await this.#admission();
      await this.#canonical(rows);
      const index = this.#qualified.plan.actions.findIndex(
        (action, i) => action.unsigned && !rows.some((row) => row.action_index === i),
      );
      if (index < 0) return { state: 'EXECUTABLE_PLAN_CONFIRMED', ...this.status() };
      const action = this.#qualified.plan.actions[index],
        actor = address(action.caller),
        budget = this.#qualified.budget,
        nonce = await this.#nonce(actor);
      if ((await this.#rpc.request('eth_getCode', [actor, 'latest'])) !== '0x')
        fail('DEPLOYMENT_CALLER_NOT_EOA');
      const previous = rows.filter((row) => JSON.parse(row.transaction_json).from === actor).at(-1);
      if (
        (action.nonce !== undefined && nonce !== BigInt(action.nonce)) ||
        (previous && nonce !== BigInt(JSON.parse(previous.transaction_json).nonce) + 1n)
      )
        fail('DEPLOYMENT_NONCE_CHANGED');
      if (!action.unsigned.to) {
        if (
          address(getCreateAddress({ from: actor, nonce: Number(nonce) })) !== address(action.contractAddress)
        )
          fail('DEPLOYMENT_CREATE_ADDRESS');
        if ((await this.#rpc.request('eth_getCode', [action.contractAddress, 'latest'])) !== '0x')
          fail('DEPLOYMENT_CREATE_OCCUPIED');
      }
      const base = {
        from: actor,
        ...(action.unsigned.to ? { to: address(action.unsigned.to) } : {}),
        data: action.unsigned.data,
        value: hex(action.unsigned.value),
        nonce: hex(nonce),
        type: '0x2',
        maxFeePerGas: hex(budget.maxFeePerGasRaw),
        maxPriorityFeePerGas: hex(budget.maxPriorityFeePerGasRaw),
      };
      const estimate = rpcUint(await this.#rpc.request('eth_estimateGas', [base]));
      if (!estimate || estimate > uint(budget.maxGasPerTransactionRaw)) fail('DEPLOYMENT_GAS_LIMIT');
      const padded = (estimate * 125n + 99n) / 100n;
      const gas =
        padded < uint(budget.maxGasPerTransactionRaw) ? padded : uint(budget.maxGasPerTransactionRaw);
      const gasCost = gas * uint(budget.maxFeePerGasRaw);
      const spentGas = rows.reduce((sum, row) => {
        const receipt = JSON.parse(row.receipt_json);
        return sum + rpcUint(receipt.gasUsed) * rpcUint(receipt.effectiveGasPrice);
      }, 0n);
      const spentValue = rows.reduce((sum, row) => sum + uint(JSON.parse(row.transaction_json).value), 0n);
      if (
        spentGas + gasCost > uint(budget.maxTotalGasCostWei) ||
        spentValue + uint(action.unsigned.value) > uint(budget.maxTotalNativeValueWei)
      )
        fail('DEPLOYMENT_TOTAL_BUDGET');
      await this.#funds(actor, gasCost, uint(action.unsigned.value));
      const transaction = {
        chainId: '46630',
        from: actor,
        to: action.unsigned.to ? address(action.unsigned.to) : null,
        data: action.unsigned.data,
        value: action.unsigned.value,
        nonce: String(nonce),
        type: '2',
        gasLimit: String(gas),
        maxFeePerGas: budget.maxFeePerGasRaw,
        maxPriorityFeePerGas: budget.maxPriorityFeePerGasRaw,
      };
      await this.#admission();
      if ((await this.#nonce(actor)) !== nonce) fail('DEPLOYMENT_NONCE_CHANGED');
      await this.#funds(actor, gasCost, uint(action.unsigned.value));
      if (!this.#storage.canWrite(1024 * 1024)) fail('DEPLOYMENT_STORAGE_CAPACITY');
      // FULL synchronous SQLite commits the reservation before invoking any signer.
      this.#db
        .prepare("INSERT INTO deployment_actions VALUES(?,?,'RESERVED',NULL,NULL,NULL)")
        .run(index, JSON.stringify(transaction));
      const signingInput = freeze(copy(transaction));
      // Reservation fsync and the final balance read can cross the deadline.
      // Expiry leaves the reserved action intact without invoking a signer.
      this.#deadline('DEPLOYMENT_SIGNING_EXPIRED');
      let signed;
      try {
        signed = await this.#signers.get(actor).sign(signingInput);
      } catch {
        fail('DEPLOYMENT_SIGNER_FAILED');
      }
      const transactionHash = validateSigned(transaction, signed);
      // Raw envelope and locally derived hash commit before a send can occur.
      this.#db
        .prepare(
          "UPDATE deployment_actions SET state='SIGNED',raw_transaction=?,transaction_hash=? WHERE action_index=? AND state='RESERVED'",
        )
        .run(signed, transactionHash, index);
      await this.#admission();
      if ((await this.#nonce(actor)) !== nonce) fail('DEPLOYMENT_NONCE_CHANGED');
      await this.#funds(actor, gasCost, uint(action.unsigned.value));
      if ((await this.#rpc.request('eth_getCode', [actor, 'latest'])) !== '0x')
        fail('DEPLOYMENT_CALLER_NOT_EOA');
      const finalEstimate = rpcUint(await this.#rpc.request('eth_estimateGas', [{ ...base, gas: hex(gas) }]));
      if (!finalEstimate || finalEstimate > gas) fail('DEPLOYMENT_GAS_CHANGED');
      // No awaited work may separate this check from the durable send claim.
      // RPC estimates or hardware signatures may outlive the original approval.
      this.#deadline();
      this.#db
        .prepare(
          "UPDATE deployment_actions SET state='BROADCAST_UNCERTAIN' WHERE action_index=? AND state='SIGNED'",
        )
        .run(index);
      // A slow durable broadcast claim must not start a send after expiry.
      // Keep its recorded hash for read-only reconciliation; never re-sign.
      this.#deadline();
      try {
        const response = await this.#rpc.request('eth_sendRawTransaction', [signed]);
        if (hash(response) !== transactionHash) fail('DEPLOYMENT_SEND_RESPONSE');
      } catch {
        fail('DEPLOYMENT_BROADCAST_UNCERTAIN');
      }
      return { index, transactionHash, state: 'BROADCAST_UNCERTAIN' };
    } finally {
      this.#busy = false;
    }
  }
  async reconcile() {
    if (this.#busy) fail('DEPLOYMENT_BUSY');
    this.#busy = true;
    try {
      const rows = this.#rows();
      if (rows.some((row) => row.state === 'REORGED'))
        return { state: 'RECOVERY_REQUIRED', ...this.status() };
      const head = await this.#admission(false);
      await this.#canonical(rows);
      const row = rows.find((item) => item.state !== 'CONFIRMED');
      if (!row) return this.status();
      if (!['SIGNED', 'BROADCAST_UNCERTAIN'].includes(row.state)) fail('DEPLOYMENT_RECOVERY_REQUIRED');
      const receipt = await this.#rpc.request('eth_getTransactionReceipt', [row.transaction_hash]);
      if (!receipt) return { state: 'RECOVERY_REQUIRED', transactionHash: row.transaction_hash };
      const transaction = JSON.parse(row.transaction_json);
      const chainTx = await this.#rpc.request('eth_getTransactionByHash', [row.transaction_hash]);
      if (
        hash(receipt.transactionHash) !== row.transaction_hash ||
        address(receipt.from) !== transaction.from ||
        (receipt.to ? address(receipt.to) : null) !== transaction.to ||
        !chainTx ||
        hash(chainTx.hash) !== row.transaction_hash ||
        hash(chainTx.blockHash) !== hash(receipt.blockHash) ||
        rpcUint(chainTx.blockNumber) !== rpcUint(receipt.blockNumber) ||
        address(chainTx.from) !== transaction.from ||
        (chainTx.to ? address(chainTx.to) : null) !== transaction.to ||
        rpcUint(chainTx.chainId) !== 46630n ||
        rpcUint(chainTx.nonce) !== uint(transaction.nonce) ||
        rpcUint(chainTx.value) !== uint(transaction.value) ||
        chainTx.input?.toLowerCase() !== transaction.data.toLowerCase() ||
        rpcUint(chainTx.type) !== 2n ||
        rpcUint(chainTx.gas) !== uint(transaction.gasLimit) ||
        rpcUint(chainTx.maxFeePerGas) !== uint(transaction.maxFeePerGas) ||
        rpcUint(chainTx.maxPriorityFeePerGas) !== uint(transaction.maxPriorityFeePerGas) ||
        rpcUint(receipt.gasUsed) > uint(transaction.gasLimit) ||
        rpcUint(receipt.effectiveGasPrice) > uint(transaction.maxFeePerGas)
      )
        fail('DEPLOYMENT_RECEIPT_MISMATCH');
      const canonical = await this.#rpc.request('eth_getBlockByNumber', [receipt.blockNumber, false]);
      if (hash(canonical?.hash) !== hash(receipt.blockHash)) {
        this.#db
          .prepare("UPDATE deployment_actions SET state='REORGED',receipt_json=? WHERE action_index=?")
          .run(JSON.stringify(receipt), row.action_index);
        fail('DEPLOYMENT_REORG');
      }
      if (rpcUint(receipt.status) !== 1n) {
        this.#db
          .prepare("UPDATE deployment_actions SET state='REVERTED',receipt_json=? WHERE action_index=?")
          .run(JSON.stringify(receipt), row.action_index);
        fail('DEPLOYMENT_REVERTED');
      }
      if (rpcUint(head.number) < rpcUint(receipt.blockNumber) + 2n)
        return { state: 'INCLUDED', transactionHash: row.transaction_hash };
      const action = this.#qualified.plan.actions[row.action_index];
      if (
        !transaction.to &&
        (address(receipt.contractAddress) !== address(action.contractAddress) ||
          (await this.#rpc.request('eth_getCode', [action.contractAddress, receipt.blockNumber])) === '0x')
      )
        fail('DEPLOYMENT_CREATED_CONTRACT');
      try {
        // The callback must verify actual constructor/state/assets/events at the
        // canonical receipt block. An HTTP receipt alone never qualifies funding.
        const evidence = await this.#verify(
          freeze({
            action: copy(action),
            index: row.action_index,
            receipt: copy(receipt),
            plan: copy(this.#qualified.plan),
          }),
        );
        if (
          !exact(evidence, ['verified', 'planDigest', 'actionIndex', 'blockHash']) ||
          evidence.verified !== true ||
          evidence.planDigest !== this.#qualified.approval.planDigest ||
          evidence.actionIndex !== row.action_index ||
          hash(evidence.blockHash) !== hash(receipt.blockHash)
        )
          fail('DEPLOYMENT_STATE_VERIFICATION');
      } catch {
        this.#db
          .prepare(
            "UPDATE deployment_actions SET state='VERIFICATION_FAILED',receipt_json=? WHERE action_index=?",
          )
          .run(JSON.stringify(receipt), row.action_index);
        fail('DEPLOYMENT_STATE_VERIFICATION');
      }
      const finalHead = await this.#admission(false);
      const finalBlock = await this.#rpc.request('eth_getBlockByNumber', [receipt.blockNumber, false]);
      if (hash(finalBlock?.hash) !== hash(receipt.blockHash)) {
        this.#db
          .prepare("UPDATE deployment_actions SET state='REORGED',receipt_json=? WHERE action_index=?")
          .run(JSON.stringify(receipt), row.action_index);
        fail('DEPLOYMENT_REORG');
      }
      if (rpcUint(finalHead.number) < rpcUint(receipt.blockNumber) + 2n)
        return { state: 'INCLUDED', transactionHash: row.transaction_hash };
      this.#db
        .prepare("UPDATE deployment_actions SET state='CONFIRMED',receipt_json=? WHERE action_index=?")
        .run(JSON.stringify(receipt), row.action_index);
      return this.status();
    } finally {
      this.#busy = false;
    }
  }
  close() {
    if (this.#closed) return;
    if (this.#busy) fail('DEPLOYMENT_BUSY');
    this.#closed = true;
    this.#db?.close();
    this.#storage?.close();
    this.#nonceOwnership?.close();
  }
}
