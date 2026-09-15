// La reprise des matrices monde des items transparents, avant que l'image n'ouvre son chronomètre.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { refreshBlendWorlds } from './webgpuPagesRender.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';

/** Un item transparent réduit à ce que la reprise lit : sa matrice, sa boîte, son maillage source. */
function item(position: THREE.Vector3) {
  const geometry = new THREE.BufferGeometry();
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const mesh = new THREE.Mesh(geometry);
  mesh.position.copy(position);
  mesh.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4().copy(mesh.matrixWorld);
  const box = geometry.boundingBox.clone().applyMatrix4(matrix);
  const bounds = Float64Array.of(...box.min.toArray(), ...box.max.toArray());
  return {
    matrix,
    bounds,
    sourceMesh: mesh,
    sourceGeometry: geometry,
  } as unknown as BlendGpuItem & { sourceMesh: THREE.Mesh };
}

test('une scène immobile ne retransporte aucune boîte, et une matrice qui bouge emporte la sienne', () => {
  const fixe = item(new THREE.Vector3(3, 0, 0)),
    mobile = item(new THREE.Vector3(0, 0, 0));
  const items = [fixe, mobile];
  assert.equal(refreshBlendWorlds(items), 0, 'rien n’a bougé depuis la préparation');
  const boiteFixe = fixe.bounds!.slice();

  mobile.sourceMesh.position.set(0, 5, 0);
  mobile.sourceMesh.updateMatrixWorld(true);
  assert.equal(refreshBlendWorlds(items), 1, 'seul l’item déplacé est repris');
  assert.deepEqual(Array.from(mobile.bounds!), [-1, 4, -1, 1, 6, 1]);
  assert.deepEqual(mobile.matrix.elements, [...mobile.sourceMesh.matrixWorld.elements]);
  assert.deepEqual(fixe.bounds!, boiteFixe, 'l’autre n’a pas bougé');

  assert.equal(refreshBlendWorlds(items), 0, 'la matrice reprise est celle du maillage');
});

test('un item sans maillage source, sans boîte ou dont la matrice porte un NaN', () => {
  const orphelin = { matrix: new THREE.Matrix4() } as unknown as BlendGpuItem;
  assert.equal(refreshBlendWorlds([orphelin]), 0, 'un item sans source n’est jamais repris');

  const sansBoite = item(new THREE.Vector3(1, 0, 0));
  sansBoite.sourceGeometry.boundingBox = null;
  sansBoite.sourceMesh.position.set(2, 0, 0);
  sansBoite.sourceMesh.updateMatrixWorld(true);
  assert.equal(refreshBlendWorlds([sansBoite]), 1);
  assert.equal(sansBoite.matrix.elements[12], 2, 'la matrice suit même sans boîte à transporter');

  // Un NaN n'est jamais « le même » nombre : l'item est repris à chaque image, ce qui est sûr.
  const douteux = item(new THREE.Vector3(0, 0, 0));
  douteux.sourceMesh.matrixWorld.elements[12] = Number.NaN;
  assert.equal(refreshBlendWorlds([douteux]), 1);
  assert.equal(refreshBlendWorlds([douteux]), 1);
});
