import { getAddress } from 'ethers';
export function walletAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0+$/.test(value)) throw new Error('AUTH_ADDRESS');
  return getAddress(value).toLowerCase();
}
