import type { ClientPhase } from './product-client.ts';

export function productSessionPresentation(
  snapshot: { phase: ClientPhase; user: string | null },
  mode: 'v1' | 'legacy' | 'unknown' | null,
) {
  const usable = !!snapshot.user && ['READY', 'EMPTY', 'PENDING'].includes(snapshot.phase);
  const hint = !snapshot.user
    ? snapshot.phase === 'LOADING'
      ? 'Reading the local session…'
      : 'Choose Alice or Bob to connect a local simulation account. This does not connect a wallet.'
    : snapshot.phase === 'EMPTY'
      ? 'This identity has no backend Vaults. Claim test access from the API catalogue; the service is connected.'
      : snapshot.phase === 'LOADING'
        ? 'Refreshing this identity. Previous data is unavailable for new actions until the read completes.'
        : snapshot.phase === 'STALE'
          ? 'Account state changed. Refresh and review it before a new action; unresolved requests stay retained.'
          : snapshot.phase === 'DISCONNECTED' || snapshot.phase === 'ERROR'
            ? 'The local API is unavailable. Cached account data is not current. Refresh API or reconnect this identity; no funds were confirmed by this error.'
            : snapshot.phase === 'PENDING'
              ? 'An original request remains unresolved. Review its receipt before another action.'
              : 'Local simulation account connected. Test access and simulated funds are separate from wallet assets.';
  return {
    usable,
    hint,
    mode:
      mode === 'v1' || mode === 'legacy' ? mode : snapshot.phase === 'LOADING' ? 'connecting' : 'unavailable',
  };
}
