// A2: visMaterial and the projected triangle are cached per frame (VisibilityFrame) instead
// of being rebuilt at each pixel. Oracle: the pre-batch-A reference in
// `../../../../../bench/oracles/browser/ombrage-image.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rasterVisibilityIds, shadeVisibility } from '../buffer.ts';
import { referenceShadeVisibility } from '../../../../../bench/oracles/browser/ombrage-image.ts';
import { cameraAt, quad } from '../../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';

function bitExactPixels(a: Uint8Array, b: Uint8Array) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++)
    assert.ok(Object.is(a[i], b[i]), `pixel[${i}]: ${a[i]} ≠ ${b[i]}`);
}

test('an empty scene is pure background, bit for bit', () => {
  const cam = cameraAt();
  const ids = new Uint32Array(4);
  const optimisee = shadeVisibility(ids, [], cameraMoteur(cam), [2, 2]);
  const reference = referenceShadeVisibility(ids, [], cam, [2, 2]);
  bitExactPixels(optimisee, reference);
});

test('a MeshBasicMaterial quad shades identically, one pixel and many', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0x4488cc });
  const { page, geometry } = quad(material, [-1, -1, -0.4], [1, 1, -0.4], 'basic');
  const cam = cameraAt();
  for (const size of [
    [1, 1],
    [9, 9],
  ] as [number, number][]) {
    const ids = rasterVisibilityIds([page], cameraMoteur(cam), size);
    const optimisee = shadeVisibility(ids, [page], cameraMoteur(cam), size);
    const reference = referenceShadeVisibility(ids, [page], cam, size);
    bitExactPixels(optimisee, reference);
  }
  geometry.dispose();
  material.dispose();
});

test('a MeshStandardMaterial quad (reads path) shades identically', () => {
  const material = new THREE.MeshStandardMaterial({
    color: 0xaa5533,
    roughness: 0.6,
    metalness: 0.3,
  });
  const { page, geometry } = quad(material, [-1, -1, -0.4], [1, 1, -0.4], 'standard');
  const cam = cameraAt(),
    size: [number, number] = [11, 11];
  const ids = rasterVisibilityIds([page], cameraMoteur(cam), size);
  const optimisee = shadeVisibility(ids, [page], cameraMoteur(cam), size);
  const reference = referenceShadeVisibility(ids, [page], cam, size);
  bitExactPixels(optimisee, reference);
  geometry.dispose();
  material.dispose();
});

test('a triangle whose barycentric weights straddle the accept boundary agrees at the edge pixel', () => {
  // A degenerate sliver: the shared VisibilityFrame's cached triangle should still resolve every
  // pixel exactly like a fresh per-pixel triangleAt would.
  const material = new THREE.MeshBasicMaterial({ color: 0x112233 });
  const { page, geometry } = quad(material, [-0.02, -1, -0.4], [0.02, 1, -0.4], 'sliver');
  const cam = cameraAt(),
    size: [number, number] = [16, 16];
  const ids = rasterVisibilityIds([page], cameraMoteur(cam), size);
  const optimisee = shadeVisibility(ids, [page], cameraMoteur(cam), size);
  const reference = referenceShadeVisibility(ids, [page], cam, size);
  bitExactPixels(optimisee, reference);
  geometry.dispose();
  material.dispose();
});
