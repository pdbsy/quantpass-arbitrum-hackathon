import { Transaction } from 'ethers';
import { OrderJournal, type OrderIntent } from './order-journal.ts';

export interface SubmissionPolicy {
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly maxGasCostWei: string;
}
export interface RestrictedTransport {
  chainId(): Promise<number>;
  nonce(address: string, block: 'pending' | 'latest'): Promise<number>;
  balance(address: string): Promise<bigint>;
  estimate(transaction: Readonly<Record<string, string>>): Promise<bigint>;
  send(raw: string): Promise<string>;
}
export interface RestrictedSigner {
  readonly address: string;
  sign(transaction: Readonly<Record<string, string>>): Promise<string>;
}
const raw = (v: string) => {
  if (!/^[1-9][0-9]{0,77}$/.test(v) || BigInt(v) >= 2n ** 256n) throw new Error('SUBMISSION_POLICY');
  return BigInt(v);
};
export function validateSubmissionPolicy(p: SubmissionPolicy) {
  if (
    Object.keys(p).length !== 4 ||
    Object.keys(p).some(
      (k) => !['gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'maxGasCostWei'].includes(k),
    )
  )
    throw new Error('SUBMISSION_POLICY');
  if (
    raw(p.gasLimit) > 30000000n ||
    raw(p.maxPriorityFeePerGas) > raw(p.maxFeePerGas) ||
    raw(p.gasLimit) * raw(p.maxFeePerGas) > raw(p.maxGasCostWei)
  )
    throw new Error('SUBMISSION_POLICY');
  return Object.freeze({ ...p });
}
/** Explicit private service only. No web, bootstrap, doctor or CI caller may enable signing. */
export async function submitRestrictedIntent(
  journal: OrderJournal,
  intent: OrderIntent,
  policy: SubmissionPolicy,
  signer: RestrictedSigner,
  transport: RestrictedTransport,
  revalidate: () => Promise<void>,
) {
  validateSubmissionPolicy(policy);
  if (
    signer.address.toLowerCase() !== intent.executor ||
    (await transport.chainId()) !== 46630 ||
    journal.blocked(intent.executor)
  )
    throw new Error('SUBMISSION_AUTHORITY');
  const order = journal.prepare(intent);
  if (order.state !== 'PREPARED') throw new Error('SUBMISSION_ALREADY_ATTEMPTED');
  const [pending, latest, balance] = await Promise.all([
    transport.nonce(intent.executor, 'pending'),
    transport.nonce(intent.executor, 'latest'),
    transport.balance(intent.executor),
  ]);
  if (!Number.isSafeInteger(pending) || pending < 0 || pending > 2147483647 || pending !== latest)
    throw new Error('SUBMISSION_NONCE_UNCERTAIN');
  if (balance < raw(policy.maxGasCostWei)) throw new Error('SUBMISSION_GAS_FUNDS');
  const transaction = Object.freeze({
    from: intent.executor,
    to: intent.feed ?? intent.vault,
    data: intent.calldata,
    chainId: '46630',
    value: '0',
    nonce: String(pending),
    type: '2',
    gasLimit: policy.gasLimit,
    maxFeePerGas: policy.maxFeePerGas,
    maxPriorityFeePerGas: policy.maxPriorityFeePerGas,
  });
  if ((await transport.estimate(transaction)) > raw(policy.gasLimit)) throw new Error('SUBMISSION_GAS_LIMIT');
  await revalidate();
  if (
    (await transport.chainId()) !== 46630 ||
    (await transport.nonce(intent.executor, 'pending')) !== pending ||
    (await transport.nonce(intent.executor, 'latest')) !== pending
  )
    throw new Error('SUBMISSION_STATE_CHANGED');
  // Reservation commits before the signer is invoked. A crash or failed signer leaves it blocked.
  journal.reserve(intent.id, String(pending));
  const signed = await signer.sign(transaction),
    parsed = Transaction.from(signed);
  if (
    parsed.type !== 2 ||
    parsed.gasLimit !== raw(policy.gasLimit) ||
    parsed.maxFeePerGas !== raw(policy.maxFeePerGas) ||
    parsed.maxPriorityFeePerGas !== raw(policy.maxPriorityFeePerGas)
  )
    throw new Error('SUBMISSION_SIGNED_POLICY');
  const hash = journal.signed(intent.id, signed);
  // Signing can take time; changed grants, quotes or chain identity must still block transmission.
  await revalidate();
  if (
    (await transport.chainId()) !== 46630 ||
    (await transport.nonce(intent.executor, 'pending')) !== pending ||
    (await transport.nonce(intent.executor, 'latest')) !== pending
  )
    throw new Error('SUBMISSION_STATE_CHANGED');
  const envelope = journal.claimBroadcast(intent.id);
  try {
    const response = await transport.send(envelope);
    if (response.toLowerCase() !== hash) throw new Error('SUBMISSION_RESPONSE');
  } catch {
    throw new Error('SUBMISSION_BROADCAST_UNCERTAIN');
  }
  return Object.freeze({ id: intent.id, transactionHash: hash, state: 'BROADCAST_UNCERTAIN' as const });
}
