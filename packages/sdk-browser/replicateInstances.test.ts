// Lot M4a, replicateInstances.ts : matrices monde des copies calculées par `multiplyMatrix4` du
// socle, bornes à plat. Confrontées au bit près (Object.is) à l'ancien chemin Three
// (`Matrix4.copy` puis `group.updateMatrixWorld`), hiérarchie hostile comprise.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { replicateInstances } from './replicateInstances.ts';
import { ENGINE_OWNED } from './hostSceneWatch.ts';
import { hostWorldBounds } from './hostWorldBounds.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** Deux maillages sous une racine à échelle négative et un enfant à échelle non uniforme. */
function hostileSource() {
  const racine = new THREE.Group();
  racine.scale.set(-1, 1, 1);
  const enfant = new THREE.Group();
  enfant.position.set(3, 0, 0);
  enfant.scale.set(1, 2, 0.5);
  racine.add(enfant);
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  a.position.set(0.5, 0, 0);
  enfant.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  b.position.set(-0.5, 0, 0);
  enfant.add(b);
  return { racine, a, b };
}

/** L'ancien chemin, avant le lot M4a : `Matrix4.copy` puis `group.updateMatrixWorld`. */
function referenceReplicate(
  source: THREE.Object3D,
  associations: Map<THREE.Object3D, unknown>,
  count: 1 | 4 | 9 | 12,
) {
  source.updateMatrixWorld(true);
  if (count === 1) return source;
  const bounds = new THREE.Box3().setFromObject(source);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const [columns, rows] = count === 12 ? [4, 3] : [Math.sqrt(count), Math.sqrt(count)];
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < columns; x++)
      for (const mesh of meshes) {
        const copy = new THREE.Mesh(mesh.geometry, mesh.material);
        copy.matrixAutoUpdate = false;
        copy.matrix.copy(mesh.matrixWorld);
        copy.matrix.elements[12] += (x - (columns - 1) / 2) * size.x;
        copy.matrix.elements[14] += (z - (rows - 1) / 2) * size.z;
        group.add(copy);
      }
  group.updateMatrixWorld(true);
  return group;
}

test('replicateInstances(count=1) rend la source elle-même, sans copie', () => {
  const { racine } = hostileSource();
  const associations = new Map();
  const rendu = replicateInstances(racine, associations, 1);
  assert.equal(rendu, racine);
});

for (const count of [4, 9, 12] as const) {
  test(`replicateInstances(count=${count}) : matrices monde des copies bit à bit identiques à l’ancien chemin Three, source hostile`, () => {
    const obtenu = hostileSource();
    const attendu = hostileSource();
    const groupeObtenu = replicateInstances(obtenu.racine, new Map(), count) as THREE.Group;
    const groupeAttendu = referenceReplicate(attendu.racine, new Map(), count) as THREE.Group;
    assert.equal(groupeObtenu.children.length, groupeAttendu.children.length);
    for (let i = 0; i < groupeObtenu.children.length; i++)
      assertBits(
        (groupeObtenu.children[i] as THREE.Mesh).matrixWorld.elements,
        (groupeAttendu.children[i] as THREE.Mesh).matrixWorld.elements,
      );
  });
}

test('replicateInstances marque chaque copie ENGINE_OWNED et fige sa matrice (matrixAutoUpdate à faux)', () => {
  const { racine } = hostileSource();
  const groupe = replicateInstances(racine, new Map(), 4) as THREE.Group;
  for (const copie of groupe.children as THREE.Mesh[]) {
    assert.equal(copie.userData[ENGINE_OWNED], true);
    assert.equal(copie.matrixAutoUpdate, false);
  }
});

test('replicateInstances reporte l’association de chaque maillage source sur ses copies', () => {
  const { racine, a, b } = hostileSource();
  const associations = new Map<THREE.Object3D, { meshes: number }>([
    [a, { meshes: 0 }],
    [b, { meshes: 1 }],
  ]);
  const groupe = replicateInstances(racine, associations, 4) as THREE.Group;
  for (const copie of groupe.children as THREE.Mesh[])
    assert.ok(associations.get(copie), 'chaque copie porte l’association de son maillage source');
});

test('replicateInstances utilise `preparedBounds` telles quelles, sans recalculer les bornes', () => {
  const { racine } = hostileSource();
  const reelles = hostWorldBounds(racine);
  // Bornes délibérément fausses (deux fois plus larges) : si la fonction les ignorait pour
  // recalculer les siennes, l’espacement de la grille correspondrait aux bornes réelles, pas à
  // celles-ci.
  const fausses = Float64Array.from([
    reelles[0] * 2,
    reelles[1],
    reelles[2],
    reelles[3] * 2,
    reelles[4],
    reelles[5],
  ]);
  const groupe = replicateInstances(racine, new Map(), 4, fausses) as THREE.Group;
  const attenduEspacement = fausses[3] - fausses[0];
  const reelEspacement = reelles[3] - reelles[0];
  const premiere = (groupe.children[0] as THREE.Mesh).matrixWorld.elements[12];
  const derniereColonne = (groupe.children[groupe.children.length - 2] as THREE.Mesh).matrixWorld
    .elements[12];
  assert.notEqual(
    attenduEspacement,
    reelEspacement,
    'le test doit utiliser des bornes différentes',
  );
  assert.ok(
    Math.abs(Math.abs(derniereColonne - premiere) - attenduEspacement) < 1e-9,
    'l’espacement suit `preparedBounds`, pas les bornes réelles',
  );
});

test('un décompte de copies invalide lève', () => {
  const { racine } = hostileSource();
  assert.throws(() => replicateInstances(racine, new Map(), 2 as 1));
});
