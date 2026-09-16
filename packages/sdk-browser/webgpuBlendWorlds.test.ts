// La boîte monde des items transparents. Leur MATRICE n'est plus reprise : un item porte celle de
// son maillage source, si bien qu'un déplacement y est déjà écrit avant que l'image ne commence.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBlendCopy } from './blendCopyMesh.ts';
import { refreshBlendBounds, refreshBlendWorlds } from './webgpuBlendWorlds.ts';
import { BOX_VALUES } from '../sdk-core/index.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/** Un item transparent réduit à ce que la reprise lit : sa matrice, sa boîte, sa géométrie. */
function item(position: THREE.Vector3, cullable = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const mesh = new THREE.Mesh(geometry);
  mesh.position.copy(position);
  mesh.updateMatrixWorld(true);
  const copy = createBlendCopy(mesh, 0);
  const shaped = {
    matrix: copy.matrix,
    worldBox: cullable ? new Float64Array(BOX_VALUES) : undefined,
    bounds: undefined,
    sourceMesh: mesh,
    sourceGeometry: geometry,
  } as unknown as BlendGpuItem & { sourceMesh: THREE.Mesh };
  refreshBlendBounds(shaped);
  return shaped;
}

test('la copie transparente lit la matrice monde de son maillage, elle n’en garde pas de photo', () => {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.position.set(1, 2, 3);
  mesh.updateMatrixWorld(true);
  const copy = createBlendCopy(mesh, 7);
  assert.equal(copy.matrix, mesh.matrixWorld, 'la matrice EST celle du maillage source');
  assert.equal(copy.matrixAutoUpdate, false, 'Three ne doit jamais la recomposer');
  assert.equal(copy.userData.sourceMesh, mesh);
  assert.equal(copy.renderOrder, 7);
  mesh.position.set(4, 5, 6);
  mesh.updateMatrixWorld(true);
  assert.deepEqual(
    [...copy.matrix.elements].slice(12, 15),
    [4, 5, 6],
    'le déplacement est déjà là',
  );
});

test('une boîte monde suit la matrice du maillage, déplacement direct comme déplacement du parent', () => {
  const mobile = item(new THREE.Vector3(0, 0, 0));
  assert.deepEqual(Array.from(mobile.bounds!), [-1, -1, -1, 1, 1, 1]);

  mobile.sourceMesh.position.set(0, 5, 0);
  mobile.sourceMesh.updateMatrixWorld(true);
  assert.equal(refreshBlendWorlds([mobile]), 1);
  assert.deepEqual(Array.from(mobile.bounds!), [-1, 4, -1, 1, 6, 1]);

  const parent = new THREE.Group();
  parent.position.set(10, 0, 0);
  parent.add(mobile.sourceMesh);
  parent.updateMatrixWorld(true);
  refreshBlendWorlds([mobile]);
  assert.deepEqual(Array.from(mobile.bounds!), [9, 4, -1, 11, 6, 1], 'le parent emporte l’enfant');
});

test('un cisaillement n’est pas décomposé : la boîte reste celle de la matrice demandée', () => {
  const cisaille = item(new THREE.Vector3(0, 0, 0));
  // `y` pousse `x` : la boîte unité couvre alors x ∈ [-4, 4], ce qu'aucun produit TRS ne rend.
  cisaille.sourceMesh.matrixWorld.set(1, 3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  refreshBlendWorlds([cisaille]);
  assert.deepEqual(Array.from(cisaille.bounds!), [-4, -1, -1, 4, 1, 1]);
});

test('un item non rejetable, sans boîte locale, ou dont la matrice porte un NaN', () => {
  const libre = item(new THREE.Vector3(1, 0, 0), false);
  assert.equal(libre.bounds, undefined, 'sans tampon de boîte, l’item n’est jamais rejeté');
  assert.equal(refreshBlendWorlds([libre]), 0, 'et il n’est pas même visité');

  const sansBoite = item(new THREE.Vector3(1, 0, 0));
  sansBoite.sourceGeometry.boundingBox = null;
  refreshBlendBounds(sansBoite);
  assert.equal(sansBoite.bounds, undefined, 'aucune boîte locale, donc aucun rejet');

  const douteux = item(new THREE.Vector3(0, 0, 0));
  douteux.sourceMesh.matrixWorld.elements[12] = Number.NaN;
  refreshBlendBounds(douteux);
  assert.equal(douteux.bounds, undefined, 'des bornes non finies ne masquent pas un transparent');
});
