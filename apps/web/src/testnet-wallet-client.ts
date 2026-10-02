import { hexlify, toUtf8Bytes } from 'ethers';
import { walletAddress } from '../../../packages/testnet/src/address.ts';
import { ownerAction, type OwnerActionIdentity } from '../../../packages/testnet/src/owner-actions.ts';
import { ROBINHOOD_CHAIN_TESTNET } from '../../../packages/robinhood-chain/src/network.ts';
import { loginMessage } from '../../../packages/testnet/src/login-message.ts';

export interface TestnetWalletProvider {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}
export type TestnetApi = (path: string, body?: unknown) => Promise<unknown>;
export async function testnetApi(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-alphaforge-client': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'WALLET_LOGIN_REQUIRED'
        : response.status === 503
          ? 'TESTNET_STORAGE_BLOCKED'
          : 'TESTNET_API_REJECTED',
    );
  return response.json();
}
export class TestnetWalletClient {
  readonly provider: TestnetWalletProvider;
  readonly api: TestnetApi;
  readonly origin: string;
  owner: string | null = null;
  #generation = 0;
  constructor(
    provider: TestnetWalletProvider,
    api: TestnetApi = testnetApi,
    origin = globalThis.location?.origin ?? '',
  ) {
    this.provider = provider;
    this.api = api;
    this.origin = origin;
  }
  async account(request = false): Promise<string> {
    const accounts = await this.provider.request({
      method: request ? 'eth_requestAccounts' : 'eth_accounts',
    });
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string')
      throw new Error('WALLET_ACCOUNT_REQUIRED');
    return walletAddress(accounts[0]);
  }
  async requireChain() {
    if (String(await this.provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
      throw new Error('WALLET_WRONG_CHAIN');
  }
  async login() {
    const generation = ++this.#generation;
    this.owner = null;
    const owner = await this.account(true);
    if (String(await this.provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626') {
      try {
        await this.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xb626' }],
        });
      } catch (error) {
        if ((error as { code?: unknown }).code !== 4902)
          throw new Error('WALLET_WRONG_CHAIN', { cause: error });
        await this.provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0xb626',
              chainName: ROBINHOOD_CHAIN_TESTNET.name,
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: [ROBINHOOD_CHAIN_TESTNET.rpcUrl],
              blockExplorerUrls: [ROBINHOOD_CHAIN_TESTNET.explorerUrl],
            },
          ],
        });
      }
    }
    await this.requireChain();
    const challenge = (await this.api('/api/testnet/auth/challenge', { owner })) as {
      nonce: string;
      message: string;
      expiresAt: number;
    };
    try {
      if (
        typeof challenge.message !== 'string' ||
        challenge.message.length > 2048 ||
        !/^[a-f0-9]{48}$/.test(challenge.nonce) ||
        !Number.isSafeInteger(challenge.expiresAt) ||
        challenge.expiresAt <= Date.now()
      )
        throw new Error();
      const issued = /^Issued At: (.+)$/m.exec(challenge.message)?.[1];
      if (!issued) throw new Error();
      const issuedAt = Date.parse(issued);
      if (
        issuedAt > Date.now() ||
        challenge.message !== loginMessage(this.origin, owner, challenge.nonce, issuedAt, challenge.expiresAt)
      )
        throw new Error();
    } catch {
      throw new Error('WALLET_CHALLENGE_INVALID');
    }
    const signature = await this.provider.request({
      method: 'personal_sign',
      params: [hexlify(toUtf8Bytes(challenge.message)), owner],
    });
    if (generation !== this.#generation || (await this.account()) !== owner)
      throw new Error('WALLET_IDENTITY_CHANGED');
    await this.requireChain();
    const session = (await this.api('/api/testnet/auth/verify', {
      owner,
      nonce: challenge.nonce,
      signature,
    })) as { owner: string; chainId: number };
    if (
      generation !== this.#generation ||
      (await this.account()) !== owner ||
      walletAddress(session.owner) !== owner ||
      session.chainId !== 46630
    ) {
      await this.logout();
      throw new Error('WALLET_IDENTITY_CHANGED');
    }
    try {
      await this.requireChain();
    } catch {
      await this.logout();
      throw new Error('WALLET_WRONG_CHAIN');
    }
    this.owner = owner;
    return owner;
  }
  async logout() {
    ++this.#generation;
    this.owner = null;
    await this.api('/api/testnet/auth/logout', {});
  }
  async assertOwner(identity: OwnerActionIdentity) {
    if (!this.owner || this.owner !== walletAddress(identity.owner) || (await this.account()) !== this.owner)
      throw new Error('WALLET_IDENTITY_CHANGED');
    await this.requireChain();
  }
  async send(
    identity: OwnerActionIdentity,
    input: unknown,
    preview: ReturnType<typeof ownerAction>,
  ): Promise<string> {
    await this.assertOwner(identity);
    const expected = ownerAction(identity, input);
    if (JSON.stringify(expected) !== JSON.stringify(preview)) throw new Error('WALLET_PREVIEW_MISMATCH');
    const generation = this.#generation;
    const hash = await this.provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: expected.from,
          to: expected.to,
          data: expected.data,
          value: expected.value,
          chainId: expected.chainId,
        },
      ],
    });
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new Error('WALLET_SUBMISSION_UNKNOWN');
    // The hash remains useful after an account change; only the original owner can observe it.
    if (generation !== this.#generation) this.owner = null;
    return hash.toLowerCase();
  }
}
