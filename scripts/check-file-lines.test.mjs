import test from 'node:test';
import assert from 'node:assert/strict';
import { lineCount, lineLimitViolations } from './check-file-lines.mjs';

test('counts physical lines, including an unterminated final line', () => {
  assert.equal(lineCount('one\ntwo\n'), 2);
  assert.equal(lineCount('one\ntwo'), 2);
  assert.equal(lineCount(''), 0);
});

test('rejects every oversized file, including existing files', () => {
  const lines = new Map([
    ['new.ts', 201],
    ['old.rs', 5309],
    ['small.mjs', 200],
  ]);
  const errors = lineLimitViolations(lines);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /new.ts: 201 lines/);
  assert.match(errors[1], /old.rs: 5309 lines/);
});

test('checks only selected files during a targeted run', () => {
  const errors = lineLimitViolations(
    new Map([
      ['large.ts', 300],
      ['changed.ts', 199],
    ]),
    new Set(['changed.ts']),
  );
  assert.deepEqual(errors, []);
});
