import type { InterfaceAbi } from 'ethers';
export function validateV3Artifact(
  entry: unknown,
  text: string,
): { contractName: string; abi: InterfaceAbi; bytecode: string; deployedBytecode: string };
export function checkV3Artifacts(): Promise<unknown>;
