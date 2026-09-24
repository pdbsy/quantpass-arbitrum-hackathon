// Source admission for this repository, not a general HTML parser or sanitizer.
// Accept ordinary tags/attributes, strict comments and explicitly closed raw text.
// Reject HTML error recovery, script escape states and foreign executable content
// whose ranges cannot be proved here. Offsets stay in the original UTF-16 string.
const space = (c) => c !== undefined && /[\t\n\f\r ]/.test(c);
const letter = (c) => c !== undefined && /[A-Za-z]/.test(c);
const lower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
// Only balanced decorative SVG is admitted. In particular, HTML integration
// points and breakout tags require browser tree construction, not a name stack.
const svgNames = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
]);
const rawNames = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'noscript',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
]);
function refuse(reason) {
  throw new Error('UNSUPPORTED_HTML_SOURCE: ' + reason);
}

function tagAt(source, start) {
  let cursor = start + 1;
  const closing = source[cursor] === '/';
  if (closing) cursor++;
  const nameStart = cursor;
  while (cursor < source.length && /[A-Za-z0-9:_-]/.test(source[cursor])) cursor++;
  if (cursor === nameStart) refuse('tag name');
  const name = lower(source.slice(nameStart, cursor));
  const attributes = Object.create(null);
  let selfClosing = false;
  while (cursor < source.length) {
    const beforeSpace = cursor;
    while (space(source[cursor])) cursor++;
    if (source[cursor] === '>') return { name, closing, attributes, selfClosing, start, end: cursor + 1 };
    if (source[cursor] === '/' && source[cursor + 1] === '>') {
      if (closing) refuse('self-closing end tag');
      selfClosing = true;
      cursor++;
      continue;
    }
    if (closing) refuse('end tag attributes');
    if (cursor === beforeSpace) refuse('attribute separator');
    const attrStart = cursor;
    while (cursor < source.length && /[A-Za-z0-9:_-]/.test(source[cursor])) cursor++;
    if (cursor === attrStart) refuse('attribute name');
    const attrName = lower(source.slice(attrStart, cursor));
    if (Object.hasOwn(attributes, attrName)) refuse('duplicate attribute');
    const afterName = cursor;
    while (space(source[cursor])) cursor++;
    let value = '';
    if (source[cursor] === '=') {
      cursor++;
      while (space(source[cursor])) cursor++;
      const quote = source[cursor];
      if (quote === '"' || quote === "'") {
        const valueStart = ++cursor;
        cursor = source.indexOf(quote, cursor);
        if (cursor === -1) refuse('unterminated quoted attribute');
        value = source.slice(valueStart, cursor++);
      } else {
        const valueStart = cursor;
        while (cursor < source.length && !space(source[cursor]) && source[cursor] !== '>') {
          if (/["'`<=]/.test(source[cursor])) refuse('unquoted attribute value');
          cursor++;
        }
        if (cursor === valueStart) refuse('missing attribute value');
        value = source.slice(valueStart, cursor);
      }
    } else cursor = afterName;
    attributes[attrName] = value;
  }
  refuse('unterminated tag');
}

function rawEnd(source, folded, tag) {
  let cursor = tag.end;
  const marker = '</' + tag.name;
  while ((cursor = folded.indexOf(marker, cursor)) !== -1) {
    const next = source[cursor + marker.length];
    if (space(next) || next === '>' || next === '/') return tagAt(source, cursor);
    cursor += marker.length; // </scripture> is text, never a script terminator.
  }
  refuse('unclosed ' + tag.name);
}

export function analyzeHtmlSource(source) {
  if (typeof source !== 'string') throw new Error('Expected HTML source');
  if (source.includes('\0')) refuse('NUL input');
  const folded = lower(source);
  const scripts = [],
    styles = [],
    foreign = [];
  let cursor = 0;
  while ((cursor = source.indexOf('<', cursor)) !== -1) {
    if (source.startsWith('<!--', cursor)) {
      const end = source.indexOf('-->', cursor + 4);
      if (end === -1) refuse('unclosed comment');
      const body = source.slice(cursor + 4, end);
      if (body.startsWith('>') || body.startsWith('->') || body.includes('--') || body.endsWith('-'))
        refuse('comment error recovery');
      cursor = end + 3;
      continue;
    }
    if (source[cursor + 1] === '!') {
      const end = source.indexOf('>', cursor + 2);
      if (end === -1 || !/^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>$/i.test(source.slice(cursor, end + 1)))
        refuse('declaration');
      cursor = end + 1;
      continue;
    }
    if (source[cursor + 1] === '?') refuse('processing instruction');
    if (!letter(source[cursor + 1]) && source[cursor + 1] !== '/') {
      cursor++;
      continue;
    }
    const tag = tagAt(source, cursor);
    cursor = tag.end;
    if (tag.name === 'math') refuse('MathML context');
    if (tag.name === 'svg' || foreign.length) {
      if (!svgNames.has(tag.name)) refuse('unsupported SVG context');
      if (tag.closing) {
        if (foreign.pop() !== tag.name) refuse('foreign content boundary');
      } else if (!tag.selfClosing) foreign.push(tag.name);
      continue;
    }
    if (tag.name === 'plaintext') refuse('plaintext consumes remaining source');
    if (!rawNames.has(tag.name)) continue;
    if (tag.closing) refuse('unmatched raw-text end tag');
    if (tag.selfClosing) refuse('self-closing raw-text tag');
    const end = rawEnd(source, folded, tag);
    const text = source.slice(tag.end, end.start);
    if (tag.name === 'script') {
      if (text.includes('<!--')) refuse('script escaped state');
      const type = tag.attributes.type ?? '';
      if (type.includes('&')) refuse('encoded script type');
      const json = ['application/json', 'application/ld+json'].includes(lower(type.trim()));
      scripts.push({
        ...tag,
        contentStart: tag.end,
        contentEnd: end.start,
        end: end.end,
        text,
        kind: Object.hasOwn(tag.attributes, 'src') ? 'external' : json ? 'json' : 'inline',
      });
    } else {
      // Raw-text parsing depends on tree context (e.g. select/foreign content).
      // Never use an assumed inert range to hide a possible executable tag.
      if (lower(text).includes('<script')) refuse('script-like text in raw-text range');
      if (tag.name === 'style')
        styles.push({ ...tag, contentStart: tag.end, contentEnd: end.start, end: end.end, text });
    }
    cursor = end.end;
  }
  if (foreign.length) refuse('unclosed foreign content');
  return { scripts, styles };
}
