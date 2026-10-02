import { hashMessage, Interface } from 'ethers';
import type { ReadonlyRpc } from '../../chain-adapter/src/rpc.ts';
import { asAddress, asHexData } from '../../chain-adapter/src/types.ts';
import { verifyWalletMessage, walletAddress } from './wallet-auth.ts';

const wallet = new Interface([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
]);
const magic = `0x1626ba7e${'00'.repeat(28)}`;

/** Read-only EOA / ERC-1271 login verification, bound to one canonical Testnet snapshot. */
export function createWalletVerifier(rpc?: ReadonlyRpc) {
  return async (message: string, signature: string, expectedOwner: string): Promise<boolean> => {
    if (message.length === 0 || message.length > 2048 || !/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(signature))
      return false;
    try {
      const owner = asAddress(walletAddress(expectedOwner));
      if (verifyWalletMessage(message, signature, owner)) return true;
      if (!rpc || (await rpc.chainId()) !== 46630) return false;
      const block = await rpc.block('latest');
      if (!block) return false;
      const snapshot = { blockHash: block.hash, requireCanonical: true } as const;
      if ((await rpc.code(owner, snapshot)) === '0x') return false;
      const result = await rpc.call(
        {
          to: owner,
          data: asHexData(wallet.encodeFunctionData('isValidSignature', [hashMessage(message), signature])),
        },
        snapshot,
      );
      if (result.toLowerCase() !== magic) return false;
      const confirmed = await rpc.block(block.number);
      return confirmed?.hash === block.hash;
    } catch {
      return false;
    }
  };
}
