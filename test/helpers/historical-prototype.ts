import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// These fixtures test historical fictional-wallet behavior. They never stand in
// for the current native market, its stock feed, or onchain accounting evidence.
export const HISTORICAL_PROTOTYPES = {
  reviewedRepair: {
    commit: '3e0e4303dc6d6621aa71b450752e2446faec759b',
    sha256: 'b9671bca14a388d08a7e5db492f831c5e02fcb15f8ff57baab8a65e863d4ff35',
    bytes: 286508,
  },
  mockHoldings: {
    commit: 'd4ace125257188d808e530c9f59beeb4a29e8ef2',
    sha256: '60931718e8a35b57b98f3ed7626ee501a0f74a9979789b91bfb73f810db8d0ca',
    bytes: 294417,
  },
} as const;

export function readHistoricalPrototype(
  revision: keyof typeof HISTORICAL_PROTOTYPES,
  root = fileURLToPath(new URL('../../', import.meta.url)),
): string {
  const artifact = HISTORICAL_PROTOTYPES[revision];
  assert.ok(artifact, 'only fixed historical prototype fixtures are available');
  const source = execFileSync(
    'git',
    ['--no-replace-objects', 'show', `${artifact.commit}:apps/web/prototype/AlphaForge_v3_EN.html`],
    { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(Buffer.byteLength(source), artifact.bytes, 'historical fixture bytes must remain exact');
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    artifact.sha256,
    'historical fixture digest must remain exact',
  );
  return source;
}
