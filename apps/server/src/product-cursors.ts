import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../../packages/domain/src/vault.ts';

// Process-local signing means a restart expires outstanding cursors, not persisted data.
export function productCursors() {
  const key = randomBytes(32);
  const sign = (text: string) => createHmac('sha256', key).update(text).digest();
  return {
    encode(scope: string, position: string) {
      const payload = Buffer.from(JSON.stringify([1, scope, position])).toString('base64url');
      return `${payload}.${sign(payload).toString('base64url')}`;
    },
    decode(token: string | undefined, scope: string) {
      if (token === undefined) return undefined;
      try {
        if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
        const [payload, signature] = token.split('.') as [string, string];
        const expected = sign(payload),
          actual = Buffer.from(signature, 'base64url');
        if (
          actual.toString('base64url') !== signature ||
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw new Error();
        const value: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (
          !Array.isArray(value) ||
          value.length !== 3 ||
          value[0] !== 1 ||
          value[1] !== scope ||
          typeof value[2] !== 'string'
        )
          throw new Error();
        return value[2];
      } catch {
        throw new DomainError('INVALID_REQUEST');
      }
    },
  };
}
