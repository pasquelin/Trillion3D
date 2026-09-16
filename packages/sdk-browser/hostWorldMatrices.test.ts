// Lot M4a, hostWorldMatrices.ts : la frontière unique de résolution du graphe hôte, confrontée au
// bit près (Object.is) à `updateMatrixWorld`/`updateWorldMatrix` de Three sur un sous-arbre hostile
// (échelles négatives, non uniformes, cisaillement, matrice singulière, NaN, ±0, infinis, profondeur
// ≥ 3), plus le forçage du recalcul, l'idempotence et le fait qu'aucun parent n'est remonté.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hostWorldPositionInto, resolveHostNode, resolveHostSubtree } from './hostWorldMatrices.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** Chaîne parent → enfant → petit-enfant → arrière-petit-enfant, transforms hostiles comprises. */
function hostileHierarchy() {
  const racine = new THREE.Group();
  racine.position.set(1, -2, 3);
  racine.scale.set(-1, 2, 0.5); // échelle négative et non uniforme
  const enfant = new THREE.Group();
  enfant.matrixAutoUpdate = false;
  // Matrice posée à la main, colonne-major : cisaillement en x selon y, échelle nulle sur z.
  enfant.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -Infinity, 0, 0, 0, 0, 0, 0, 0, 1);
  racine.add(enfant);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(NaN, 0, -0);
  enfant.add(petitEnfant);
  const feuille = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  feuille.position.set(2, 2, 2);
  petitEnfant.add(feuille);
  return { racine, enfant, petitEnfant, feuille };
}

test('resolveHostSubtree rend les mêmes matrices monde qu’updateMatrixWorld(true), sous-arbre hostile compris', () => {
  const obtenu = hostileHierarchy();
  const attendu = hostileHierarchy();
  resolveHostSubtree(obtenu.racine);
  attendu.racine.updateMatrixWorld(true);
  for (const clef of ['racine', 'enfant', 'petitEnfant', 'feuille'] as const)
    assertBits(obtenu[clef].matrixWorld.elements, attendu[clef].matrixWorld.elements);
});

test('resolveHostSubtree est idempotent : un second appel ne change aucun bit', () => {
  const { racine, feuille } = hostileHierarchy();
  resolveHostSubtree(racine);
  const premier = feuille.matrixWorld.elements.slice();
  resolveHostSubtree(racine);
  assertBits(feuille.matrixWorld.elements, premier);
});

test('resolveHostSubtree force toujours le recalcul (force: true) : une matrice locale réécrite à la main, sans passer par updateMatrix, est quand même reprise', () => {
  const parent = new THREE.Group();
  parent.matrixAutoUpdate = false; // l’hôte pose sa propre matrice locale
  const enfant = new THREE.Group();
  parent.add(enfant);
  resolveHostSubtree(parent); // première résolution : matrixWorld = identité pour les deux
  // L’hôte réécrit la matrice locale directement : rien ne marque le nœud sale.
  parent.matrix.elements[12] = 7;
  resolveHostSubtree(parent);
  const attendu = new THREE.Matrix4();
  attendu.elements[12] = 7;
  assertBits(parent.matrixWorld.elements, attendu.elements);
  assertBits(enfant.matrixWorld.elements, attendu.elements, 'l’enfant hérite du parent recalculé');
});

test('resolveHostSubtree ne remonte pas les parents : un ancêtre resté périmé n’est pas recalculé, et l’enfant en hérite tel quel, comme updateMatrixWorld(true) appelé directement sur l’enfant', () => {
  const { racine, enfant } = hostileHierarchy();
  racine.updateMatrixWorld(true); // matrixWorld de racine posée une première fois
  // La racine devient périmée sans être remise à jour : sa position change, matrixWorld reste l’ancienne
  // valeur tant que rien ne la recalcule.
  racine.position.set(100, 100, 100);
  const perimee = racine.matrixWorld.elements.slice();
  resolveHostSubtree(enfant);
  const ref = hostileHierarchy();
  ref.racine.updateMatrixWorld(true);
  ref.racine.position.set(100, 100, 100);
  ref.enfant.updateMatrixWorld(true);
  assertBits(racine.matrixWorld.elements, perimee, 'la racine ne doit pas être recalculée');
  assertBits(racine.matrixWorld.elements, ref.racine.matrixWorld.elements);
  assertBits(enfant.matrixWorld.elements, ref.enfant.matrixWorld.elements);
});

