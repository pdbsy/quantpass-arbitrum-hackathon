import { formatPassPrice, passPriceDigits, type Candle, type CandleChartHost } from './kline-hover.ts';

interface PassChartStrategy {
  readonly id: string;
  readonly ink?: string;
}
export interface PassPriceChartHost extends CandleChartHost {
  view: { priceRange: string; priceStyle: string };
  charts: CandleChartHost['charts'] & {
    priceBlock(strategy: PassChartStrategy): string;
    pos: { price: number; returns: number };
  };
}
const intervalMs = 300_000;
const top = 20;
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

export function passPriceBounds(rows: readonly Candle[]) {
  const low = Math.min(...rows.map((row) => row.low));
  const high = Math.max(...rows.map((row) => row.high));
  // A few tiny launch swaps should not fill the plot with an apparent large move.
  // Retain at least a 2% price span, while allowing larger observed moves to fit.
  const padding = Math.max((high - low) * 0.14, high * 0.01, 0.0001);
  return { low: Math.max(0, low - padding), high: high + padding };
}

function priceReadout(row: Candle, digits: number) {
  return `O ${formatPassPrice(row.open, digits)} H ${formatPassPrice(row.high, digits)} L ${formatPassPrice(row.low, digits)} C ${formatPassPrice(row.close, digits)}`;
}

export function passPriceSvg(
  rows: readonly Candle[],
  strategy: PassChartStrategy,
  style: string,
  mobile: boolean,
  geometry: { L: number; R: number },
): string {
  const ink = escape(strategy.ink ?? 'var(--sage-ink)');
  const { low, high } = passPriceBounds(rows);
  const bottom = mobile ? 370 : 282;
  const height = mobile ? 438 : 350;
  const x = (index: number) => geometry.L + ((index + 0.5) / rows.length) * (geometry.R - geometry.L);
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const width = Math.min(16, Math.max(1, ((geometry.R - geometry.L) / rows.length) * 0.6));
  const tickDigits = Math.min(6, Math.max(2, Math.ceil(-Math.log10((high - low) / 400))));
  const grid = Array.from({ length: 5 }, (_, index) => {
    const at = top + ((bottom - top) * index) / 4;
    return `<line x1="${geometry.L}" x2="${geometry.R}" y1="${at}" y2="${at}" class="chart-gridline"/><text x="${geometry.R + 12}" y="${at + 4}">${formatPassPrice(high - ((high - low) * index) / 4, tickDigits)}</text>`;
  }).join('');
  const candles = rows
    .map((row, index) => {
      const color = row.close >= row.open ? 'var(--sage-ink)' : 'var(--rust)';
      return `<line x1="${x(index)}" x2="${x(index)}" y1="${y(row.high)}" y2="${y(row.low)}" stroke="${color}"/><rect x="${x(index) - width / 2}" y="${Math.min(y(row.open), y(row.close))}" width="${width}" height="${Math.max(1, Math.abs(y(row.open) - y(row.close)))}" fill="${color}"/>`;
    })
    .join('');
  const path = rows
    .map(
      (row, index) =>
        `${index && row.time - rows[index - 1]!.time === intervalMs ? 'L' : 'M'}${x(index).toFixed(2)},${y(row.close).toFixed(2)}`,
    )
    .join(' ');
  const points = rows
    .map((row, index) => `<circle cx="${x(index)}" cy="${y(row.close)}" r="3" fill="${ink}"/>`)
    .join('');
  const showDate = rows.at(-1)!.time - rows[0]!.time >= 86_400_000;
  const labels = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
    .map((index) => {
      const time = new Date(rows[index]!.time).toISOString();
      return `<text x="${x(index)}" y="${height - 10}" text-anchor="middle">${showDate ? time.slice(5, 16).replace('T', ' ') : time.slice(11, 16)}</text>`;
    })
    .join('');
  return `<svg class="price-chart-svg" data-v3-chart="price" data-strategy="${escape(strategy.id)}" data-pass-price-chart viewBox="0 0 900 ${height}" tabindex="0" role="img" aria-label="${rows.length} indexed five-minute PASS price intervals in AF-USDC; empty intervals omitted; use arrow keys to inspect">${grid}${style === 'line' ? `<path d="${path}" stroke="${ink}" stroke-width="2.4" fill="none"/>${points}` : candles}${labels}<g id="price-cursor" visibility="hidden"><line y1="${top}" y2="${bottom}" stroke="var(--muted)" stroke-dasharray="3 4"/><circle r="4" fill="var(--sheet)" stroke="var(--ink)" stroke-width="1.5"/></g></svg>`;
}

