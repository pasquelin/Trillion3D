// hostWorldTree.ts : les matrices monde d'un sous-arbre, calculées par LE MOTEUR depuis les poses
// locales de l'hôte, confrontées au bit près (Object.is) à `node.matrixWorld` après
// `updateMatrixWorld(true)` de la référence — sur une vraie scène de la bibliothèque hôte avec
// parents, échelles négatives et non uniformes, `-0`, demi-tours et un nœud dont l'hôte a posé la
// matrice lui-même. Les deux chemins sont éprouvés : le lot de hiérarchie et l'arbre du socle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { EngineError, MATRIX_VALUES } from '../sdk-core/index.ts';
import { prepareSdkWasm } from './geometryPageWasm.ts';
import { prepareMathBatch } from './mathBatchState.ts';
import { hostWorldLot, hostWorldTree } from './hostWorldTree.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, 'pageCodec.wasm')));

/** Échelles, rotations et positions hostiles, tirées à tour de rôle par la construction. */
const ECHELLES = [
  [1, 1, 1],
  [-1, 2, 0.5],
  [2, -3, 0.25],
  [1, 1, -1],
  [0.5, 0.5, 0.5],
];
const ROTATIONS = [
  [0, 0, 0, 1],
  [0, 1, 0, 0],
  [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
  [0.5, 0.5, 0.5, 0.5],
];
const POSITIONS = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
  [0.25, -0.5, 7],
];

/**
 * Une scène de l'hôte : une racine, trois niveaux, cinq enfants par nœud du premier niveau. Chaque
 * nœud tire sa pose dans les listes ci-dessus ; une échelle non uniforme sous une rotation parente
 * cisaille la matrice monde.
 */
function scene(pose?: (node: THREE.Object3D, rang: number) => void) {
  const nodes: THREE.Object3D[] = [];
  const ajoute = (parent: THREE.Object3D | null) => {
    const node = new THREE.Group();
    const rang = nodes.length;
    node.name = `n${rang}`;
    node.position.fromArray(POSITIONS[rang % POSITIONS.length]);
    node.quaternion.fromArray(ROTATIONS[rang % ROTATIONS.length]);
    node.scale.fromArray(ECHELLES[rang % ECHELLES.length]);
    pose?.(node, rang);
    parent?.add(node);
    nodes.push(node);
    return node;
  };
  const racine = ajoute(null);
  for (let branche = 0; branche < 5; branche++) {
    const premier = ajoute(racine);
    for (let enfant = 0; enfant < 5; enfant++) ajoute(ajoute(premier));
  }
  return { racine, nodes };
}

/** Chaque nœud comparé à ce que la référence a composé pour lui. */
function compare(
  nodes: readonly THREE.Object3D[],
  mondes: { world(n: THREE.Object3D): Float64Array },
) {
  for (const node of nodes) assertBits(mondes.world(node), node.matrixWorld.elements);
}

test('les matrices monde du moteur sont celles de la référence, au bit près, par le LOT de hiérarchie', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  assert.equal(mondes.n, nodes.length, 'tout le sous-arbre est indexé');
  assert.equal(mondes.batched, true, 'un sous-arbre qui recompose part en lot');
  // La référence compose APRÈS le moteur : rien de ce qu'elle écrit n'a pu servir d'entrée.
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('le chemin JavaScript du lot rend les mêmes bits que le chemin WebAssembly', async () => {
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  await prepareMathBatch('js');
  const mondes = hostWorldTree(racine, lot);
  assert.equal(mondes.batched, true);
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('un nœud dont l’hôte a posé la matrice lui-même passe par l’arbre du socle, aux mêmes bits', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene((node, rang) => {
    if (rang !== 7) return;
    node.matrixAutoUpdate = false;
    // Un cisaillement : aucune pose translation-rotation-échelle ne le donne.
    node.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -2, 0, 0, 3, 0, 0, 0, 0, 1);
  });
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  assert.equal(mondes.batched, false, 'le lot ne sait pas recevoir une matrice posée');
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('sans lot, l’arbre du socle rend les mêmes bits que la référence', () => {
  const { racine, nodes } = scene();
  const mondes = hostWorldTree(racine);
  assert.equal(mondes.batched, false);
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
});

test('le moteur n’écrit jamais `matrixWorld` chez l’hôte', () => {
  const { racine, nodes } = scene();
  const mondes = hostWorldTree(racine);
  const identite = new THREE.Matrix4().elements;
  for (const node of nodes) assertBits(node.matrixWorld.elements, identite);
  // Et ce que le moteur tient, lui, n'est pas l'identité : la comparaison n'est pas vide.
  assert.notEqual(mondes.world(nodes[3])[12], 0);
});

test('l’index couvre les ancêtres de la racine du sous-arbre : le moteur ne part pas d’un parent périmé', () => {
  const { racine, nodes } = scene();
  const grandParent = new THREE.Group();
  grandParent.position.set(9, -9, 9);
  grandParent.scale.set(-2, 1, 1);
  const parent = new THREE.Group();
  parent.quaternion.set(0, 1, 0, 0);
  grandParent.add(parent);
  parent.add(racine);
  const mondes = hostWorldTree(racine);
  assert.equal(mondes.n, nodes.length + 2, 'les deux ancêtres sont indexés');
  grandParent.updateMatrixWorld(true);
  compare([grandParent, parent, ...nodes], mondes);
});

test('`refresh` reprend une pose que l’hôte vient d’écrire, sur les deux chemins', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  nodes[2].position.set(42, -42, 42);
  mondes.refresh();
  racine.updateMatrixWorld(true);
  compare(nodes, mondes);
  lot.release();
});

test('les vues du lot survivent à une croissance de la mémoire du module', async () => {
  await prepareMathBatch('wasm');
  const { racine, nodes } = scene();
  const lot = await hostWorldLot(racine);
  assert.ok(lot);
  const mondes = hostWorldTree(racine, lot);
  const avant = mondes.world(nodes[9]).slice();
  const wasm = await prepareSdkWasm();
  assert.ok(wasm);
  const gros = wasm.arena_alloc(64 * 1024 * 1024);
  assert.ok(gros, 'la grande réservation doit aboutir');
  const apres = mondes.world(nodes[9]);
  assert.equal(apres.length, MATRIX_VALUES);
  assertBits(apres, avant);
  wasm.arena_free(gros, 64 * 1024 * 1024);
  lot.release();
});

test('un nœud hors de l’index est refusé, il ne rend pas une pose neutre', () => {
  const { racine } = scene();
  const etranger = new THREE.Group();
  etranger.name = 'etranger';
  assert.throws(
    () => hostWorldTree(racine).world(etranger),
    (erreur: unknown) =>
      erreur instanceof EngineError &&
      erreur.code === 'UNKNOWN_TRANSFORM_NODE' &&
      erreur.details.nodeName === 'etranger',
  );
});
