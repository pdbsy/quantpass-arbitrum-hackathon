import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtmlSource } from '../tools/html-source-ranges.mjs';
import { buildPrototypeMap } from '../tools/coverage/prototype-map.mjs';

test('HTML admission and prototype mapping reject non-string public inputs', () => {
  for (const input of [undefined, null, 42, {}, ['<script>1</script>']]) {
    assert.throws(() => analyzeHtmlSource(input), { message: 'Expected HTML source' });
    assert.throws(() => buildPrototypeMap(input), { message: 'Expected frozen HTML source' });
  }
});

test('mismatched SVG closure cannot return a partially accepted script inventory', () => {
  for (const suffix of ['<svg><g></svg>', '</svg>', '<svg></g>']) {
    const source = '<script>globalThis.before = 1;</script>' + suffix;
    assert.throws(() => analyzeHtmlSource(source), {
      message: 'UNSUPPORTED_HTML_SOURCE: foreign content boundary',
    });
  }
});

test('an unfinished SVG stack rejects the complete source after earlier valid scripts', () => {
  for (const suffix of ['<svg>', '<svg><g></g>', '<svg><g><path/>']) {
    const source = '<script>globalThis.before = 1;</script>' + suffix;
    assert.throws(() => analyzeHtmlSource(source), {
      message: 'UNSUPPORTED_HTML_SOURCE: unclosed foreign content',
    });
  }
});

test('a rejected call does not retain SVG state across a later valid admission', () => {
  assert.throws(() => analyzeHtmlSource('<svg><g>'), /unclosed foreign content/);
  const source = '<svg><g><path/></g></svg><script>globalThis.after = 2;</script>';
  const admitted = analyzeHtmlSource(source);
  assert.equal(admitted.scripts.length, 1);
  assert.equal(admitted.styles.length, 0);
  const script = admitted.scripts[0];
  assert.equal(script.kind, 'inline');
  assert.equal(script.text, 'globalThis.after = 2;');
  assert.equal(source.slice(script.contentStart, script.contentEnd), script.text);
  assert.equal(source.slice(script.start, script.end), '<script>globalThis.after = 2;</script>');
});
