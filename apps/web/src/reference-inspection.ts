import { observeStockInspectionRender } from './stock-inspection.ts';
import type { StockHistoryHost } from './stock-history.ts';

export interface ReferenceInspectionHost {
  readonly charts: { readonly G: { readonly L: number; readonly R: number } };
  readonly app: StockHistoryHost['app'];
}
export interface ReferenceInspectionBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly lineY: number;
}
export interface ReferenceInspectionDetails {
  readonly heading: string;
  readonly kind: 'Initial reference';
  readonly fields: readonly { readonly key: string; readonly label: string; readonly value: string }[];
  readonly note: string;
}

/** The reference is a configuration value, with no executed candle, date or volume behind it. */
export function referenceInspectionDetails(
  symbol: string,
  reference: string,
): ReferenceInspectionDetails | null {
  const ticker = symbol.toUpperCase();
  if (!['TSLA', 'AMZN'].includes(ticker) || !['0.5', '0.50'].includes(reference)) return null;
  return Object.freeze({
    heading: `${ticker} PASS details`,
    kind: 'Initial reference',
    fields: Object.freeze(
      [
        { key: 'symbol', label: 'Strategy', value: ticker },
        { key: 'price', label: 'Reference price', value: '0.50 AF-USDC/PASS' },
        { key: 'source', label: 'Source', value: 'Initial reference' },
        { key: 'status', label: 'Trade data', value: 'No indexed trades' },
        { key: 'executedPrice', label: 'Executed price', value: '—' },
        { key: 'tradeTime', label: 'Trade time', value: '—' },
        { key: 'volume', label: 'Trade volume', value: '—' },
      ].map((field) => Object.freeze(field)),
    ),
    note: 'This flat line is the initial price reference. It has no executed trade time or volume and is not a guaranteed resale price.',
  });
}

/** A pointer within the plot selects the reference line, never an invented historical data point. */
export function referenceInspectionPosition(
  x: number,
  y: number,
  bounds: ReferenceInspectionBounds,
): { readonly x: number; readonly y: number } | null {
  const { left, right, top, bottom, lineY } = bounds;
  if (
    ![x, y, left, right, top, bottom, lineY].every(Number.isFinite) ||
    !(right > left) ||
    !(bottom > top) ||
    lineY < top ||
    lineY > bottom ||
    x < left ||
    x > right ||
    y < top ||
    y > bottom
  )
    return null;
  return { x, y: lineY };
}

const selector = '#trade-price svg.price-chart-svg[data-price-reference]';
const svgNamespace = 'http://www.w3.org/2000/svg';

