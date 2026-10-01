import { gzipSync, gunzipSync } from 'node:zlib';
import { requireValue } from './robinhood.ts';
export const MAX_BATCH_BYTES = 48 * 1024 * 1024;
const MAX_STORED_BYTES = 64 * 1024 * 1024 + 1048576;
export function encodeBatchPayload(payload: string): string {
  requireValue(Buffer.byteLength(payload) <= MAX_BATCH_BYTES, 'BATCH_TOO_LARGE');
  return 'AFG1:' + gzipSync(Buffer.from(payload)).toString('base64');
}
/** New readers retain legacy plain JSON rows; the receipt hash always covers uncompressed bytes. */
export function decodeBatchPayload(stored: unknown): string {
  requireValue(
    typeof stored === 'string' && Buffer.byteLength(stored) <= MAX_STORED_BYTES,
    'BATCH_INTEGRITY_FAILED',
  );
  if (!stored.startsWith('AFG1:')) {
    requireValue(Buffer.byteLength(stored) <= MAX_BATCH_BYTES, 'BATCH_INTEGRITY_FAILED');
    return stored;
  }
  const encoded = stored.slice(5);
  requireValue(
    encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    'BATCH_INTEGRITY_FAILED',
  );
  try {
    const bytes = Buffer.from(encoded, 'base64');
    requireValue(bytes.toString('base64') === encoded, 'BATCH_INTEGRITY_FAILED');
    return new TextDecoder('utf-8', { fatal: true }).decode(
      gunzipSync(bytes, { maxOutputLength: MAX_BATCH_BYTES }),
    );
  } catch {
    throw new Error('BATCH_INTEGRITY_FAILED');
  }
}
