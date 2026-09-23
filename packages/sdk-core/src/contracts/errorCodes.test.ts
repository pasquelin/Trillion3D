import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENGINE_ERROR_CODES, engineErrorOf } from './errorCodes.ts';
import { EngineError } from './cache.ts';

test('the codes a page may test are the ones documented on EngineError', () => {
  const source = readFileSync(new URL('./cache.ts', import.meta.url), 'utf8');
  const documented = [...source.matchAll(/@errorCode (.*?) - /g)].flatMap((match) =>
    match[1].split(/,\s*/),
  );
  assert.deepEqual([...ENGINE_ERROR_CODES], documented);
});

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
