import assert from 'node:assert/strict';
import test from 'node:test';
import { isPassing } from './failure.ts';

test('a video refused or cut short in passing does not open the error card', () => {
  assert.equal(isPassing(new DOMException('interrupted by pause()', 'AbortError')), true);
  assert.equal(isPassing(new DOMException('no gesture yet', 'NotAllowedError')), true);
  assert.equal(isPassing(new DOMException('no such file', 'NotFoundError')), false);
  assert.equal(isPassing(new Error('the model did not load')), false);
});