/** Extend the retained native layout without changing its imported source artifact. */
export function installPassPriceChart(host: PassPriceChartHost, doc: Document = document): void {
  const originalBlock = host.charts.priceBlock;
  const originalHover = host.charts.hover;
  const mobile = () => (doc.defaultView?.innerWidth ?? 1000) <= 650;
  host.charts.priceBlock = (strategy) => {
    const html = originalBlock.call(host.charts, strategy);
    const rows = host.marketData.candles(strategy.id, host.view.priceRange);
    if (!rows.length) return html;
    const digits = passPriceDigits(rows.flatMap((row) => [row.open, row.high, row.low, row.close]));
    const template = doc.createElement('template');
    template.innerHTML = html;
    const chart = template.content.querySelector('.price-chart-svg');
    if (!chart) return html;
    chart.outerHTML = passPriceSvg(rows, strategy, host.view.priceStyle, mobile(), host.charts.G);
    const readout = template.content.querySelector('#price-readout');
    if (readout) readout.textContent = priceReadout(rows.at(-1)!, digits);
    const note = template.content.querySelector('.chart-bottomnote > span');
    if (note)
      note.textContent = `UTC · 5-minute candles · ${rows.length} indexed interval${rows.length === 1 ? '' : 's'}`;
    const method = template.content.querySelector('.chart-source > p');
    if (method)
      method.textContent =
        'Each candle contains actual AMM swaps in one 5-minute UTC interval. O = first execution, H = highest, L = lowest, C = last. Empty intervals are omitted; the line connects consecutive intervals only. The price axis spans at least 2% to keep tiny changes in proportion. PASS prices are separate from stock prices.';
    const cells = template.content.querySelectorAll('.chart-data-scroll tbody tr');
    rows.forEach((row, index) => {
      const values = [row.open, row.high, row.low, row.close];
      const columns = cells[index]?.querySelectorAll('td');
      values.forEach((value, column) => {
        const cell = columns?.[column + 1];
        if (cell) cell.textContent = formatPassPrice(value, digits);
      });
      const volume = columns?.[5];
      if (volume && row.volume !== undefined)
        volume.textContent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(row.volume);
    });
    return template.innerHTML;
  };
  host.charts.hover = (svg, index) => {
    if (svg.dataset.v3Chart !== 'price' || !svg.hasAttribute('data-pass-price-chart')) {
      originalHover.call(host.charts, svg, index);
      return;
    }
    const rows = host.marketData.candles(svg.dataset.strategy ?? '', host.view.priceRange);
    if (!Number.isFinite(index) || !rows.length) return;
    const selected = Math.max(0, Math.min(rows.length - 1, Math.trunc(index)));
    host.charts.pos.price = selected;
    const row = rows[selected]!;
    const { low, high } = passPriceBounds(rows);
    const bottom = mobile() ? 370 : 282;
    const x = host.charts.G.L + ((selected + 0.5) / rows.length) * (host.charts.G.R - host.charts.G.L);
    const y = bottom - ((row.close - low) / (high - low)) * (bottom - top);
    const cursor = svg.querySelector('#price-cursor');
    cursor?.setAttribute('visibility', 'visible');
    for (const attribute of ['x1', 'x2']) cursor?.querySelector('line')?.setAttribute(attribute, String(x));
    cursor?.querySelector('circle')?.setAttribute('cx', String(x));
    cursor?.querySelector('circle')?.setAttribute('cy', String(y));
    const readout = svg.closest('.terminal-chart')?.querySelector('#price-readout');
    const digits = passPriceDigits(rows.flatMap((item) => [item.open, item.high, item.low, item.close]));
    if (readout)
      readout.textContent = `${new Date(row.time).toISOString().slice(5, 16).replace('T', ' ')} UTC · ${priceReadout(row, digits)} AF-USDC`;
  };
}
