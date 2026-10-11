import { lstatSync, realpathSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { FastifyRequest } from 'fastify';
import type { TrustedVerifiedIdentity } from './access-identity.ts';

export const IDENTITY_SOCKET_PATH = '/v1/identity';
export const ACCESS_POLICY_SOCKET_PATH = '/v1/access-policy';
export const IDENTITY_SOCKET_MAX_BYTES = 1024;
export const IDENTITY_SOCKET_TIMEOUT_MS = 1000;
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export interface IdentitySocketQuery {
  readonly sessionToken: string;
  readonly method: string;
  readonly csrfToken: string | null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
export function identitySocketQuery(value: unknown): IdentitySocketQuery | null {
  if (
    !object(value) ||
    !keys(value, ['sessionToken', 'method', 'csrfToken']) ||
    typeof value.sessionToken !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.sessionToken) ||
    typeof value.method !== 'string' ||
    !methods.has(value.method) ||
    (value.csrfToken !== null &&
      (typeof value.csrfToken !== 'string' ||
        value.csrfToken.length === 0 ||
        Buffer.byteLength(value.csrfToken) > 256))
  )
    return null;
  return value as unknown as IdentitySocketQuery;
}
export function identitySocketResponse(value: unknown): TrustedVerifiedIdentity | null {
  if (!object(value) || !keys(value, ['identity'])) return null;
  const identity = value.identity;
  if (
    !object(identity) ||
    !keys(identity, ['email', 'subject', 'verified']) ||
    typeof identity.email !== 'string' ||
    Buffer.byteLength(identity.email) === 0 ||
    Buffer.byteLength(identity.email) > 320 ||
    typeof identity.subject !== 'string' ||
    Buffer.byteLength(identity.subject) === 0 ||
    Buffer.byteLength(identity.subject) > 256 ||
    identity.verified !== true
  )
    return null;
  return { email: identity.email, subject: identity.subject, verified: true };
}

/** The configured endpoint is protected by its owning service's non-writable directory. */
export function identitySocketDirectory(path: string) {
  if (
    !isAbsolute(path) ||
    resolve(path) !== path ||
    Buffer.byteLength(path) > 100 ||
    realpathSync(dirname(path)) !== dirname(path)
  )
    throw new Error('IDENTITY_SOCKET_UNSAFE_PATH');
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || (parent.mode & 0o777) !== 0o710)
    throw new Error('IDENTITY_SOCKET_UNSAFE_DIRECTORY');
  return parent;
}

/** No identity cache or token logging. Only an operator-selected Unix socket is contacted. */
export class AccessIdentitySocketClient {
  readonly #path: string;
  constructor(path: string) {
    identitySocketDirectory(path);
    this.#path = path;
  }
  async identity(
    request: Pick<FastifyRequest, 'method' | 'cookies' | 'headers'>,
  ): Promise<TrustedVerifiedIdentity | null> {
    const csrf = request.headers['x-csrf-token'];
    const query = identitySocketQuery({
      sessionToken: request.cookies['__Host-ikol_session'],
      method: request.method,
      csrfToken: typeof csrf === 'string' ? csrf : null,
    });
    if (!query) return null;
    return identitySocketResponse(await this.#read(IDENTITY_SOCKET_PATH, query));
  }
  async verificationRequired(): Promise<boolean> {
    const result = await this.#read(ACCESS_POLICY_SOCKET_PATH, null);
    return (
      !object(result) || !keys(result, ['verificationRequired']) || result.verificationRequired !== false
    );
  }
  async #read(path: string, query: IdentitySocketQuery | null): Promise<unknown> {
    try {
      const parent = identitySocketDirectory(this.#path),
        socket = lstatSync(this.#path);
      if (
        !socket.isSocket() ||
        socket.nlink !== 1 ||
        socket.uid !== parent.uid ||
        socket.gid !== parent.gid ||
        (socket.mode & 0o777) !== 0o660 ||
        realpathSync(this.#path) !== this.#path
      )
        return null;
      const body = query === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(query));
      if (body.length > IDENTITY_SOCKET_MAX_BYTES) return null;
      return await new Promise<unknown>((complete) => {
        let settled = false;
        const done = (value: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          outgoing.destroy();
          complete(value);
        };
        const outgoing = httpRequest(
          {
            socketPath: this.#path,
            method: query === null ? 'GET' : 'POST',
            path,
            agent: false,
            headers: {
              'content-type': 'application/json',
              'content-length': body.length,
              accept: 'application/json',
              connection: 'close',
            },
          },
          (response) => {
            if (
              response.statusCode !== 200 ||
              response.headers['content-type'] !== 'application/json' ||
              response.headers['content-encoding'] !== undefined
            ) {
              response.destroy();
              done(null);
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > IDENTITY_SOCKET_MAX_BYTES) {
                response.destroy();
                done(null);
              } else chunks.push(chunk);
            });
            response.on('error', () => done(null));
            response.on('aborted', () => done(null));
            response.on('end', () => {
              try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
                done(JSON.parse(text));
              } catch {
                done(null);
              }
            });
          },
        );
        const deadline = setTimeout(() => done(null), IDENTITY_SOCKET_TIMEOUT_MS);
        outgoing.on('error', () => done(null));
        outgoing.end(body);
      });
    } catch {
      return null;
    }
  }
}
