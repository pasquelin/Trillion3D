import test from 'node:test';
import assert from 'node:assert/strict';
import { engineErrorOf } from './errorCodes.ts';
import { EngineError } from './cache.ts';

test('an error becomes a named engine error, its cause kept', () => {
  const named = new EngineError('PAGE_BUDGET', 'too many pages');
  assert.equal(engineErrorOf(named, 'FALLBACK', 'x'), named);
  const lost = new Error('WEBGPU_UNAVAILABLE');
  const converted = engineErrorOf(lost, 'FALLBACK', 'Opening failed');
  assert.equal(converted.code, 'WEBGPU_UNAVAILABLE');
  assert.equal(converted.message, 'Opening failed: WEBGPU_UNAVAILABLE');
  assert.equal(converted.details.cause, lost);
  // A code not documented, or any other text, is the fallback's.
  assert.equal(engineErrorOf(new Error('PAGE_HTTP_404'), 'FALLBACK', 'x').code, 'FALLBACK');
  assert.equal(engineErrorOf('boom', 'FALLBACK', 'x').code, 'FALLBACK');
});

test('an engine error of a code no page can test is the fallback, the original its cause', () => {
  const undocumented = new EngineError('PAGE_HTTP_404', 'not found');
  const converted = engineErrorOf(undocumented, 'FALLBACK', 'Opening failed');
  assert.equal(converted.code, 'FALLBACK');
  assert.equal(converted.message, 'Opening failed: not found');
  assert.equal(converted.details.cause, undocumented);
  // Its message is not taken for a code either.
  const worded = new EngineError('PAGE_HTTP_404', 'WEBGPU_LOST');
  assert.equal(engineErrorOf(worded, 'FALLBACK', 'x').code, 'FALLBACK');
});
