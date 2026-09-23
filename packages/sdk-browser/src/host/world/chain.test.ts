// chain.ts: the world matrix of ONE node, computed by the engine from the local poses
// of its ancestor chain, compared bit-for-bit (Object.is) to the reference's
// `updateWorldMatrix(true, false)` — hostile chains included: negative scales, a null scale,
// non-uniform under a rotation (shear), `-0`, half-turn, a hand-set matrix, NaN and infinities.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hostWorldChainInto } from './chain.ts';
import { assertBits } from '../../../../../tests/kit/assert/bits.ts';

/** Root → posed child → grandchild → leaf chain, hostile poses included. */
function chaineHostile() {
  const racine = new THREE.Group();
  racine.position.set(1, -2, 3);
  racine.scale.set(-1, 2, 0.5);
  racine.quaternion.set(0, 1, 0, 0); // half-turn: w = 0
  const enfant = new THREE.Group();
  enfant.matrixAutoUpdate = false; // the host SETS the local matrix: nothing recomposes it
  enfant.matrix.set(1, 0.7, 0, 5, 0, 1, 0, -2, 0, 0, 3, 0, 0, 0, 0, 1);
  racine.add(enfant);
  const petitEnfant = new THREE.Group();
  petitEnfant.position.set(-0, 0.25, -7);
  petitEnfant.scale.set(0, 1e150, -3);
  enfant.add(petitEnfant);
  const feuille = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  feuille.position.set(2, -2, 2);
  feuille.quaternion.set(0.5, 0.5, 0.5, 0.5);
  petitEnfant.add(feuille);
  return { racine, enfant, petitEnfant, feuille };
}

const CLEFS = ['racine', 'enfant', 'petitEnfant', 'feuille'] as const;

test('hostWorldChainInto returns the same bits as `updateWorldMatrix(true, false)`, hostile chain included', () => {
  const scene = chaineHostile(),
    reference = chaineHostile();
  const obtenu = new Float64Array(16);
  for (const clef of CLEFS) {
    hostWorldChainInto(obtenu, scene[clef]);
    reference[clef].updateWorldMatrix(true, false);
    assertBits(obtenu, reference[clef].matrixWorld.elements);
  }
});

test('hostWorldChainInto writes nothing on the host: the chain world matrices stay intact', () => {
  const { racine, feuille, enfant, petitEnfant } = chaineHostile();
  const avant = [racine, enfant, petitEnfant, feuille].map((n) => n.matrixWorld.elements.slice());
  hostWorldChainInto(new Float64Array(16), feuille);
  for (const [rang, node] of [racine, enfant, petitEnfant, feuille].entries())
    assertBits(node.matrixWorld.elements, avant[rang]);
});

test('hostWorldChainInto retakes a stale ancestor, like the reference that walks the chain', () => {
  // Clean chain, no extreme scale: a root move must show in the leaf translation, otherwise
  // the test would prove nothing.
  const chaine = () => {
    const racine = new THREE.Group();
    racine.position.set(1, -2, 3);
    racine.scale.set(-1, 2, 0.5);
    const feuille = new THREE.Group();
    feuille.position.set(2, -2, 2);
    racine.add(feuille);
    return { racine, feuille };
  };
  const scene = chaine(),
    reference = chaine();
  scene.racine.updateMatrixWorld(true); // world matrices set a first time
  const perimee = scene.feuille.matrixWorld.elements.slice();
  scene.racine.position.set(100, 100, 100); // the root becomes stale without being recomputed
  reference.racine.position.set(100, 100, 100);
  const obtenu = new Float64Array(16);
  hostWorldChainInto(obtenu, scene.feuille);
  reference.feuille.updateWorldMatrix(true, false);
  assertBits(obtenu, reference.feuille.matrixWorld.elements);
  assert.notEqual(obtenu[12], perimee[12], 'the stale pose did move: the test is not empty');
});

test('hostWorldChainInto holds a chain deeper than its starting buffer, without losing a bit', () => {
  // The ancestor array starts at sixty-four slots: two hundred and fifty nodes force it to grow
  // three times, and the result must stay that of the reference.
  let node = new THREE.Group();
  const racine = node;
  for (let rang = 1; rang < 250; rang++) {
    const enfant = new THREE.Group();
    enfant.position.set(rang, -rang, 1 / rang);
    enfant.scale.set(rang % 3 === 0 ? -1 : 1, 1, 1);
    node.add(enfant);
    node = enfant;
  }
  const obtenu = new Float64Array(16);
  hostWorldChainInto(obtenu, node);
  racine.updateMatrixWorld(true);
  assertBits(obtenu, node.matrixWorld.elements);
});

test('hostWorldChainInto on a root returns its local matrix alone, like the reference', () => {
  const racine = new THREE.Group();
  racine.position.set(-0, 4, 5);
  racine.scale.set(-1, -1, -1);
  const obtenu = new Float64Array(16);
  hostWorldChainInto(obtenu, racine);
  racine.updateWorldMatrix(true, false);
  assertBits(obtenu, racine.matrixWorld.elements);
});
