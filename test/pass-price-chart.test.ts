import assert from 'node:assert/strict';
import test from 'node:test';
import { passPriceBounds, passPriceSvg } from '../apps/web/src/pass-price-chart.ts';

const first = {
  time: Date.UTC(2026, 9, 10, 1, 20),
  open: 50,
  high: 50,
  low: 50,
  close: 50,
  volume: 0.001,
  quoteVolume: 0.1,
};
const second = {
  ...first,
  time: first.time + 900_000,
  open: 50.0001,
  high: 50.0002,
  low: 50.0001,
  close: 50.0001,
};
const strategy = { id: 'amzn', ink: '#b75a39' };
const geometry = { L: 16, R: 818 };

test('tiny real launch swaps have distinct price ticks and bounded candle widths', () => {
  const bounds = passPriceBounds([first, second]);
  assert.ok((bounds.high - bounds.low) / first.close >= 0.02);
  assert.ok(bounds.low < first.low && bounds.high > second.high);
  for (const mobile of [false, true]) {
    const svg = passPriceSvg([first, second], strategy, 'candle', mobile, geometry);
    const texts = Array.from(svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g), (match) => match[1]);
    assert.equal(new Set(texts.slice(0, 5)).size, 5, 'all price tick labels are distinct');
    assert.deepEqual(texts.slice(5), ['01:20', '01:35'], 'two intervals produce two accurate time labels');
    const widths = Array.from(svg.matchAll(/<rect[^>]*width="([\d.]+)"/g), (match) => Number(match[1]));
    assert.deepEqual(widths, [16, 16]);
    assert.doesNotMatch(svg, /NaN|Infinity/);
  }
});

test('line mode preserves missing intervals and still renders isolated real closes', () => {
  const third = { ...second, time: second.time + 300_000, close: second.high };
  const svg = passPriceSvg([first, second, third], strategy, 'line', false, geometry);
  const line = svg.match(/<path d="([^"]+)"/)?.[1];
  assert.ok(line);
  assert.equal(Array.from(line.matchAll(/M/g)).length, 2, 'missing intervals start a new segment');
  assert.equal(Array.from(line.matchAll(/L/g)).length, 1, 'only adjacent real intervals connect');
  assert.equal(Array.from(svg.matchAll(/<circle[^>]*r="3"/g)).length, 3);
  const single = passPriceSvg([first], strategy, 'line', false, geometry);
  assert.equal(Array.from(single.matchAll(/>01:20<\/text>/g)).length, 1);
  assert.match(single, /<circle cx="417"[^>]*r="3"/);
  const withoutInk = passPriceSvg([first], { id: 'amzn' }, 'line', false, geometry);
  assert.match(withoutInk, /stroke="var\(--sage-ink\)"/);
});

test('larger observed moves fit in the chart and multi-day labels include dates', () => {
  const last = { ...second, time: first.time + 86_400_000, low: 35, high: 80, open: 45, close: 60 };
  const bounds = passPriceBounds([first, last]);
  assert.ok(bounds.low < last.low && bounds.high > last.high);
  const svg = passPriceSvg([first, last], strategy, 'candle', false, geometry);
  assert.match(svg, />10-10 01:20<\/text>/);
  assert.match(svg, />10-11 01:20<\/text>/);
});
