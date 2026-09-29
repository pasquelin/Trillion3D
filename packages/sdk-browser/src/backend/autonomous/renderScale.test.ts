import test from 'node:test';
import assert from 'node:assert/strict';
import { autonomousRenderScale } from './renderScale.ts';

// #834: WebGL2 resamples, it never reconstructs, so it draws below the display only when a page
// asks: its default minimum is 1, `'auto'` included, where WebGPU's is 0.5.
test('the WebGL2 render scale has a default minimum of 1', () => {
  const bounds = (asked?: Parameters<typeof autonomousRenderScale>[0]['renderScale']) =>
    autonomousRenderScale({ renderScale: asked }).renderScaleControl.bounds;
  assert.deepEqual(bounds('auto'), { auto: true, min: 1, max: 1 });
  assert.deepEqual(bounds(undefined), { auto: false, min: 1, max: 1 });
  assert.deepEqual(bounds({ max: 0.8 }), { auto: true, min: 0.8, max: 0.8 });
  assert.deepEqual(bounds({ min: 0.5 }), { auto: true, min: 0.5, max: 1 });
  assert.deepEqual(bounds(0.6), { auto: false, min: 0.6, max: 0.6 });
  const scale = autonomousRenderScale({ renderScale: 0.6 });
  scale.setRenderScale('auto');
  assert.deepEqual(scale.renderScaleControl.bounds, { auto: true, min: 1, max: 1 });
});
