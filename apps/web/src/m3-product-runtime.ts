import { parseUnits } from '../../../packages/domain/src/money.ts';
import { asAddress, type Address } from '../../../packages/chain-adapter/src/types.ts';
import type { WalletSubmission } from './chain-wallet.ts';
import type {
  M3ProductChainPresentation,
  M3VaultSelection,
  M3VaultSelectionState,
  OnchainProductAction,
} from './m3-product-shell.ts';
import type { DepositAuthorizationPresentation } from './m3-product-shell.ts';

const PASS_BASE_UNITS_PER_AF_USDC_BASE_UNIT = 1_000_000_000_000n;

export type M3ProductActionRequest =
  | { readonly kind: 'deposit'; readonly usdcBaseUnits: string }
  | { readonly kind: 'withdraw'; readonly usdcBaseUnits: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'rescue-token'; readonly token: Address }
  | { readonly kind: 'rescue-native' };

export interface M3ProductActionReview {
  readonly operationId: string;
  readonly owner: Address;
  readonly request: M3ProductActionRequest;
}

export interface M3PassTransferRequest {
  readonly recipient: Address;
  readonly passBaseUnits: string;
}

export interface M3PassTransferReview {
  readonly operationId: string;
  readonly owner: Address;
  readonly token: Address;
  readonly request: M3PassTransferRequest;
}

export type M3DepositApprovalKind = 'af-usdc' | 'pass';

export interface M3DepositApprovalRequirement {
  readonly kind: M3DepositApprovalKind;
  readonly token: Address;
  readonly spender: Address;
  readonly requiredRaw: string;
  readonly allowance: string;
  readonly sufficient: boolean;
}

export interface M3DepositApprovalReview {
  readonly owner: Address;
  readonly vaultAddress: Address;
  readonly request: Extract<M3ProductActionRequest, { readonly kind: 'deposit' }>;
  readonly requirements: readonly [M3DepositApprovalRequirement, M3DepositApprovalRequirement];
}

export type { M3VaultSelection, M3VaultSelectionState } from './m3-product-shell.ts';

export interface M3ProductRuntime {
  readonly snapshot: M3ProductChainPresentation;
  readonly vaultSelection?: M3VaultSelectionState;
  connect(): Promise<void>;
  refresh(): Promise<void>;
  selectVault?(selection: M3VaultSelection): Promise<void>;
  reviewAction(request: M3ProductActionRequest): Promise<M3ProductActionReview>;
  confirmAction(review: M3ProductActionReview): Promise<WalletSubmission>;
  reviewPassTransfer?(request: M3PassTransferRequest): Promise<M3PassTransferReview>;
  confirmPassTransfer?(review: M3PassTransferReview): Promise<WalletSubmission>;
  reviewDepositApprovals?(
    request: Extract<M3ProductActionRequest, { readonly kind: 'deposit' }>,
  ): Promise<M3DepositApprovalReview>;
  confirmDepositApproval?(
    review: M3DepositApprovalReview,
    kind: M3DepositApprovalKind,
  ): Promise<WalletSubmission>;
  subscribe(listener: () => void): () => void;
}

export interface M3SelectableProductRuntime extends M3ProductRuntime {
  readonly vaultSelection: M3VaultSelectionState;
  selectVault(selection: M3VaultSelection): Promise<void>;
}

export interface RequiredDepositAllowances {
  readonly afUsdcBaseUnits: string;
  readonly passBaseUnits: string;
}

export interface DepositAllowanceContext extends DepositAuthorizationPresentation {
  readonly vaultAddress: string;
}

export function requiredDepositAllowances(
  request: Extract<M3ProductActionRequest, { readonly kind: 'deposit' }>,
): RequiredDepositAllowances {
  return Object.freeze({
    afUsdcBaseUnits: request.usdcBaseUnits,
    passBaseUnits: (BigInt(request.usdcBaseUnits) * PASS_BASE_UNITS_PER_AF_USDC_BASE_UNIT).toString(),
  });
}

export function depositAllowanceCheck(
  request: Extract<M3ProductActionRequest, { readonly kind: 'deposit' }>,
  authorization: DepositAllowanceContext,
): {
  readonly status: 'READY' | 'APPROVAL_REQUIRED' | 'UNAVAILABLE';
  readonly required: RequiredDepositAllowances;
} {
  const required = requiredDepositAllowances(request);
  const validAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const validUnits = (value: string) => /^(0|[1-9][0-9]*)$/.test(value);
  if (
    !validAddress(authorization.vaultAddress) ||
    !validAddress(authorization.spender) ||
    authorization.vaultAddress.toLowerCase() !== authorization.spender.toLowerCase() ||
    !validUnits(authorization.afUsdcAllowanceBaseUnits) ||
    !validUnits(authorization.passAllowanceBaseUnits)
  )
    return Object.freeze({ status: 'UNAVAILABLE', required });
  const ready =
    BigInt(authorization.afUsdcAllowanceBaseUnits) >= BigInt(required.afUsdcBaseUnits) &&
    BigInt(authorization.passAllowanceBaseUnits) >= BigInt(required.passBaseUnits);
  return Object.freeze({ status: ready ? 'READY' : 'APPROVAL_REQUIRED', required });
}

export function sameM3ProductAction(left: M3ProductActionRequest, right: M3ProductActionRequest): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'deposit':
    case 'withdraw':
      return right.kind === left.kind && left.usdcBaseUnits === right.usdcBaseUnits;
    case 'rescue-token':
      return right.kind === 'rescue-token' && left.token.toLowerCase() === right.token.toLowerCase();
    case 'close':
    case 'rescue-native':
      return true;
  }
}

export function parseM3ProductAction(
  action: Extract<OnchainProductAction, 'deposit' | 'withdraw' | 'close'>,
  amount?: string,
): M3ProductActionRequest {
  if (action === 'close') {
    if (amount !== undefined) throw new Error('CLOSE_AMOUNT_FORBIDDEN');
    return Object.freeze({ kind: 'close' });
  }
  if (amount === undefined) throw new Error('AMOUNT_REQUIRED');
  const usdcBaseUnits = parseUnits(amount, 6);
  if (BigInt(usdcBaseUnits) <= 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE');
  return Object.freeze({ kind: action, usdcBaseUnits });
}

export function parseM3RescueAction(
  action: Extract<OnchainProductAction, 'rescue-token' | 'rescue-native'>,
  token?: string,
): Extract<M3ProductActionRequest, { readonly kind: 'rescue-token' | 'rescue-native' }> {
  if (action === 'rescue-native') {
    if (token !== undefined) throw new Error('RESCUE_NATIVE_TOKEN_FORBIDDEN');
    return Object.freeze({ kind: 'rescue-native' });
  }
  if (token === undefined) throw new Error('RESCUE_TOKEN_REQUIRED');
  const parsedToken = asAddress(token);
  if (/^0x0{40}$/i.test(parsedToken)) throw new Error('RESCUE_TOKEN_REQUIRED');
  return Object.freeze({ kind: 'rescue-token', token: parsedToken });
}

export function parseM3PassTransfer(recipient: string, amount: string): M3PassTransferRequest {
  const parsedRecipient = asAddress(recipient);
  if (/^0x0{40}$/i.test(parsedRecipient)) throw new Error('PASS_RECIPIENT_REQUIRED');
  const passBaseUnits = parseUnits(amount, 18);
  if (BigInt(passBaseUnits) <= 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE');
  return Object.freeze({ recipient: parsedRecipient, passBaseUnits });
}
