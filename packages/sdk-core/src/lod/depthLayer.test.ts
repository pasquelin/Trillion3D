import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_LAYER_BIAS_UNITS, depthLayerUnits, biasedDepthBits } from './depthLayer.ts';
import { assertFormat } from '../contracts/cache.ts';
import { CLUSTERED_BLEND_FORMAT_VERSION, FORMAT_VERSION } from '../contracts/base.ts';

// Behavior 14: depthLayerUnits returns 0 for 0/undefined/negative and 16 × layer otherwise
test('depthLayerUnits returns 0 for undefined or non-positive layers', () => {
  assert.equal(depthLayerUnits(undefined), 0);
  assert.equal(depthLayerUnits(0), 0);
  assert.equal(depthLayerUnits(-1), 0);
  assert.equal(depthLayerUnits(-100), 0);
  assert.equal(depthLayerUnits(NaN), 0);
  assert.equal(depthLayerUnits(Infinity), 0);
});

test('depthLayerUnits computes a positive magnitude for positive layers', () => {
  assert.equal(depthLayerUnits(1), DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerUnits(2), 2 * DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerUnits(5), 5 * DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerUnits(15), 15 * DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerUnits(16), 15 * DEPTH_LAYER_BIAS_UNITS); // Capped at 15
  assert.equal(depthLayerUnits(1000), 15 * DEPTH_LAYER_BIAS_UNITS); // Capped at 15
});

// Behavior 15: reversed depth — biasedDepthBits ADDS units and clamps at 1.0 bits
test('biasedDepthBits adds the layer units to the bits', () => {
  const bits = 1000;
  assert.equal(biasedDepthBits(bits, 1), bits + depthLayerUnits(1));
});

test('biasedDepthBits clamps at the bits of 1.0, the near plane', () => {
  const ONE_BITS = 0x3f800000;
  assert.equal(biasedDepthBits(ONE_BITS - 8, 15), ONE_BITS);
  assert.equal(biasedDepthBits(ONE_BITS, 1), ONE_BITS);
});

test('biasedDepthBits preserves bits for layer 0 or undefined', () => {
  const bits = 1234567;
  assert.equal(biasedDepthBits(bits, 0), bits >>> 0);
  assert.equal(biasedDepthBits(bits, undefined), bits >>> 0);
});

// Behavior 12: assertFormat accepts the two formats this runtime reads, and refuses every other —
// the constants decide, so raising them cannot leave a stale number passing here.
test('assertFormat accepts the format this runtime reads', () => {
  assert.doesNotThrow(() => assertFormat(FORMAT_VERSION));
});

test('assertFormat accepts the clustered-blend format', () => {
  assert.doesNotThrow(() => assertFormat(CLUSTERED_BLEND_FORMAT_VERSION));
});

test('assertFormat rejects every format below the one it reads', () => {
  for (let version = 1; version < FORMAT_VERSION; version++)
    assert.throws(() => assertFormat(version), /cache format/i);
});

test('assertFormat rejects unknown versions', () => {
  assert.throws(() => assertFormat(999), /cache format/i);
  assert.throws(() => assertFormat(0), /cache format/i);
  assert.throws(() => assertFormat(-1), /cache format/i);
});
