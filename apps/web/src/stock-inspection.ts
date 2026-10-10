import type {
  StockCandle,
  StockHistoryHost,
  StockHistoryInfo,
  StockQuoteInfo,
  StockReferencePoint,
} from './stock-history.ts';

export interface StockInspectionHost extends StockHistoryHost {
  view: { priceRange: string; returnRange?: string };
  charts: {
    hover(svg: SVGSVGElement, index: number): void;
    G: { L: number; R: number };
  };
}
export interface StockInspectionDetails {
  readonly heading: string;
  readonly kind: string;
  readonly fields: readonly { key: string; label: string; value: string }[];
  readonly direction: 'up' | 'down' | 'flat';
  readonly note: string;
}
const dollars = (value: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value) +
  ' USD';
const signed = (value: number, suffix: string) =>
  (value > 0 ? '+' : value < 0 ? '−' : '') +
  (suffix === '%' ? Math.abs(value).toFixed(2) : dollars(Math.abs(value))) +
  suffix;
const utcMinute = (time: number) =>
  new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
function sourceAge(time: number, now: number): string {
  const seconds = Math.max(0, Math.floor(now - time));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
}

/** Uses the selected real point; OHLCV and quote metadata must match that point exactly. */
export function stockInspectionDetails(
  symbol: string,
  points: readonly StockReferencePoint[],
  index: number,
  candles: readonly StockCandle[] = [],
  info: StockHistoryInfo | null = null,
  quote: StockQuoteInfo | null = null,
  now = Math.floor(Date.now() / 1000),
): StockInspectionDetails | null {
  const point = points[index],
    baseline = points[0]?.price;
  if (
    !Number.isInteger(index) ||
    !point ||
    !baseline ||
    !Number.isFinite(baseline) ||
    baseline <= 0 ||
    !Number.isFinite(point.price) ||
    point.price <= 0 ||
    !Number.isSafeInteger(point.t) ||
    point.t <= 0 ||
    point.t > 8_640_000_000_000 ||
    !['daily', 'quote'].includes(point.kind)
  )
    return null;
  const change = point.price - baseline,
    fields = [
      { key: 'price', label: 'Stock price', value: dollars(point.price) },
      { key: 'change', label: 'Change', value: signed(change, '') },
      { key: 'changePercent', label: 'Change %', value: signed((change / baseline) * 100, '%') },
    ];
  let kind: string,
    note = 'Change is measured from the first visible stock point. Reference only.';
  if (point.kind === 'daily') {
    kind = 'Daily session';
    fields.push({
      key: 'time',
      label: 'Session date',
      value: new Date(point.t * 1000).toISOString().slice(0, 10),
    });
    const candle = candles.find((row) => row.t === point.t && row.c === point.price);
    if (candle) {
      for (const [key, label, value] of [
        ['open', 'Open', candle.o],
        ['high', 'High', candle.h],
        ['low', 'Low', candle.l],
        ['close', 'Close', candle.c],
      ] as const)
        fields.push({ key, label, value: dollars(value) });
      fields.push({
        key: 'volume',
        label: 'Volume',
        value: new Intl.NumberFormat('en-US').format(candle.v) + ' shares',
      });
    } else note += ' OHLCV is unavailable for this session.';
    fields.push({ key: 'source', label: 'Source', value: info?.source ?? 'Nasdaq' });
    if (info?.status === 'UNAVAILABLE') note += ' History update unavailable; showing a cached session.';
  } else {
    const current = quote?.status === 'AVAILABLE' ? quote : quote?.lastGood,
      matching = current?.lastDataAt === point.t && current.price === point.price ? current : null;
    kind = matching
      ? quote?.status === 'UNAVAILABLE'
        ? 'Cached source quote'
        : 'Source quote'
      : 'Historical quote point';
    fields.push({ key: 'time', label: 'Source time', value: matching?.quoteTime ?? utcMinute(point.t) });
    fields.push({ key: 'precision', label: 'Time precision', value: 'Minute' });
    if (matching) {
      if (matching.marketStatus)
        fields.push({ key: 'marketStatus', label: 'Market', value: matching.marketStatus });
      fields.push({
        key: 'isRealtime',
        label: 'Feed',
        value:
          matching.isRealtime === true
            ? 'Real-time · provider flag'
            : matching.isRealtime === false
              ? 'Delayed · provider flag'
              : 'Unavailable',
      });
    }
    fields.push({ key: 'sourceAge', label: 'Quote age', value: '~' + sourceAge(point.t, now) });
    fields.push({ key: 'source', label: 'Source', value: matching?.source ?? 'Nasdaq' });
    if (!matching) note += ' Market/feed details were not recorded for this historical quote.';
    if (quote?.status === 'UNAVAILABLE') note += ' Quote update unavailable; showing a cached point.';
  }
  return Object.freeze({
    heading: `${symbol.toUpperCase()} stock details`,
    kind,
    fields: Object.freeze(fields.map((field) => Object.freeze(field))),
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    note,
  });
}

