/** Prices and quoteVolume are hundredths of simulated ETH; volume is whole/fractional Pass units. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  quoteVolume?: number;
}
export interface CandleChartHost {
  view: { priceRange: string };
  marketData: { candles: (id: string, range: string) => Candle[] };
  charts: { hover: (svg: SVGSVGElement, index: number) => void; G: { L: number; R: number } };
}
const finite = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const number = (value: number, digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    value,
  );
const money = (value: number | undefined) => (finite(value) ? `${number(value / 100, 2)} ETH` : '—');
const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '');

export function candleDetails(row: Candle) {
  const change = finite(row.open) && finite(row.close) ? row.close - row.open : NaN;
  const rate = row.open > 0 ? (change / row.open) * 100 : NaN;
  const amplitude =
    finite(row.open) && finite(row.high) && finite(row.low) && row.open > 0 && row.high >= row.low
      ? ((row.high - row.low) / row.open) * 100
      : NaN;
  return {
    time:
      finite(row.time) && Math.abs(row.time) <= 8.64e15
        ? new Date(row.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
        : '—',
    open: money(row.open),
    high: money(row.high),
    low: money(row.low),
    close: money(row.close),
    change: finite(change) ? sign(change) + money(Math.abs(change)) : '—',
    changePercent: finite(rate) ? sign(rate) + number(Math.abs(rate), 2) + '%' : '—',
    amplitude: finite(amplitude) ? number(amplitude, 2) + '%' : '—',
    volume:
      finite(row.volume) && row.volume >= 0
        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(row.volume) + ' Pass'
        : '—',
    turnover: finite(row.quoteVolume) && row.quoteVolume >= 0 ? money(row.quoteVolume) : '—',
  };
}

// Candle bodies sit at half-bin centers, unlike points on the return line chart.
export function candleIndex(x: number, count: number, left: number, right: number): number | null {
  if (
    !Number.isFinite(x) ||
    !Number.isInteger(count) ||
    count < 1 ||
    !(right > left) ||
    x < left ||
    x > right
  )
    return null;
  return Math.min(count - 1, Math.floor(((x - left) / (right - left)) * count));
}

export function installCandleInspection(host: CandleChartHost, doc: Document = document): void {
  let panel: HTMLElement | undefined;
  let selected: SVGSVGElement | undefined;
  const originalHover = host.charts.hover;
  const labels = {
    time: '时间',
    open: '开盘',
    close: '收盘',
    high: '最高',
    low: '最低',
    changePercent: '涨跌幅',
    change: '涨跌额',
    amplitude: '振幅',
    volume: '成交量',
    turnover: '成交额',
  };
  function clear() {
    panel?.remove();
    panel = undefined;
    selected?.querySelector('#price-cursor')?.setAttribute('visibility', 'hidden');
    selected?.removeAttribute('aria-describedby');
    selected = undefined;
  }
  function show(svg: SVGSVGElement, index: number) {
    const rows = host.marketData.candles(svg.dataset.strategy ?? '', host.view.priceRange);
    if (!Number.isFinite(index) || !rows.length) {
      clear();
      return;
    }
    const i = Math.max(0, Math.min(rows.length - 1, Math.trunc(index)));
    const row = rows[i]!;
    const container = svg.parentElement;
    if (!container) return;
    if (selected !== svg) clear();
    selected = svg;
    container.classList.add('candle-inspection-container');
    if (!panel) {
      panel = doc.createElement('aside');
      panel.id = 'candle-detail-tooltip';
      panel.dataset.candleTooltip = '';
      panel.className = 'candle-detail-tooltip';
      panel.setAttribute('role', 'tooltip');
      const heading = doc.createElement('strong');
      heading.textContent = 'K 线详情';
      panel.append(heading);
      const tag = doc.createElement('span');
      tag.className = 'candle-detail-fixture';
      tag.textContent = 'MOCK · 合成行情';
      panel.append(tag);
      const list = doc.createElement('dl');
      for (const [key, label] of Object.entries(labels)) {
        const term = doc.createElement('dt');
        term.textContent = label;
        const value = doc.createElement('dd');
        value.dataset.candleField = key;
        list.append(term, value);
      }
      panel.append(list);
      const note = doc.createElement('p');
      note.textContent = '涨跌 = 收盘 − 开盘；涨跌幅、振幅均以本根开盘价为基准。价格单位：ETH / Pass。';
      panel.append(note);
      svg.after(panel);
    }
    svg.setAttribute('aria-describedby', panel.id);
    const details = candleDetails(row);
    for (const [key, value] of Object.entries(details)) {
      const element = panel.querySelector<HTMLElement>(`[data-candle-field="${key}"]`)!;
      element.textContent = value;
      if (['change', 'changePercent'].includes(key))
        element.dataset.direction =
          !finite(row.close - row.open) || row.close === row.open
            ? 'flat'
            : row.close > row.open
              ? 'up'
              : 'down';
    }
    // Measure actual chart space rather than assuming a viewport breakpoint or
    // index half is enough. A narrow chart reserves space below the SVG.
    panel.dataset.layout = 'overlay';
    const area = svg.getBoundingClientRect();
    const frame = container.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const transform = svg.getScreenCTM();
    const point = svg.createSVGPoint();
    point.x = host.charts.G.L + ((i + 0.5) / rows.length) * (host.charts.G.R - host.charts.G.L);
    const selectedX = transform ? point.matrixTransform(transform).x : (frame.left + frame.right) / 2;
    const leftSpace = selectedX - frame.left - 24;
    const rightSpace = frame.right - selectedX - 24;
    panel.dataset.side = rightSpace > leftSpace ? 'right' : 'left';
    panel.dataset.layout =
      box.width + 12 <= Math.max(leftSpace, rightSpace) && box.height + 16 <= area.height
        ? 'overlay'
        : 'inline';
    panel.style.top = Math.max(0, area.top - frame.top + 8) + 'px';
  }
  host.charts.hover = (svg, index) => {
    originalHover(svg, index);
    if (svg.dataset.v3Chart === 'price') show(svg, index);
  };
  const priceChart = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<SVGSVGElement>('[data-v3-chart="price"]') : null;
  const inlineDetail = (target: EventTarget | null) =>
    panel?.dataset.layout === 'inline' && target instanceof Node && panel.contains(target);
  function pointer(event: PointerEvent) {
    if (inlineDetail(event.target)) return;
    const svg = priceChart(event.target);
    if (!svg) {
      if (event.type === 'pointerdown') clear();
      return;
    }
    const transform = svg.getScreenCTM();
    if (!transform) {
      clear();
      return;
    }
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(transform.inverse());
    const rows = host.marketData.candles(svg.dataset.strategy ?? '', host.view.priceRange);
    const index = candleIndex(local.x, rows.length, host.charts.G.L, host.charts.G.R);
    if (index === null) {
      clear();
      return;
    }
    host.charts.hover(svg, index);
  }
  doc.addEventListener('pointermove', pointer);
  doc.addEventListener('pointerdown', pointer);
  doc.addEventListener('pointerout', (event) => {
    const svg = priceChart(event.target);
    if (
      event.pointerType !== 'touch' &&
      svg &&
      !(event.relatedTarget instanceof Node && svg.contains(event.relatedTarget))
    )
      clear();
  });
  doc.addEventListener('pointercancel', (event) => {
    // Native touch panning cancels pointer delivery when the browser takes over.
    // Preserve the inline reading surface; other cancellations still clear it.
    if (event.pointerType === 'touch' && inlineDetail(event.target)) return;
    clear();
  });
  doc.addEventListener('focusout', (event) => {
    if (priceChart(event.target)) clear();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clear();
  });
  doc.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-price-range], [data-price-style]'))
      clear();
  });
  doc.defaultView?.addEventListener('hashchange', clear);
  doc.defaultView?.addEventListener('resize', clear);
}
