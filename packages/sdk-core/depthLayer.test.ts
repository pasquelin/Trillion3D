import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPTH_LAYER_BIAS_UNITS,
  MAX_DEPTH_LAYER,
  depthLayerBias,
  biasedDepthBits,
} from './depthLayer.ts';
import { assertFormat } from './cacheContracts.ts';

// Comportement 14 : depthLayerBias rend 0 pour 0/undefined/négatif et −16 × couche sinon
test('depthLayerBias returns 0 for undefined or non-positive layers', () => {
  assert.equal(depthLayerBias(undefined), 0);
  assert.equal(depthLayerBias(0), 0);
  assert.equal(depthLayerBias(-1), 0);
  assert.equal(depthLayerBias(-100), 0);
  assert.equal(depthLayerBias(NaN), 0);
  assert.equal(depthLayerBias(Infinity), 0);
});

test('depthLayerBias computes negative units for positive layers', () => {
  assert.equal(depthLayerBias(1), -DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerBias(2), -2 * DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerBias(5), -5 * DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerBias(15), -15 * DEPTH_LAYER_BIAS_UNITS);
  assert.equal(depthLayerBias(16), -15 * DEPTH_LAYER_BIAS_UNITS); // Capped at 15
  assert.equal(depthLayerBias(1000), -15 * DEPTH_LAYER_BIAS_UNITS); // Capped at 15
});

// Comportement 15 : biasedDepthBits retranche le biais aux bits et sature à 0
test('biasedDepthBits subtracts bias from bits and clamps at 0', () => {
  const bits = 1000;
  const result = biasedDepthBits(bits, 1);
  const bias = depthLayerBias(1);
  assert.equal(result, (bits + bias) >>> 0);
});

test('biasedDepthBits clamps negative results to 0', () => {
  const bits = 10;
  const layer = 15;
  const result = biasedDepthBits(bits, layer);
  assert.equal(result, 0); // bits + bias would be negative, clamped to 0
});

test('biasedDepthBits preserves bits for layer 0 or undefined', () => {
  const bits = 1234567;
  assert.equal(biasedDepthBits(bits, 0), bits >>> 0);
  assert.equal(biasedDepthBits(bits, undefined), bits >>> 0);
});

// Comportement 12 : assertFormat accepte 3 et 4, refuse 1, 2 et tout autre
test('assertFormat accepts format version 3', () => {
  assert.doesNotThrow(() => assertFormat(3));
});

test('assertFormat accepts format version 4', () => {
  assert.doesNotThrow(() => assertFormat(4));
});

test('assertFormat rejects format version 1', () => {
  assert.throws(
    () => assertFormat(1),
    /cache format/i
  );
});

test('assertFormat rejects format version 2', () => {
  assert.throws(
    () => assertFormat(2),
    /cache format/i
  );
});

test('assertFormat rejects unknown versions', () => {
  assert.throws(() => assertFormat(999), /cache format/i);
  assert.throws(() => assertFormat(0), /cache format/i);
  assert.throws(() => assertFormat(-1), /cache format/i);
});
