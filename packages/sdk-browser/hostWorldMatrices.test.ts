// hostWorldMatrices.ts : la frontière de LECTURE du graphe hôte. Deux sujets ici — la pose locale
// d'un nœud, lue par le moteur et confrontée au bit près (Object.is) à `updateMatrix` de Three sur
// des poses hostiles (échelles négatives, non uniformes, nulles, `-0`, demi-tour, matrice posée à la
// main), et le refus d'une pose non finie. La mise à jour de la scène de l'HÔTE, elle, reste
// confrontée à `updateMatrixWorld(true)` : elle sert encore ses propres lecteurs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { assertFiniteTransform, hostLocalInto, resolveHostSubtree } from './hostWorldMatrices.ts';
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

/** Les poses que la référence compose : échelles négatives, nulle, `-0`, demi-tour, non uniformes. */
const POSES: [number[], number[], number[]][] = [
  [
    [0, 0, 0],
    [0, 0, 0, 1],
    [1, 1, 1],
  ],
  [
    [-0, -0, -0],
    [0, 1, 0, 0],
    [-1, 2, 0.5],
  ],
  [
    [3, -4, 5],
    [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    [0, 1, 1],
  ],
  [
    [1e150, -1e150, 1e-300],
    [0.5, 0.5, 0.5, 0.5],
    [-2, 3, 0.25],
  ],
  [
    [10, 20, 30],
    [0, 0, 0, 1],
    [1e-300, 1, -1],
  ],
];

test('hostLocalInto rend la matrice locale d’updateMatrix, au bit près, sur des poses hostiles', () => {
  const obtenu = new Float64Array(16);
  for (const [position, quaternion, echelle] of POSES) {
    const node = new THREE.Object3D();
    node.position.fromArray(position);
    node.quaternion.fromArray(quaternion);
    node.scale.fromArray(echelle);
    hostLocalInto(obtenu, node);
    node.updateMatrix(); // la référence compose la MÊME pose
    assertBits(obtenu, node.matrix.elements);
  }
});

test('hostLocalInto rend la matrice POSÉE quand l’hôte a coupé la recomposition, sans jamais la recomposer', () => {
  const node = new THREE.Object3D();
  node.matrixAutoUpdate = false;
  // Un cisaillement : aucune pose translation-rotation-échelle ne le donne, donc recomposer se verrait.
  node.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -3, 0, 0, 0, 0, 0, 0, 0, 1);
  node.position.set(100, 100, 100); // pose contredisant la matrice : elle ne doit pas être lue
  const obtenu = new Float64Array(16);
  hostLocalInto(obtenu, node);
  assertBits(obtenu, node.matrix.elements);
});

test('hostLocalInto n’écrit rien dans le nœud de l’hôte : sa matrice locale reste celle qu’il portait', () => {
  const node = new THREE.Object3D();
  node.position.set(1, 2, 3);
  const avant = node.matrix.elements.slice(); // identité : `updateMatrix` n’a jamais été appelé
  hostLocalInto(new Float64Array(16), node);
  assertBits(node.matrix.elements, avant);
});

// Cas 4 de la convention des normales singulières (lot normales singulières) : une pose non finie
// n'entre jamais dans le moteur, elle est refusée ici même, avant toute inversion ou toute lecture
// de normale.
test('assertFiniteTransform : une matrice entièrement finie passe sans lever', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(1, -2, 3),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.5, 0.2)),
    new THREE.Vector3(-2, 3, 0.5),
  ).elements;
  assert.doesNotThrow(() => assertFiniteTransform(m, 'noeud'));
});

test('assertFiniteTransform : NaN à n’importe quel des seize indices lève NON_FINITE_TRANSFORM avec le nom du nœud et le rang fautif', () => {
  for (let index = 0; index < 16; index++) {
    const m = new THREE.Matrix4().identity().elements.slice();
    m[index] = NaN;
    assert.throws(
      () => assertFiniteTransform(m, 'cible'),
      (erreur: unknown) =>
        erreur instanceof EngineError &&
        erreur.code === 'NON_FINITE_TRANSFORM' &&
        erreur.details.nodeName === 'cible' &&
        erreur.details.index === index &&
        Number.isNaN(erreur.details.value as number),
      `index ${index} : NaN non refusé`,
    );
  }
});

test('assertFiniteTransform : un infini, positif ou négatif, lève NON_FINITE_TRANSFORM', () => {
  for (const valeur of [Infinity, -Infinity]) {
    const m = new THREE.Matrix4().identity().elements.slice();
    m[5] = valeur;
    assert.throws(
      () => assertFiniteTransform(m, 'lampe'),
      (erreur: unknown) =>
        erreur instanceof EngineError &&
        erreur.code === 'NON_FINITE_TRANSFORM' &&
        erreur.details.index === 5 &&
        erreur.details.value === valeur,
      `${valeur} non refusé`,
    );
  }
});
