// A1 : visibilityDepth projette les sommets d'un triangle une fois par image (cache par identifiant
// de visibilité) au lieu d'une fois par pixel. L'oracle est la référence recopiée avant le lot A dans
// `bench/oracles/hiz.mjs` (importer le banc lui-même l'exécuterait).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BACKGROUND } from '../sdk-core/index.ts';
import { packVisibilityId, rasterVisibilityIds } from './visibilityBuffer.ts';
import { visibilityDepth } from './hiz.ts';
import { referenceVisibilityDepth } from './bench/oracles/hiz.mjs';
import { cameraAt, quad } from '../../test/fixtures/hiz.ts';

function bitExactDepth(a: Float32Array, b: Float32Array) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++)
    assert.ok(Object.is(a[i], b[i]), `depth[${i}]: ${a[i]} ≠ ${b[i]}`);
}

test('no page and a zero viewport both stay pure background', () => {
  const cam = cameraAt();
  const empty = new Uint32Array(0);
  const optimisee = visibilityDepth(empty, [], cam, [0, 0]);
  const reference = referenceVisibilityDepth(empty, [], cam, [0, 0]);
  assert.equal(optimisee.length, 0);
  bitExactDepth(optimisee, reference);
});

test('an id with no matching page falls back to background, bit for bit', () => {
  const cam = cameraAt();
  const ids = new Uint32Array(4).fill(packVisibilityId(3, 0));
  const optimisee = visibilityDepth(ids, [], cam, [2, 2]);
  const reference = referenceVisibilityDepth(ids, [], cam, [2, 2]);
  assert.ok(optimisee.every((z) => z === HIZ_BACKGROUND));
  bitExactDepth(optimisee, reference);
});

test('a degenerate (zero-area) triangle never wins a pixel', () => {
  const material = new THREE.MeshBasicMaterial();
  // Three collinear points: any pixel's barycentric area is exactly 0.
  const { page, geometry } = quad(material, [-1, 0, 0], [1, 0, 0], 'flat');
  const cam = cameraAt(),
    size: [number, number] = [8, 8];
  const ids = rasterVisibilityIds([page], cam, size);
  const optimisee = visibilityDepth(ids, [page], cam, size);
  const reference = referenceVisibilityDepth(ids, [page], cam, size);
  bitExactDepth(optimisee, reference);
  geometry.dispose();
  material.dispose();
});

test('adjacent pixels on the same triangle and a repeated cache miss agree with the reference', () => {
  const material = new THREE.MeshBasicMaterial();
  const { page, geometry } = quad(material, [-1, -1, -0.3], [1, 1, -0.3], 'front');
  const cam = cameraAt(),
    size: [number, number] = [17, 17];
  const ids = rasterVisibilityIds([page], cam, size);
  const optimisee = visibilityDepth(ids, [page], cam, size);
  const reference = referenceVisibilityDepth(ids, [page], cam, size);
  bitExactDepth(optimisee, reference);
  // The cache keys on the visibility id: forcing the same id twice in a row (cache hit) and then a
  // fresh one (cache miss) must still read the same floats `triangleAt` would compute directly.
  const shuffled = new Uint32Array(ids.length);
  for (let i = 0; i < ids.length; i++) shuffled[i] = ids[ids.length - 1 - i];
  const optimiseeShuffled = visibilityDepth(shuffled, [page], cam, size);
  const referenceShuffled = referenceVisibilityDepth(shuffled, [page], cam, size);
  bitExactDepth(optimiseeShuffled, referenceShuffled);
  geometry.dispose();
  material.dispose();
});

test('a page whose index reaches past its triangle stays background, not a thrown error', () => {
  const page = {
    array: new Uint32Array([0, 1]), // Truncated triangle: base + 2 >= index.length.
    attributes: new THREE.BufferGeometry().attributes,
    matrix: new THREE.Matrix4(),
    material: new THREE.MeshBasicMaterial(),
  };
  const cam = cameraAt();
  const ids = new Uint32Array(1).fill(packVisibilityId(0, 0));
  const optimisee = visibilityDepth(ids, [page], cam, [1, 1]);
  const reference = referenceVisibilityDepth(ids, [page], cam, [1, 1]);
  bitExactDepth(optimisee, reference);
});