/** Return-line points include both endpoints, rather than the half-bin centers used by candles. */
export function stockInspectionIndex(x: number, count: number, left: number, right: number): number | null {
  if (
    !Number.isFinite(x) ||
    !Number.isInteger(count) ||
    count < 1 ||
    !(right > left) ||
    x < left ||
    x > right
  )
    return null;
  return count === 1 ? 0 : Math.round(((x - left) / (right - left)) * (count - 1));
}

/** Observe product renders without changing their receiver, arguments, or later installers. */
export function observeStockInspectionRender(
  app: StockHistoryHost['app'],
  hasSelection: () => boolean,
  afterRender: () => void,
): () => void {
  const originalRender = app.render;
  const render: typeof app.render = (options) => {
    originalRender.call(app, options);
    if (hasSelection()) afterRender();
  };
  app.render = render;
  return () => {
    if (app.render === render) app.render = originalRender;
  };
}

export function installStockInspection(host: StockInspectionHost, doc: Document = document): () => void {
  let panel: HTMLElement | undefined,
    selected: SVGSVGElement | undefined,
    selectedTime: number | undefined,
    readout: HTMLElement | null = null,
    originalReadout = '',
    describedBy: string | null = null,
    touch = false,
    stopped = false,
    frame: number | undefined;
  let lastPointer: { clientX: number; clientY: number; strategy: string } | undefined;
  const originalHover = host.charts.hover;
  const view = doc.defaultView;
  const chartFor = (target: EventTarget | null) => {
    const svg =
      target instanceof Element
        ? target.closest<SVGSVGElement>('#trade-returns .return-chart-svg[data-v3-chart="returns"]')
        : null;
    return svg;
  };
  const rowsFor = (svg: SVGSVGElement) =>
    host.stockHistory?.points(svg.dataset.strategy ?? '', host.view.returnRange ?? '30d') ?? [];
  function clear() {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = undefined;
    panel?.remove();
    panel = undefined;
    selected?.querySelector('#returns-cursor')?.setAttribute('visibility', 'hidden');
    if (selected) {
      if (describedBy === null) selected.removeAttribute('aria-describedby');
      else selected.setAttribute('aria-describedby', describedBy);
    }
    if (readout?.isConnected) readout.textContent = originalReadout;
    selected = undefined;
    selectedTime = undefined;
    lastPointer = undefined;
    readout = null;
  }
  function place(svg: SVGSVGElement, index: number, count: number) {
    if (!panel) return;
    const chart = svg.getBoundingClientRect(),
      box = panel.getBoundingClientRect(),
      width = view?.innerWidth ?? doc.documentElement.clientWidth,
      height = view?.innerHeight ?? doc.documentElement.clientHeight;
    const point = svg.createSVGPoint();
    point.x =
      host.charts.G.L + (count === 1 ? 0.5 : index / (count - 1)) * (host.charts.G.R - host.charts.G.L);
    const matrix = svg.getScreenCTM(),
      x = matrix ? point.matrixTransform(matrix).x : chart.left + chart.width / 2;
    const left = width - x >= x ? x + 14 : x - box.width - 14;
    panel.style.left = Math.max(8, Math.min(left, width - box.width - 8)) + 'px';
    panel.style.top = Math.max(8, Math.min(chart.top + 8, height - box.height - 8)) + 'px';
    panel.dataset.touch = String(touch);
  }
  function show(svg: SVGSVGElement, index: number) {
    const id = svg.dataset.strategy ?? '',
      range = host.view.returnRange ?? '30d',
      rows = rowsFor(svg),
      i = Math.max(0, Math.min(rows.length - 1, Math.trunc(index))),
      details = stockInspectionDetails(
        id,
        rows,
        i,
        host.stockHistory?.candles(id, range) ?? [],
        host.stockHistory?.info(id) ?? null,
        host.stockHistory?.quote(id) ?? null,
      );
    if (!details || !svg.isConnected) {
      clear();
      return;
    }
    if (selected !== svg) {
      const pointer = lastPointer;
      clear();
      lastPointer = pointer;
      selected = svg;
      describedBy = svg.getAttribute('aria-describedby');
      readout = svg.closest('#trade-returns')?.querySelector<HTMLElement>('#returns-readout') ?? null;
      originalReadout = readout?.textContent ?? '';
    }
    selectedTime = rows[i]!.t;
    if (!panel) {
      panel = doc.createElement('aside');
      panel.id = 'stock-detail-tooltip';
      panel.className = 'candle-detail-tooltip stock-detail-tooltip';
      panel.dataset.stockTooltip = '';
      panel.setAttribute('role', 'tooltip');
      doc.body.append(panel);
    }
    const heading = doc.createElement('strong');
    heading.textContent = details.heading;
    const tag = doc.createElement('span');
    tag.className = 'stock-detail-kind';
    tag.textContent = details.kind;
    const list = doc.createElement('dl');
    for (const field of details.fields) {
      const term = doc.createElement('dt'),
        value = doc.createElement('dd');
      term.textContent = field.label;
      value.textContent = field.value;
      value.dataset.stockField = field.key;
      if (['change', 'changePercent'].includes(field.key)) value.dataset.direction = details.direction;
      list.append(term, value);
    }
    const note = doc.createElement('p');
    note.textContent = details.note;
    panel.replaceChildren(heading, tag, list, note);
    svg.setAttribute('aria-describedby', [describedBy, panel.id].filter(Boolean).join(' '));
    place(svg, i, rows.length);
  }
  const hover = (svg: SVGSVGElement, index: number) => {
    const active = svg.matches('#trade-returns .return-chart-svg[data-v3-chart="returns"]');
    const before =
      active && selected !== svg
        ? svg.closest('#trade-returns')?.querySelector<HTMLElement>('#returns-readout')?.textContent
        : undefined;
    originalHover.call(host.charts, svg, index);
    if (active && !stopped) {
      show(svg, index);
      if (before !== undefined && before !== null) originalReadout = before;
    }
  };
  host.charts.hover = hover;
  function pointerIndex(svg: SVGSVGElement, event: { clientX: number; clientY: number }): number | null {
    const point = svg.createSVGPoint(),
      matrix = svg.getScreenCTM();
    if (!matrix) return null;
    point.x = event.clientX;
    point.y = event.clientY;
    return stockInspectionIndex(
      point.matrixTransform(matrix.inverse()).x,
      rowsFor(svg).length,
      host.charts.G.L,
      host.charts.G.R,
    );
  }
  const onDown = (event: PointerEvent) => {
    if (panel && event.target instanceof Node && panel.contains(event.target)) return;
    const svg = chartFor(event.target);
    if (!svg) {
      clear();
      return;
    }
    const index = pointerIndex(svg, event);
    if (index === null) {
      clear();
      return;
    }
    touch = event.pointerType === 'touch';
    host.charts.hover(svg, index);
    lastPointer = { clientX: event.clientX, clientY: event.clientY, strategy: svg.dataset.strategy ?? '' };
  };
  const onMove = (event: PointerEvent) => {
    const svg = chartFor(event.target);
    if (!svg) return;
    const index = pointerIndex(svg, event);
    if (index === null) {
      clear();
      return;
    }
    touch = event.pointerType === 'touch';
    if (panel) panel.dataset.touch = String(touch);
    // Correct the original rectangular mapping if SVG scaling introduces letterboxing.
    if (selectedTime !== rowsFor(svg)[index]?.t) host.charts.hover(svg, index);
    lastPointer = { clientX: event.clientX, clientY: event.clientY, strategy: svg.dataset.strategy ?? '' };
  };
  const onOut = (event: PointerEvent) => {
    const svg = chartFor(event.target);
    if (
      svg &&
      event.pointerType !== 'touch' &&
      !(event.relatedTarget instanceof Node && svg.contains(event.relatedTarget))
    )
      clear();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      clear();
      return;
    }
    const svg = chartFor(event.target);
    if (!svg) return;
    touch = false;
    lastPointer = undefined;
    if (panel) panel.dataset.touch = 'false';
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      host.charts.hover(svg, event.key === 'Home' ? 0 : rowsFor(svg).length - 1);
    }
  };
  const onFocusOut = (event: FocusEvent) => {
    // Touch taps may focus the SVG; replacing it during a render is handled by refresh.
    if (!touch && chartFor(event.target)) clear();
  };
  const onClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-return-range]')) clear();
  };
  const onVisibility = () => {
    if (doc.hidden) clear();
  };
  const refresh = () => {
    frame = undefined;
    if (!selected || stopped) return;
    const id = selected.dataset.strategy;
    const active = [
      ...doc.querySelectorAll<SVGSVGElement>('#trade-returns .return-chart-svg[data-v3-chart="returns"]'),
    ].find((svg) => svg.dataset.strategy === id);
    if (!active) {
      clear();
      return;
    }
    const pointer = lastPointer;
    const index =
      pointer && pointer.strategy === id
        ? pointerIndex(active, pointer)
        : rowsFor(active).findIndex((point) => point.t === selectedTime);
    if (index === null || index < 0) {
      clear();
      return;
    }
    host.charts.hover(active, index);
  };
  const scheduleRefresh = () => {
    if (!selected || stopped) return;
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    if (view) frame = view.requestAnimationFrame(refresh);
    else queueMicrotask(refresh);
  };
  const unsubscribe = host.stockHistory?.subscribe(scheduleRefresh) ?? (() => {});
  const restoreRender = observeStockInspectionRender(host.app, () => !!selected && !stopped, scheduleRefresh);
  doc.addEventListener('pointerdown', onDown);
  doc.addEventListener('pointermove', onMove);
  doc.addEventListener('pointerout', onOut);
  doc.addEventListener('pointercancel', clear);
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('focusout', onFocusOut);
  doc.addEventListener('click', onClick);
  doc.addEventListener('visibilitychange', onVisibility);
  view?.addEventListener('hashchange', clear);
  view?.addEventListener('resize', clear);
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    clear();
    unsubscribe();
    restoreRender();
    if (host.charts.hover === hover) host.charts.hover = originalHover;
    doc.removeEventListener('pointerdown', onDown);
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerout', onOut);
    doc.removeEventListener('pointercancel', clear);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusout', onFocusOut);
    doc.removeEventListener('click', onClick);
    doc.removeEventListener('visibilitychange', onVisibility);
    view?.removeEventListener('hashchange', clear);
    view?.removeEventListener('resize', clear);
    view?.removeEventListener('pagehide', dispose);
  };
  view?.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
