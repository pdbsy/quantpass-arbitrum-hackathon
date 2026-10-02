import { walletAddress } from './address.ts';
import type { RestrictedTransport } from './restricted-submission.ts';

/** Private fixed-method transport. A send has one HTTP attempt and never falls back or retries. */
export function testnetSubmissionTransport(
  endpoint: string,
  transport: typeof fetch = fetch,
): RestrictedTransport {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('SUBMISSION_ENDPOINT');
  let id = 0;
  const request = async (method: string, params: readonly unknown[]) => {
    const current = ++id,
      response = await transport(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: current, method, params }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    if (response.status !== 200 || !response.body) throw new Error('SUBMISSION_RPC');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) {
          await reader.cancel();
          throw new Error('SUBMISSION_RPC_CAPACITY');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)),
    ) as { jsonrpc: unknown; id: unknown; error?: unknown; result?: unknown };
    if (
      result.jsonrpc !== '2.0' ||
      result.id !== current ||
      result.error !== undefined ||
      !Object.hasOwn(result, 'result')
    )
      throw new Error('SUBMISSION_RPC');
    return result.result;
  };
  const uint = (v: unknown) => {
    if (typeof v !== 'string' || !/^0x(0|[1-9a-fA-F][a-fA-F0-9]{0,63})$/.test(v))
      throw new Error('SUBMISSION_RPC');
    return BigInt(v);
  };
  const hex = (v: string) => {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 2n ** 256n) throw new Error('SUBMISSION_REQUEST');
    return '0x' + BigInt(v).toString(16);
  };
  return Object.freeze({
    chainId: async () => {
      const chain = uint(await request('eth_chainId', []));
      if (chain !== 46630n) throw new Error('SUBMISSION_CHAIN');
      return 46630;
    },
    nonce: async (address: string, block: 'pending' | 'latest') => {
      if (!['pending', 'latest'].includes(block)) throw new Error('SUBMISSION_REQUEST');
      const n = uint(await request('eth_getTransactionCount', [walletAddress(address), block]));
      if (n > 2147483647n) throw new Error('SUBMISSION_NONCE');
      return Number(n);
    },
    balance: async (address: string) =>
      uint(await request('eth_getBalance', [walletAddress(address), 'latest'])),
    estimate: async (tx: Readonly<Record<string, string>>) => {
      const fields = [
        'from',
        'to',
        'data',
        'chainId',
        'value',
        'nonce',
        'type',
        'gasLimit',
        'maxFeePerGas',
        'maxPriorityFeePerGas',
      ];
      if (
        Object.keys(tx).length !== fields.length ||
        fields.some((k) => typeof tx[k] !== 'string') ||
        tx.chainId !== '46630' ||
        tx.value !== '0' ||
        tx.type !== '2' ||
        !/^0x(?:[a-fA-F0-9]{2}){4,4096}$/.test(tx.data!)
      )
        throw new Error('SUBMISSION_REQUEST');
      return uint(
        await request('eth_estimateGas', [
          {
            from: walletAddress(tx.from!),
            to: walletAddress(tx.to!),
            data: tx.data,
            chainId: '0xb626',
            value: '0x0',
            nonce: hex(tx.nonce!),
            type: '0x2',
            gas: hex(tx.gasLimit!),
            maxFeePerGas: hex(tx.maxFeePerGas!),
            maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas!),
          },
        ]),
      );
    },
    send: async (raw: string) => {
      if (!/^0x(?:[a-fA-F0-9]{2}){1,16384}$/.test(raw)) throw new Error('SUBMISSION_REQUEST');
      const hash = await request('eth_sendRawTransaction', [raw]);
      if (typeof hash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('SUBMISSION_RPC');
      return hash.toLowerCase();
    },
  });
}
