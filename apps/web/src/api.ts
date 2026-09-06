import type { view } from '../../server/src/app.ts';
export type Vault = ReturnType<typeof view>;
export type Audit = { revision: number; command_type: string; actor_id: string; recorded_at: string };
export class ApiError extends Error {
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'x-quantpass-demo': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'REQUEST_FAILED', response.status);
  return data as T;
}
