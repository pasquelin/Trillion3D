import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightLines } from '../docs/js/components/highlightLines.js';

test('multiline syntax tokens stay balanced and preserve escaped source per row', () => {
  const source = 'const text = `first\n<script>second</script>`;\n/* comment\ncontinued */\n';
  const rows = highlightLines(source);
  assert.equal(rows.length, source.split('\n').length);
  const recovered = rows
    .map((row) => {
      assert.equal((row.match(/<span\b/g) ?? []).length, (row.match(/<\/span>/g) ?? []).length);
      assert.doesNotMatch(row, /<script>/);
      return row
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&');
    })
    .join('\n');
  assert.equal(recovered, source);
  assert.match(rows[0], /hljs-keyword/);
  assert.match(rows[1], /hljs-string/);
  assert.match(rows[3], /hljs-comment/);
});
