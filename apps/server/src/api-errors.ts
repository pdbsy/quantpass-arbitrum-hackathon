// Only fixed public codes/messages cross the API boundary; never serialize an Error.
const conflictCodes = new Set([
  'UNKNOWN_STRATEGY',
  'INVALID_ID',
  'UNKNOWN_COMMAND',
  'SETTLEMENT_POLICY_REQUIRED',
  'INVALID_TEST_FEE',
  'INVALID_EXCESS_ALLOCATION',
  'SESSION_LIMIT',
  'IDEMPOTENCY_CONFLICT',
  'REVISION_CONFLICT',
  'TEST_HISTORY_LIMIT',
  'NON_POSITIVE_AMOUNT',
  'INSUFFICIENT_IDLE',
  'ALLOWANCE_EXCEEDED',
  'INSUFFICIENT_ACTIVE_CASH',
  'WITHDRAWAL_NOT_PENDING',
  'NO_ACTIVE_FUNDS',
  'INVALID_STATUS',
  'NOT_RUNNING',
  'DUPLICATE_ORDER',
  'ORDER_NOT_PENDING',
  'NO_POSITION',
  'PENDING_ORDERS',
  'EXCESS_FEE_PAYMENT',
]);
const errors: Readonly<Record<string, { status: number; message: string; retryable: boolean }>> = {
  INVALID_REQUEST: { status: 400, message: '请求格式或参数无效。', retryable: false },
  SESSION_REQUIRED: { status: 401, message: '请先选择本地演示账户。', retryable: false },
  FORBIDDEN: { status: 403, message: '该操作不可用。', retryable: false },
  HOST_REJECTED: { status: 403, message: '请求来源不可用。', retryable: false },
  ORIGIN_REJECTED: { status: 403, message: '请求来源不可用。', retryable: false },
  CROSS_SITE_REJECTED: { status: 403, message: '请求来源不可用。', retryable: false },
  DEMO_HEADER_REQUIRED: { status: 403, message: '需要本地演示请求标记。', retryable: false },
  VAULT_NOT_FOUND: { status: 404, message: '未找到该 Vault。', retryable: false },
  RATE_LIMITED: { status: 429, message: '请求过于频繁，请稍后重试。', retryable: true },
  LOCAL_OPERATION_FAILED: { status: 500, message: '本地操作未完成，请稍后重试。', retryable: true },
};
export function apiError(requestedCode: string) {
  const definition = Object.hasOwn(errors, requestedCode) ? errors[requestedCode] : undefined;
  const conflict = conflictCodes.has(requestedCode);
  const code = definition || conflict ? requestedCode : 'LOCAL_OPERATION_FAILED';
  const detail =
    definition ??
    (conflict
      ? { status: 409, message: '当前状态不允许该操作，请读取最新状态后检查请求。', retryable: false }
      : errors.LOCAL_OPERATION_FAILED!);
  return {
    status: detail.status,
    body: { error: code, code, message: detail.message, retryable: detail.retryable },
  };
}
