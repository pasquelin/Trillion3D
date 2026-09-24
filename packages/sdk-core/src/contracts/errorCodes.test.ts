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

test('an object that is no error says its message, its code or its JSON, never [object Object]', () => {
  const said = (cause: unknown) => engineErrorOf(cause, 'FALLBACK', 'Opening failed').message;
  assert.equal(said({ message: 'adapter refused' }), 'Opening failed: adapter refused');
  assert.equal(engineErrorOf({ code: 'WEBGPU_LOST' }, 'FALLBACK', 'x').code, 'WEBGPU_LOST');
  assert.equal(said({ reason: 'gone', at: 3 }), 'Opening failed: {"reason":"gone","at":3}');
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.equal(said(cycle), 'Opening failed: Object (cannot be written out)');
  assert.doesNotMatch(said(Object.create(null)), /\[object Object\]/);
});
