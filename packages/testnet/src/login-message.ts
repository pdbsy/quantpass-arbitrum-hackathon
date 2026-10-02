import { getAddress } from 'ethers';

/** Login-only text shared by the server and wallet; never an execution grant. */
export function loginMessage(
  origin: string,
  owner: string,
  nonce: string,
  issuedAt: number,
  expiresAt: number,
) {
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !/^[a-f0-9]{48}$/.test(nonce) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt < 0 ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 300000
  )
    throw new Error('LOGIN_MESSAGE_INVALID');
  return `${url.host} wants you to sign in with your Ethereum account:\n${getAddress(owner)}\n\nThis signature only logs in to AlphaForge Testnet. It does not authorize trades or withdrawals.\n\nURI: ${origin}\nVersion: 1\nChain ID: 46630\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
}
