// World box of transparent items. Their MATRIX is no longer copied: an item carries the one the
// engine holds for its source mesh (`hostWorldPlacements.ts`), so a move is already written there
// before the frame starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBlendCopy } from './blendCopyMesh.ts';
import { hostWorldPlacements } from './hostWorldPlacements.ts';
import { refreshBlendBounds, refreshBlendWorlds } from './webgpuBlendWorlds.ts';
import { BOX_VALUES } from '../sdk-core/index.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/** A transparent item reduced to what the refresh reads: its matrix, box, geometry. The scene
 *  carries the parent from the start: that is the shape the engine indexes at prepare. */
function item(position: THREE.Vector3, cullable = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const parent = new THREE.Group();
  const mesh = new THREE.Mesh(geometry);
  mesh.position.copy(position);
  parent.add(mesh);
  const worlds = hostWorldPlacements(parent);
  const copy = createBlendCopy(mesh, 0, worlds.of(mesh));
  const shaped = {
    matrix: copy.matrix,
    worldBox: cullable ? new Float64Array(BOX_VALUES) : undefined,
    bounds: undefined,
    sourceMesh: mesh,
    sourceGeometry: geometry,
  } as unknown as BlendGpuItem & { sourceMesh: THREE.Mesh };
  refreshBlendBounds(shaped);
  return Object.assign(shaped, { parent, worlds });
}

test('the transparent copy reads the world matrix the engine holds, it keeps no snapshot of it', () => {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.position.set(1, 2, 3);
  const worlds = hostWorldPlacements(mesh);
  const copy = createBlendCopy(mesh, 7, worlds.of(mesh));
  assert.equal(copy.matrix, worlds.of(mesh), 'the matrix IS the one the engine holds');
  assert.equal(copy.matrixAutoUpdate, false, 'Three must never recompose it');
  assert.equal(copy.userData.sourceMesh, mesh);
  assert.equal(copy.renderOrder, 7);
  mesh.position.set(4, 5, 6);
  worlds.refresh();
  assert.deepEqual([...copy.matrix.elements].slice(12, 15), [4, 5, 6], 'the move is already there');
});

test('a world box follows the mesh matrix, a direct move as well as a parent move', () => {
  const mobile = item(new THREE.Vector3(0, 0, 0));
  assert.deepEqual(Array.from(mobile.bounds!), [-1, -1, -1, 1, 1, 1]);

  mobile.sourceMesh.position.set(0, 5, 0);
  mobile.worlds.refresh();
  assert.equal(refreshBlendWorlds([mobile]), 1);
  assert.deepEqual(Array.from(mobile.bounds!), [-1, 4, -1, 1, 6, 1]);

  mobile.parent.position.set(10, 0, 0);
  mobile.worlds.refresh();
  refreshBlendWorlds([mobile]);
  assert.deepEqual(
    Array.from(mobile.bounds!),
    [9, 4, -1, 11, 6, 1],
    'the parent carries the child',
  );
});

test('a shear is not decomposed: the box stays that of the requested matrix', () => {
  const cisaille = item(new THREE.Vector3(0, 0, 0));
  // `y` pushes `x`: the unit box then covers x ∈ [-4, 4], which no TRS product yields. The pose
  // is SET, as `setTransform` does: the engine takes it as-is.
  cisaille.sourceMesh.matrixAutoUpdate = false;
  cisaille.sourceMesh.matrix.set(1, 3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  cisaille.worlds.refresh();
  refreshBlendWorlds([cisaille]);
  assert.deepEqual(Array.from(cisaille.bounds!), [-4, -1, -1, 4, 1, 1]);
});

test('an item that cannot be rejected, with no local box, or whose matrix carries a NaN', () => {
  const libre = item(new THREE.Vector3(1, 0, 0), false);
  assert.equal(libre.bounds, undefined, 'without a box buffer, the item is never rejected');
  assert.equal(refreshBlendWorlds([libre]), 0, 'and it is not even visited');

  const sansBoite = item(new THREE.Vector3(1, 0, 0));
  sansBoite.sourceGeometry.boundingBox = null;
  refreshBlendBounds(sansBoite);
  assert.equal(sansBoite.bounds, undefined, 'no local box, so no rejection');

  const douteux = item(new THREE.Vector3(0, 0, 0));
  douteux.sourceMesh.position.x = Number.NaN;
  douteux.worlds.refresh();
  refreshBlendBounds(douteux);
  assert.equal(douteux.bounds, undefined, 'non-finite bounds do not hide a transparent');
});
