import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_LAYER_BIAS_UNITS, depthLayerUnits, biasedDepthBits } from './depthLayer.ts';
import { assertFormat } from './cacheContracts.ts';

// Comportement 14 : depthLayerUnits rend 0 pour 0/undefined/négatif et 16 × couche sinon
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

// Comportement 15 : profondeur inversée — biasedDepthBits AJOUTE les unités et sature aux bits de 1
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

// Comportement 12 : assertFormat accepte 3 et 4, refuse 1, 2 et tout autre
test('assertFormat accepts format version 3', () => {
  assert.doesNotThrow(() => assertFormat(3));
});

test('assertFormat accepts format version 4', () => {
  assert.doesNotThrow(() => assertFormat(4));
});

test('assertFormat rejects format version 1', () => {
  assert.throws(() => assertFormat(1), /cache format/i);
});

test('assertFormat rejects format version 2', () => {
  assert.throws(() => assertFormat(2), /cache format/i);
});

test('assertFormat rejects unknown versions', () => {
  assert.throws(() => assertFormat(999), /cache format/i);
  assert.throws(() => assertFormat(0), /cache format/i);
  assert.throws(() => assertFormat(-1), /cache format/i);
});
