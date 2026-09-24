import { analyzeHtmlSource } from '../html-source-ranges.mjs';

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
function positionAt(offset, starts) {
  let lo = 0,
    hi = starts.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid;
  }
  return { line: lo + 1, column: offset - starts[lo] };
}
export function buildPrototypeMap(html) {
  if (typeof html !== 'string') throw new Error('Expected frozen HTML source');
  const matches = analyzeHtmlSource(html).scripts.filter((script) => script.kind === 'inline');
  if (matches.length !== 1) throw new Error('Expected one complete script');
  // The served prototype is a classic external script; do not silently change
  // an attributed source's module/nomodule/type or other element semantics.
  if (Object.keys(matches[0].attributes).length) throw new Error('Unsupported prototype script attributes');
  const original = matches[0].text,
    scriptStart = matches[0].contentStart;
  const insertions = [];
  let generated = '',
    cursor = 0;
  for (const match of original.matchAll(/(\s)style=/g)) {
    const originalStart = match.index + match[1].length;
    generated += original.slice(cursor, originalStart);
    insertions.push(Object.freeze({ originalStart, generatedStart: generated.length }));
    generated += 'data-user-';
    cursor = originalStart;
  }
  generated += original.slice(cursor);
  const generatedLines = lineStarts(generated),
    htmlLines = lineStarts(html);
  const originalOffset = (offset) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > generated.length)
      throw new Error('Generated offset outside script');
    let removed = 0;
    for (const change of insertions) {
      if (offset < change.generatedStart) break;
      if (offset < change.generatedStart + 10) return scriptStart + change.originalStart;
      removed += 10;
    }
    return scriptStart + offset - removed;
  };
  const originalPosition = (position) => {
    if (
      !Number.isSafeInteger(position?.line) ||
      !Number.isSafeInteger(position?.column) ||
      position.line < 1 ||
      position.line > generatedLines.length ||
      position.column < 0
    )
      throw new Error('Invalid generated position');
    const start = generatedLines[position.line - 1];
    const end = position.line < generatedLines.length ? generatedLines[position.line] - 1 : generated.length;
    if (start + position.column > end) throw new Error('Generated column outside line');
    return positionAt(originalOffset(start + position.column), htmlLines);
  };
  return Object.freeze({
    original,
    generated,
    scriptStart,
    insertions: Object.freeze(insertions),
    originalOffset,
    originalPosition,
  });
}
