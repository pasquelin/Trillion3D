// Batch H2: the pure off-thread decode contract — no platform here, only the shape of
// rejections and the pool bound. Hostile inputs: unknown messages, missing or non-integer sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_DECODE_FAILURES,
  pageDecodeFailureCode,
  pageDecodeWorkerCount,
} from './decodeContracts.ts';

test('each named rejection of the closed list finds itself', () => {
  for (const code of PAGE_DECODE_FAILURES) assert.equal(pageDecodeFailureCode(code), code);
});

test('an unknown or empty message falls back to PAGE_DECODE_FAILED', () => {
  assert.equal(pageDecodeFailureCode('boom'), 'PAGE_DECODE_FAILED');
  assert.equal(pageDecodeFailureCode(''), 'PAGE_DECODE_FAILED');
  assert.equal(pageDecodeFailureCode('geometry_page_header'), 'PAGE_DECODE_FAILED'); // different case
});

test('the pool bound keeps the smallest of cores, ceiling and admission', () => {
  assert.equal(pageDecodeWorkerCount(8, 6), 4); // default ceiling (4) tightest
  assert.equal(pageDecodeWorkerCount(8, 2), 2); // tightest admission
  assert.equal(pageDecodeWorkerCount(1, 10), 1); // tightest cores
  assert.equal(pageDecodeWorkerCount(10, 10, 2), 2); // explicit ceiling tightest
});

test('missing or non-integer cores equal a single executor', () => {
  assert.equal(pageDecodeWorkerCount(undefined, 10), 1);
  assert.equal(pageDecodeWorkerCount(Number.NaN, 10), 1);
  assert.equal(pageDecodeWorkerCount(3.5, 10), 1);
  assert.equal(pageDecodeWorkerCount(Number.POSITIVE_INFINITY, 10), 1);
});

test('a missing or non-integer admission equals a single admitted executor', () => {
  assert.equal(pageDecodeWorkerCount(8, undefined as unknown as number), 1);
  assert.equal(pageDecodeWorkerCount(8, Number.NaN), 1);
  assert.equal(pageDecodeWorkerCount(8, 2.9), 1);
});

test('the bound never falls under a single executor, even at zero or negative', () => {
  assert.equal(pageDecodeWorkerCount(8, 0), 1);
  assert.equal(pageDecodeWorkerCount(0, 10), 1);
  assert.equal(pageDecodeWorkerCount(8, -5), 1);
});
