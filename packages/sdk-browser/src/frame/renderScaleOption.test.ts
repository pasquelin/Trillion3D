import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScaleBounds } from './renderScaleOption.ts';

test('a page asks the controller, its bounds, or one fixed scale, always within [0.5, 1]', () => {
  assert.deepEqual(renderScaleBounds('auto'), { auto: true, min: 0.5, max: 1 });
  assert.deepEqual(renderScaleBounds({ min: 0.7 }), { auto: true, min: 0.7, max: 1 });
  assert.deepEqual(renderScaleBounds({ min: 0.9, max: 0.6 }), { auto: true, min: 0.6, max: 0.6 });
  assert.deepEqual(renderScaleBounds({ min: 0.1, max: 2 }), { auto: true, min: 0.5, max: 1 });
  assert.deepEqual(renderScaleBounds(0.67), { auto: false, min: 0.67, max: 0.67 });
  assert.deepEqual(renderScaleBounds(0.1), { auto: false, min: 0.5, max: 0.5 });
  for (const absent of [undefined, Number.NaN, 1.5])
    assert.deepEqual(renderScaleBounds(absent), { auto: false, min: 1, max: 1 }, `${absent}`);
});

test('an engine that only resamples names its own floor, the minimum of a page that names none', () => {
  assert.deepEqual(renderScaleBounds('auto', 1), { auto: true, min: 1, max: 1 });
  assert.deepEqual(renderScaleBounds({ max: 0.8 }, 1), { auto: true, min: 0.8, max: 0.8 });
  assert.deepEqual(renderScaleBounds({ min: 0.6 }, 1), { auto: true, min: 0.6, max: 1 });
});
