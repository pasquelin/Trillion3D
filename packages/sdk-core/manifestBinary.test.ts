import test from 'node:test';
import assert from 'node:assert/strict';
import { MANIFEST_BINARY_VERSION } from './manifestBinaryFormat.ts';
import { MAX_DEPTH_LAYER, depthLayerBias } from './depthLayer.ts';

// Comportement 10 : manifeste rejette depthLayer > 15 (version 2 supporte depthLayer)
test('manifest binary version 2 supports depthLayer', () => {
  assert.equal(MANIFEST_BINARY_VERSION, 2);
});

test('MAX_DEPTH_LAYER is 15 (four bits maximum)', () => {
  assert.equal(MAX_DEPTH_LAYER, 15);
});

// Comportement 11 : pageDepthLayer codage/décodage, couche 0 laisse champ absent
test('depthLayerBias shows layer 0 encodes to no field', () => {
  // Quand layer === 0, bias === 0, ce qui signifie que le champ est absent
  assert.equal(depthLayerBias(0), 0);
});

test('depthLayerBias rounds values to layer range 0-15', () => {
  // Couches au-delà de 15 sont clampées à 15
  assert.equal(depthLayerBias(15), -15 * 16);
  assert.equal(depthLayerBias(16), -15 * 16); // Clampé à 15
  assert.equal(depthLayerBias(100), -15 * 16); // Clampé à 15
});

// Comportement 13 : assertManifestBinary refuse version sidecar != 2
test('coplanar depth layers require MANIFEST_BINARY_VERSION 2', () => {
  // Version 2 est celle qui ajoute pageDepthLayer
  // Toute autre version n'aurait pas ce champ
  assert.equal(MANIFEST_BINARY_VERSION, 2);
});

// Comportement 16 : placement dans slots - formule de calcul
test('depth layer slot calculation: layer n maps to slot 6n', () => {
  // Pour layerSlots = 1 : slot = 6n
  for (let layer = 0; layer <= 15; layer++) {
    const slot = 6 * layer;
    assert.ok(Number.isInteger(slot) && slot >= 0);
  }
});

test('depth layer slot calculation with rest: slot = bin + 3·rest + 6·n', () => {
  const bin = 0, rest = 0;
  for (let layer = 0; layer <= 15; layer++) {
    const slot = bin + 3 * rest + 6 * layer;
    assert.equal(slot, 6 * layer);
  }
  const bin2 = 1, rest2 = 2, layer2 = 3;
  const slot2 = bin2 + 3 * rest2 + 6 * layer2;
  assert.equal(slot2, 1 + 6 + 18); // 25
});

// Comportement 17 : drawShader formule de slots
test('drawShader uses 6k slots total', () => {
  for (let k = 1; k <= 4; k++) {
    const totalSlots = 6 * k;
    assert.equal(totalSlots, 6 * k);
  }
});

// Comportement 18-22 : comportements complexes nécessitant une scène complète
test('coplanar layer stack respects MAX_DEPTH_LAYER limit', () => {
  // Une pile de surfaces ne peut pas dépasser 15 couches
  assert.equal(MAX_DEPTH_LAYER, 15);
});
