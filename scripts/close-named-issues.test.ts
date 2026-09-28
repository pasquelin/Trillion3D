import test from 'node:test';
import assert from 'node:assert/strict';
import { namedIssues } from './close-named-issues.ts';

test('a closing keyword names its issue, whatever its case', () => {
  assert.deepEqual(namedIssues('Closes #1'), [1]);
  assert.deepEqual(namedIssues('closes #2'), [2]);
  assert.deepEqual(namedIssues('FIXED #7, resolves: #8'), [7, 8]);
});

test('several issues, in order, and none', () => {
  assert.deepEqual(namedIssues('Closes #4\n\nIt also fixes #5 and resolved #6.'), [4, 5, 6]);
  assert.deepEqual(namedIssues('What changed: the tangents are paged.'), []);
  assert.deepEqual(namedIssues(''), []);
});

test('an issue named twice is closed once', () => {
  assert.deepEqual(namedIssues('Closes #9\nfixes #9, closes #10'), [9, 10]);
});

test('code, HTML comments and other repositories never close an issue', () => {
  const body = [
    'Closes #11',
    '```',
    'Closes #12',
    '```',
    'Write `Closes #13` first.',
    '<!-- Closes #14 -->',
    '- A step:',
    '  ````ts',
    '  fixes #18',
    '  ````',
    'Closes owner/other#15, closes#16, encloses #17',
  ].join('\n');
  assert.deepEqual(namedIssues(body), [11]);
});

test('a step says "Part of" and leaves its issue open', () => {
  assert.deepEqual(namedIssues('Part of #3'), []);
});
