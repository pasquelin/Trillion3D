// Lot M4a, explorerCamera.ts : cadrage par bornes à plat et `sphereFromBounds` du socle au lieu de
// `Box3`/`getCenter`/`getSize().length()/2` de Three. Confronté au bit près (Object.is) à l'ancien
// chemin, autonome et non autonome, sur des bornes hostiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createExplorerCamera } from './explorerCamera.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

const canvas = { width: 800, height: 450 } as unknown as HTMLCanvasElement;

/** L'ancien chemin non autonome : `expandByObject` par maillage, `getCenter`/`getSize().length()/2`. */
function referenceFraming(source: THREE.Object3D) {
  const bounds = new THREE.Box3();
  source.updateMatrixWorld(true); // l'ancien `objects()` de sceneMeshes.ts résolvait le sous-arbre avant de le parcourir
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) bounds.expandByObject(o as THREE.Mesh);
  });
  const center = bounds.getCenter(new THREE.Vector3()),
    radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  return { bounds, center, radius };
}

/** Sous-arbre hostile, profondeur 3 : échelle négative puis non uniforme. */
function hostileScene() {
  const racine = new THREE.Group();
  racine.scale.set(-3, 1, 1);
  const enfant = new THREE.Group();
  enfant.position.set(2, -4, 6);
  enfant.scale.set(1, 0.25, 5);
  racine.add(enfant);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(1, 1, 1);
  enfant.add(petitEnfant);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshBasicMaterial());
  mesh.position.set(-1, 2, -3);
  petitEnfant.add(mesh);
  return racine;
}

test('createExplorerCamera (non autonome) rend les mêmes bornes, centre et rayon que expandByObject + getCenter/getSize().length()/2', () => {
  const source = hostileScene();
  const { bounds: b, center, radius } = referenceFraming(source);
  const rendu = createExplorerCamera(
    hostileScene(),
    false,
    new Map(),
    { primitives: [] },
    canvas,
    {},
  );
  assertBits(
    [rendu.bounds.min.x, rendu.bounds.min.y, rendu.bounds.min.z],
    [b.min.x, b.min.y, b.min.z],
  );
  assertBits(
    [rendu.bounds.max.x, rendu.bounds.max.y, rendu.bounds.max.z],
    [b.max.x, b.max.y, b.max.z],
  );
  assertBits([rendu.center.x, rendu.center.y, rendu.center.z], [center.x, center.y, center.z]);
  assert.ok(Object.is(rendu.radius, radius), `rayon : ${rendu.radius} !== ${radius}`);
});

test('createExplorerCamera (autonome) rend les mêmes bornes, centre et rayon que exactPagesBounds/expandByObject de référence', () => {
  const geometry = new THREE.BufferGeometry();
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(4, -2, 0);
  source.add(mesh);
  const metadata = {
    primitives: [{ mesh: 0, primitive: 0, pages: [{ id: 0, min: [-1, -1, -1], max: [1, 1, 1] }] }],
  } as unknown as ClusterManifest;
  const associations = new Map<THREE.Mesh, { meshes: number; primitives: number }>([
    [mesh, { meshes: 0, primitives: 0 }],
  ]);
  const rendu = createExplorerCamera(source, true, associations, metadata, canvas, {});
  // Référence : la même page transformée par la matrice monde du maillage, via Box3.applyMatrix4.
  // Le témoin résout le graphe lui-même : depuis le lot 8, le moteur ne compose plus celui de l'hôte.
  source.updateMatrixWorld(true);
  const attendu = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  ).applyMatrix4(mesh.matrixWorld);
  const center = attendu.getCenter(new THREE.Vector3()),
    radius = attendu.getSize(new THREE.Vector3()).length() / 2;
  assertBits([rendu.center.x, rendu.center.y, rendu.center.z], [center.x, center.y, center.z]);
  assert.ok(Object.is(rendu.radius, radius));
});

test('createExplorerCamera lève sur une scène sans géométrie, bornes vides', () => {
  const source = new THREE.Group();
  source.add(new THREE.Group());
  assert.throws(
    () => createExplorerCamera(source, false, new Map(), { primitives: [] }, canvas, {}),
    /Empty scene bounds/,
  );
});
