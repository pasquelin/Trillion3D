// hostWorldChain.ts : la matrice monde d'UN nœud, calculée par le moteur depuis les poses locales de
// sa chaîne d'ancêtres, confrontée au bit près (Object.is) à `updateWorldMatrix(true, false)` de la
// référence — chaînes hostiles comprises : échelles négatives, nulle, non uniformes sous une
// rotation (cisaillement), `-0`, demi-tour, matrice posée à la main, NaN et infinis.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hostWorldChainInto } from './hostWorldChain.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** Chaîne racine → enfant posé → petit-enfant → feuille, poses hostiles comprises. */
function chaineHostile() {
  const racine = new THREE.Group();
  racine.position.set(1, -2, 3);
  racine.scale.set(-1, 2, 0.5);
  racine.quaternion.set(0, 1, 0, 0); // demi-tour : w = 0
  const enfant = new THREE.Group();
  enfant.matrixAutoUpdate = false; // l'hôte POSE la matrice locale : rien ne la recompose
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

test('hostWorldChainInto rend les mêmes bits que `updateWorldMatrix(true, false)`, chaîne hostile comprise', () => {
  const scene = chaineHostile(),
    reference = chaineHostile();
  const obtenu = new Float64Array(16);
  for (const clef of CLEFS) {
    hostWorldChainInto(obtenu, scene[clef]);
    reference[clef].updateWorldMatrix(true, false);
    assertBits(obtenu, reference[clef].matrixWorld.elements);
  }
});

test('hostWorldChainInto n’écrit rien chez l’hôte : les matrices monde de la chaîne restent intactes', () => {
  const { racine, feuille, enfant, petitEnfant } = chaineHostile();
  const avant = [racine, enfant, petitEnfant, feuille].map((n) => n.matrixWorld.elements.slice());
  hostWorldChainInto(new Float64Array(16), feuille);
  for (const [rang, node] of [racine, enfant, petitEnfant, feuille].entries())
    assertBits(node.matrixWorld.elements, avant[rang]);
});

test('hostWorldChainInto reprend un ancêtre périmé, comme la référence qui remonte la chaîne', () => {
  // Chaîne nette, sans échelle extrême : un déplacement de la racine doit se voir dans la
  // translation de la feuille, sinon le test ne prouverait rien.
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
  scene.racine.updateMatrixWorld(true); // matrices monde posées une première fois
  const perimee = scene.feuille.matrixWorld.elements.slice();
  scene.racine.position.set(100, 100, 100); // la racine devient périmée sans être recalculée
  reference.racine.position.set(100, 100, 100);
  const obtenu = new Float64Array(16);
  hostWorldChainInto(obtenu, scene.feuille);
  reference.feuille.updateWorldMatrix(true, false);
  assertBits(obtenu, reference.feuille.matrixWorld.elements);
  assert.notEqual(obtenu[12], perimee[12], 'la pose périmée a bien bougé : le test n’est pas vide');
});

test('hostWorldChainInto tient une chaîne plus profonde que son tampon de départ, sans perdre un bit', () => {
  // Le tableau des ancêtres part à soixante-quatre places : deux cent cinquante nœuds l'obligent à
  // grandir trois fois, et le résultat doit rester celui de la référence.
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

test('hostWorldChainInto sur une racine rend sa seule matrice locale, comme la référence', () => {
  const racine = new THREE.Group();
  racine.position.set(-0, 4, 5);
  racine.scale.set(-1, -1, -1);
  const obtenu = new Float64Array(16);
  hostWorldChainInto(obtenu, racine);
  racine.updateWorldMatrix(true, false);
  assertBits(obtenu, racine.matrixWorld.elements);
});
