import type { LaunchClientState } from './launch-market/model.ts';

interface LiveRenderHost {
  originalMarketLayout?: boolean;
  homeHtml?: string;
  launchState?: LaunchClientState;
  rankings?: { teaser(): string };
  pages: { trade(id: string): string };
  app: { render(options?: { preserve?: boolean }): void };
}

const identity = (state: LaunchClientState | undefined) =>
  [
    state?.owner?.toLowerCase(),
    state?.account?.id,
    state?.account?.wallet?.toLowerCase(),
    state?.account?.identityKind,
    state?.account?.emailVerified,
    state?.wallet?.accountId,
    state?.config?.emailVerificationRequired !== false,
  ].join('/');

/** Background reads update the retained workshop without replaying route-entry animation. */
export function installLiveRendering(host: LiveRenderHost, doc: Document = document): void {
  if (!host.originalMarketLayout) return;
  const original = host.app.render;
  let lastRoute: string | undefined;
  let lastIdentity: string | undefined;
  let lastHtml: string | undefined;
  let sections = new Map<string, string>();

  host.app.render = (options) => {
    const main = doc.getElementById('main');
    const route = doc.defaultView?.location.hash || '#/home';
    const who = identity(host.launchState);
    const sameContext = route === lastRoute && who === lastIdentity;
    // The native router owns navigation, account pages, dialogs and all authorization.
    // Compare only the home/Trade render output; block numbers alone do not change these pages.
    const match = /^#\/trade\/(tsla|amzn)$/.exec(route);
    const html = match
      ? host.pages.trade(match[1]!)
      : ['#/home', '#home', ''].includes(route) && host.homeHtml !== undefined && host.rankings
        ? host.homeHtml + host.rankings.teaser()
        : undefined;
    if (options?.preserve && sameContext && html !== undefined && html === lastHtml) return;

    const nextSections = new Map<string, string>();
    const retained = new Map<string, Element>();
    if (main && html !== undefined) {
      const template = doc.createElement('template');
      template.innerHTML = html;
      for (const id of ['trade-price', 'trade-returns']) {
        const next = template.content.getElementById(id);
        if (!next) continue;
        const markup = next.outerHTML;
        nextSections.set(id, markup);
        const current = doc.getElementById(id);
        if (
          options?.preserve &&
          sameContext &&
          sections.get(id) === markup &&
          current &&
          main.contains(current)
        )
          retained.set(id, current);
      }
    }
    const active = doc.activeElement;
    const input =
      options?.preserve &&
      sameContext &&
      active instanceof HTMLInputElement &&
      active.id &&
      main?.contains(active)
        ? active
        : null;
    const selection = input
      ? {
          id: input.id,
          name: input.name,
          type: input.type,
          form: input.form?.dataset.operation,
          start: input.selectionStart,
          end: input.selectionEnd,
          direction: input.selectionDirection,
        }
      : null;

    original.call(host.app, options);
    if (options?.preserve) main?.classList.remove('page-enter');
    for (const [id, current] of retained) doc.getElementById(id)?.replaceWith(current);
    if (selection) {
      const next = doc.getElementById(selection.id);
      if (
        next instanceof HTMLInputElement &&
        next.name === selection.name &&
        next.type === selection.type &&
        next.form?.dataset.operation === selection.form
      ) {
        next.focus({ preventScroll: true });
        if (selection.start !== null && selection.end !== null)
          next.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
      }
    }
    lastRoute = route;
    lastIdentity = who;
    lastHtml = html;
    sections = nextSections;
  };
}