test('resolveHostNode remonte la chaîne des ancêtres : un ancêtre périmé est repris, comme updateWorldMatrix(true, false)', () => {
  const { racine, enfant } = hostileHierarchy();
  racine.updateMatrixWorld(true);
  racine.position.set(100, 100, 100); // racine périmée, jamais remise à jour explicitement
  resolveHostNode(enfant);
  const ref = hostileHierarchy();
  ref.racine.updateMatrixWorld(true);
  ref.racine.position.set(100, 100, 100);
  ref.enfant.updateWorldMatrix(true, false);
  assertBits(racine.matrixWorld.elements, ref.racine.matrixWorld.elements, 'l’ancêtre est repris');
  assertBits(enfant.matrixWorld.elements, ref.enfant.matrixWorld.elements);
});

test('resolveHostNode laisse les enfants en l’état, comme updateWorldMatrix(true, false)', () => {
  // Hiérarchie propre (sans NaN/infinis) : ce test vérifie une propriété comportementale, pas
  // l’exactitude bit à bit, et un translate net évite toute ambiguïté avec la contamination NaN.
  const parent = new THREE.Group();
  const node = new THREE.Group();
  node.matrixAutoUpdate = false;
  parent.add(node);
  const enfant = new THREE.Group();
  node.add(enfant);
  resolveHostSubtree(parent); // tout résolu une première fois : identités
  const enfantAvant = enfant.matrixWorld.elements.slice();
  // L’hôte réécrit la matrice locale de `node` à la main, sans passer par updateMatrix.
  node.matrix.elements[12] = 999;
  resolveHostNode(node);
  assert.notEqual(
    node.matrixWorld.elements[12],
    0,
    'node, lui, a bien changé : le test n’est pas vide',
  );
  assertBits(enfant.matrixWorld.elements, enfantAvant, 'l’enfant ne doit pas être recalculé');
});

test('hostWorldPositionInto rend la même translation que getWorldPosition, x/y/z distincts (profondeur 3, échelle négative et non uniforme)', () => {
  // Composantes distinctes exprès : la contamination NaN de `hostileHierarchy` rendrait un échange
  // x/y/z indétectable (NaN égale NaN sous Object.is).
  const racine = new THREE.Group();
  racine.position.set(10, 20, 30);
  racine.scale.set(-2, 3, 0.5);
  const enfant = new THREE.Group();
  enfant.position.set(1, 2, 3);
  racine.add(enfant);
  const feuille = new THREE.Group();
  feuille.position.set(0.25, -0.5, 7);
  enfant.add(feuille);
  resolveHostSubtree(racine);
  const attendu = new THREE.Vector3();
  feuille.getWorldPosition(attendu);
  const obtenu = new Float64Array(5).fill(-1); // décalage non nul pour vérifier l’écriture à `o`
  hostWorldPositionInto(obtenu, 2, feuille);
  assertBits(obtenu.subarray(2, 5), [attendu.x, attendu.y, attendu.z]);
  assert.equal(obtenu[0], -1, 'rien avant le décalage');
  assert.equal(obtenu[1], -1, 'rien avant le décalage');
});

test('hostWorldPositionInto rend la même translation que getWorldPosition sur un sous-arbre hostile (NaN, infinis)', () => {
  const { racine, feuille } = hostileHierarchy();
  resolveHostSubtree(racine);
  const attendu = new THREE.Vector3();
  feuille.getWorldPosition(attendu);
  const obtenu = new Float64Array(3);
  hostWorldPositionInto(obtenu, 0, feuille);
  assertBits(obtenu, [attendu.x, attendu.y, attendu.z]);
});
