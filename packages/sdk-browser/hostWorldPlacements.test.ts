// hostWorldPlacements.ts : les matrices monde que le MOTEUR tient pour les nœuds dessinés. Le
// contenant est une matrice de la bibliothèque hôte — ce que l'hôte attache et ce que les témoins
// dessinent —, mais ses seize nombres viennent du socle : ils sont confrontés au bit près
// (Object.is) à `matrixWorld` après `updateMatrixWorld(true)` de la référence, sur une scène à
// parents, échelles négatives et non uniformes, et un nœud dont l'hôte a posé la matrice lui-même.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { collectClusterPages } from './pageSelection.ts';
import { hostWorldPlacements } from './hostWorldPlacements.ts';
import { blendFixture } from './pageSelectionBlendFixture.ts';
import { assertBits } from '../sdk-core/bench/oracles/volumes.mjs';

/** Une scène de l'hôte que PERSONNE n'a remontée : racine tournée, parent à échelle négative et non
 *  uniforme, feuille cisaillée par cette échelle, plus un nœud dont la matrice est posée. */
function scene() {
  const racine = new THREE.Group(),
    parent = new THREE.Group(),
    feuille = new THREE.Mesh(),
    pose = new THREE.Group();
  racine.position.set(3, -4, 5);
  racine.quaternion.setFromEuler(new THREE.Euler(0.4, 0.1, -0.2));
  parent.scale.set(-2, 0.5, 3);
  parent.position.set(-0, 7, 0.25);
  feuille.position.set(1, 2, -3);
  feuille.quaternion.setFromEuler(new THREE.Euler(-0.3, 0.7, 0.9));
  feuille.scale.set(1, 1, -1);
  pose.matrixAutoUpdate = false;
  pose.matrix.set(1, 3, 0, 2, 0, 1, 0, -1, 0, 0, 1, 4, 0, 0, 0, 1);
  parent.add(feuille, pose);
  racine.add(parent);
  return { racine, parent, feuille, pose };
}

test('la matrice rendue porte, au bit près, le monde que la référence compose depuis les mêmes poses', () => {
  const { racine, parent, feuille, pose } = scene();
  const worlds = hostWorldPlacements(racine);
  const obtenus = [parent, feuille, pose].map((node) => Array.from(worlds.of(node).elements));
  // Le témoin passe APRÈS : tant qu'il n'a pas remonté le graphe, l'hôte n'a composé aucune matrice.
  racine.updateMatrixWorld(true);
  for (const [rang, node] of [parent, feuille, pose].entries())
    assertBits(obtenus[rang], Array.from(node.matrixWorld.elements));
});

test('la matrice monde de l’hôte n’est ni lue ni écrite : elle reste l’identité qu’il a laissée', () => {
  const { racine, feuille } = scene();
  const worlds = hostWorldPlacements(racine);
  const monde = worlds.of(feuille);
  worlds.refresh();
  assert.deepEqual(
    Array.from(feuille.matrixWorld.elements),
    Array.from(new THREE.Matrix4().elements),
    'le moteur n’a rien écrit dans la scène de l’hôte',
  );
  assert.notDeepEqual(
    Array.from(monde.elements),
    Array.from(feuille.matrixWorld.elements),
    'et ce qu’il tient n’est pas ce que l’hôte porte',
  );
});

test('`refresh` réécrit la matrice rendue au lieu d’en rendre une autre : le porteur voit le déplacement', () => {
  const { racine, parent, feuille } = scene();
  const worlds = hostWorldPlacements(racine);
  const monde = worlds.of(feuille);
  const avant = Array.from(monde.elements);
  parent.position.set(10, -8, 6);
  worlds.refresh();
  assert.equal(worlds.of(feuille), monde, 'la même matrice, jamais une seconde');
  assert.notDeepEqual(Array.from(monde.elements), avant, 'le parent déplacé est dans le monde');
  racine.updateMatrixWorld(true);
  assertBits(Array.from(monde.elements), Array.from(feuille.matrixWorld.elements));
});

test('un nœud hors du sous-arbre indexé est refusé par une erreur nommée', () => {
  const { racine } = scene();
  const worlds = hostWorldPlacements(racine);
  const etranger = new THREE.Group();
  etranger.name = 'étranger';
  assert.throws(
    () => worlds.of(etranger),
    (erreur: unknown) => erreur instanceof EngineError && erreur.code === 'UNKNOWN_TRANSFORM_NODE',
  );
});

test('les fiches de page et les racines de cluster portent la matrice du moteur, pas celle de l’hôte', () => {
  const fixture = blendFixture();
  const parent = new THREE.Group();
  parent.scale.set(2, -1, 0.5);
  parent.add(fixture.source);
  fixture.mesh.position.set(4, -2, 7);
  const { roots, allPages, worlds } = collectClusterPages(
    parent,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const monde = worlds.of(fixture.mesh);
  assert.equal(roots[0].world, monde, 'la racine porte la matrice du moteur');
  for (const page of allPages) assert.equal(page.matrix, monde, 'la fiche porte la même');
  assert.notEqual(monde, fixture.mesh.matrixWorld, 'ce n’est pas la matrice vivante de l’hôte');
  // Le témoin passe après : la collecte n'a jamais demandé à l'hôte de composer quoi que ce soit.
  parent.updateMatrixWorld(true);
  assertBits(Array.from(monde.elements), Array.from(fixture.mesh.matrixWorld.elements));
  fixture.geometry.dispose();
  fixture.material.dispose();
});