/** Inspect only the empty-market reference SVG. The ordinary candle inspector remains separate. */
export function installReferenceInspection(
  host: ReferenceInspectionHost,
  doc: Document = document,
): () => void {
  const view = doc.defaultView;
  const focusAttributes = new Map<SVGSVGElement, string | null>();
  let panel: HTMLElement | undefined,
    selected: SVGSVGElement | undefined,
    cursor: SVGGElement | undefined,
    previousDescription: string | null = null,
    selectedX: number | undefined,
    selectedSymbol: string | undefined,
    selectedRatio = 0.5,
    lastPointer: { clientX: number; clientY: number } | undefined,
    touch = false,
    frame: number | undefined,
    stopped = false;
  const chartFor = (target: EventTarget | null): SVGSVGElement | null =>
    target instanceof Element ? target.closest<SVGSVGElement>(selector) : null;

  function clear(reset = true) {
    panel?.remove();
    panel = undefined;
    cursor?.remove();
    cursor = undefined;
    if (selected) {
      if (previousDescription === null) selected.removeAttribute('aria-describedby');
      else selected.setAttribute('aria-describedby', previousDescription);
    }
    selected = undefined;
    selectedX = undefined;
    previousDescription = null;
    if (reset) {
      if (frame !== undefined) view?.cancelAnimationFrame(frame);
      frame = undefined;
      selectedSymbol = undefined;
      lastPointer = undefined;
      touch = false;
    }
  }

  function prepare() {
    if (stopped) return;
    for (const svg of focusAttributes.keys()) if (!svg.isConnected) focusAttributes.delete(svg);
    for (const svg of doc.querySelectorAll<SVGSVGElement>(selector)) {
      if (!focusAttributes.has(svg)) focusAttributes.set(svg, svg.getAttribute('tabindex'));
      svg.setAttribute('tabindex', '0');
    }
  }

  function boundsFor(svg: SVGSVGElement): ReferenceInspectionBounds | null {
    const path = svg.querySelector<SVGPathElement>('path');
    if (!path) return null;
    try {
      const length = path.getTotalLength(),
        start = path.getPointAtLength(0),
        end = path.getPointAtLength(length),
        middle = path.getPointAtLength(length / 2),
        grid = [...svg.querySelectorAll<SVGLineElement>('line.chart-gridline')].map((line) =>
          Number(line.getAttribute('y1') ?? NaN),
        );
      if (
        length <= 0 ||
        grid.length < 2 ||
        !grid.every(Number.isFinite) ||
        Math.abs(start.y - end.y) > 0.001 ||
        Math.abs(middle.y - start.y) > 0.001
      )
        return null;
      const bounds = {
        left: Math.max(Math.min(start.x, end.x), host.charts.G.L),
        right: Math.min(Math.max(start.x, end.x), host.charts.G.R),
        top: Math.min(...grid),
        bottom: Math.max(...grid),
        lineY: start.y,
      };
      return referenceInspectionPosition(bounds.left, bounds.lineY, bounds) ? bounds : null;
    } catch {
      return null;
    }
  }

  function detailsFor(svg: SVGSVGElement): ReferenceInspectionDetails | null {
    const title = svg.closest('#trade-price')?.querySelector('#price-title .micro')?.textContent ?? '',
      ticker = /^\s*(TSLA|AMZN)\s*\/\s*AF-USDC\s*$/i.exec(title)?.[1];
    return ticker ? referenceInspectionDetails(ticker, svg.dataset.priceReference ?? '') : null;
  }

  function place(svg: SVGSVGElement, position: { readonly x: number; readonly y: number }) {
    if (!panel) return;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = position.x;
    point.y = position.y;
    const screen = point.matrixTransform(matrix),
      width = view?.innerWidth ?? doc.documentElement.clientWidth,
      height = view?.innerHeight ?? doc.documentElement.clientHeight,
      box = panel.getBoundingClientRect(),
      left = screen.x < width / 2 ? screen.x + 14 : screen.x - box.width - 14;
    panel.style.left = Math.max(8, Math.min(left, width - box.width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(screen.y - box.height / 2, height - box.height - 8)) + 'px';
  }

  function show(svg: SVGSVGElement, position: { readonly x: number; readonly y: number }) {
    const details = detailsFor(svg),
      bounds = boundsFor(svg);
    if (stopped || !svg.isConnected || !details || !bounds) {
      clear();
      return;
    }
    if (selected !== svg) {
      clear(false);
      selected = svg;
      previousDescription = svg.getAttribute('aria-describedby');
    }
    selectedX = position.x;
    selectedSymbol = details.fields.find((field) => field.key === 'symbol')?.value;
    selectedRatio = (position.x - bounds.left) / (bounds.right - bounds.left);
    if (!panel) {
      panel = doc.createElement('aside');
      panel.id = 'pass-reference-tooltip';
      panel.className = 'candle-detail-tooltip reference-detail-tooltip';
      panel.dataset.referenceTooltip = '';
      panel.setAttribute('role', 'tooltip');
      const heading = doc.createElement('strong'),
        tag = doc.createElement('span'),
        list = doc.createElement('dl'),
        note = doc.createElement('p');
      heading.textContent = details.heading;
      tag.className = 'reference-detail-kind';
      tag.textContent = details.kind;
      for (const field of details.fields) {
        const term = doc.createElement('dt'),
          value = doc.createElement('dd');
        term.textContent = field.label;
        value.textContent = field.value;
        value.dataset.referenceField = field.key;
        list.append(term, value);
      }
      note.textContent = details.note;
      panel.append(heading, tag, list, note);
      doc.body.append(panel);
      svg.setAttribute('aria-describedby', [previousDescription, panel.id].filter(Boolean).join(' '));
    }
    panel.dataset.touch = String(touch);
    if (!cursor) {
      cursor = doc.createElementNS(svgNamespace, 'g');
      cursor.classList.add('reference-inspection-cursor');
      cursor.setAttribute('aria-hidden', 'true');
      const line = doc.createElementNS(svgNamespace, 'line'),
        dot = doc.createElementNS(svgNamespace, 'circle');
      line.setAttribute('y1', String(bounds.top));
      line.setAttribute('y2', String(bounds.bottom));
      dot.setAttribute('r', '4');
      dot.setAttribute('cy', String(bounds.lineY));
      cursor.append(line, dot);
      svg.append(cursor);
    }
    cursor.querySelector('line')?.setAttribute('x1', String(position.x));
    cursor.querySelector('line')?.setAttribute('x2', String(position.x));
    cursor.querySelector('circle')?.setAttribute('cx', String(position.x));
    place(svg, position);
  }

  function pointer(event: PointerEvent) {
    const svg = chartFor(event.target);
    if (!svg) {
      if (event.type === 'pointerdown') clear();
      return;
    }
    const bounds = boundsFor(svg),
      matrix = svg.getScreenCTM();
    if (!bounds || !matrix) {
      clear();
      return;
    }
    try {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse()),
        position = referenceInspectionPosition(local.x, local.y, bounds);
      if (position) {
        touch = event.pointerType === 'touch';
        lastPointer = { clientX: event.clientX, clientY: event.clientY };
        show(svg, position);
      } else clear();
    } catch {
      clear();
    }
  }

  function focus(event: FocusEvent) {
    const svg = chartFor(event.target);
    if (!svg || selected === svg) return;
    touch = false;
    lastPointer = undefined;
    const bounds = boundsFor(svg);
    if (bounds) show(svg, { x: (bounds.left + bounds.right) / 2, y: bounds.lineY });
  }

  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      clear();
      return;
    }
    const svg = chartFor(event.target);
    if (!svg || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const bounds = boundsFor(svg);
    if (!bounds) return;
    event.preventDefault();
    touch = false;
    lastPointer = undefined;
    const previous = selected === svg ? selectedX : undefined,
      middle = (bounds.left + bounds.right) / 2,
      step = (bounds.right - bounds.left) / 20,
      x =
        event.key === 'Home'
          ? bounds.left
          : event.key === 'End'
            ? bounds.right
            : event.key === 'ArrowLeft'
              ? (previous ?? middle) - step
              : event.key === 'ArrowRight'
                ? (previous ?? middle) + step
                : (previous ?? middle);
    show(svg, { x: Math.max(bounds.left, Math.min(x, bounds.right)), y: bounds.lineY });
  }

  function out(event: PointerEvent) {
    const svg = chartFor(event.target);
    if (
      svg &&
      event.pointerType !== 'touch' &&
      !(event.relatedTarget instanceof Node && svg.contains(event.relatedTarget))
    )
      clear();
  }

  function focusOut(event: FocusEvent) {
    const svg = chartFor(event.target);
    if (!touch && svg?.isConnected) clear();
  }

  function click(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest('[data-price-range], [data-price-style]')) {
      clear();
      prepare();
    }
  }

  function visibility() {
    if (doc.hidden) clear();
  }

  function refresh() {
    frame = undefined;
    if (stopped || !selectedSymbol) return;
    const svg = [...doc.querySelectorAll<SVGSVGElement>(selector)].find(
      (candidate) =>
        detailsFor(candidate)?.fields.find((field) => field.key === 'symbol')?.value === selectedSymbol,
    );
    const bounds = svg ? boundsFor(svg) : null;
    if (!svg || !bounds) {
      clear();
      return;
    }
    let position: { readonly x: number; readonly y: number } | null = {
      x: bounds.left + selectedRatio * (bounds.right - bounds.left),
      y: bounds.lineY,
    };
    if (lastPointer) {
      try {
        const point = svg.createSVGPoint(),
          matrix = svg.getScreenCTM();
        if (!matrix) {
          clear();
          return;
        }
        point.x = lastPointer.clientX;
        point.y = lastPointer.clientY;
        const local = point.matrixTransform(matrix.inverse());
        position = referenceInspectionPosition(local.x, local.y, bounds);
      } catch {
        position = null;
      }
    }
    if (position) show(svg, position);
    else clear();
  }

  function afterRender() {
    prepare();
    if (!selectedSymbol || stopped) return;
    if (selected && !selected.isConnected) clear(false);
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    if (view) frame = view.requestAnimationFrame(refresh);
    else queueMicrotask(refresh);
  }

  // Range/style and compact-layout changes replace this subtree without calling app.render.
  // Ignore our tooltip and cursor insertions, so adding the inspection never causes a redraw loop.
  const mutation = view
    ? new view.MutationObserver((records) => {
        const changed = records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('svg.price-chart-svg[data-price-reference]') ||
                node.querySelector('svg.price-chart-svg[data-price-reference]')),
          ),
        );
        if (changed) afterRender();
      })
    : undefined;

  prepare();
  const restoreRender = observeStockInspectionRender(host.app, () => !stopped, afterRender);
  mutation?.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener('pointermove', pointer);
  doc.addEventListener('pointerdown', pointer);
  doc.addEventListener('pointerout', out);
  const reset = () => clear();
  doc.addEventListener('pointercancel', reset);
  doc.addEventListener('focusin', focus);
  doc.addEventListener('focusout', focusOut);
  doc.addEventListener('keydown', key);
  doc.addEventListener('click', click);
  doc.addEventListener('visibilitychange', visibility);
  view?.addEventListener('hashchange', reset);
  view?.addEventListener('resize', reset);
  view?.addEventListener('scroll', reset, true);
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    clear();
    mutation?.disconnect();
    restoreRender();
    for (const [svg, tabindex] of focusAttributes) {
      if (tabindex === null) svg.removeAttribute('tabindex');
      else svg.setAttribute('tabindex', tabindex);
    }
    focusAttributes.clear();
    doc.removeEventListener('pointermove', pointer);
    doc.removeEventListener('pointerdown', pointer);
    doc.removeEventListener('pointerout', out);
    doc.removeEventListener('pointercancel', reset);
    doc.removeEventListener('focusin', focus);
    doc.removeEventListener('focusout', focusOut);
    doc.removeEventListener('keydown', key);
    doc.removeEventListener('click', click);
    doc.removeEventListener('visibilitychange', visibility);
    view?.removeEventListener('hashchange', reset);
    view?.removeEventListener('resize', reset);
    view?.removeEventListener('scroll', reset, true);
    view?.removeEventListener('pagehide', dispose);
  };
  view?.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
