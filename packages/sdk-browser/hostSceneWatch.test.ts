// GEO-03 : l'hôte a le droit d'écrire le graphe source directement — `mesh.position.x = 100`,
// l'intensité et la pose d'une lampe — sans appeler la moindre API du moteur. Aucune révision ne
// l'annonçait, et l'image était tenue sur une scène périmée. La relecture du graphe est ce qui
// l'annonce ; elle est exacte, bornée par les nœuds et les lampes, et idempotente.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHostSceneWatch } from './hostSceneWatch.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';

function graphe() {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const lampe = new THREE.PointLight(0xffffff, 1);
  const soleil = new THREE.DirectionalLight(0xffffff, 1);
  source.add(mesh, lampe, soleil);
  source.updateMatrixWorld(true);
  return { source, mesh, lampe, soleil };
}

test('la première lecture annonce un changement, la suivante n’annonce rien', () => {
  const watch = createHostSceneWatch();
  const { source } = graphe();
  assert.equal(watch.changed(source), true, 'rien n’est encore connu de ce graphe');
  assert.equal(watch.changed(source), false, 'une relecture sans écriture doit être muette');
  assert.equal(watch.changed(source), false, 'et le rester');
});

test('une pose écrite directement par l’hôte est vue, une seule fois', () => {
  const watch = createHostSceneWatch();
  const { source, mesh } = graphe();
  watch.changed(source);
  mesh.position.x = 100;
  assert.equal(watch.changed(source), true, 'le déplacement direct doit être vu');
  assert.equal(watch.changed(source), false, 'et ne pas être annoncé deux fois');
  assert.equal(mesh.matrixWorld.elements[12], 100, 'la relecture remonte les matrices monde');
});

test('la visibilité écrite directement par l’hôte est vue', () => {
  const watch = createHostSceneWatch();
  const { source, mesh } = graphe();
  watch.changed(source);
  mesh.visible = false;
  assert.equal(watch.changed(source), true);
  assert.equal(watch.changed(source), false);
});

test('l’intensité, la couleur, la portée et la pose d’une lampe sont vues', () => {
  const watch = createHostSceneWatch();
  const { source, lampe } = graphe();
  for (const ecriture of [
    () => (lampe.intensity = 7),
    () => (lampe.position.x = 9),
    () => lampe.color.setRGB(0.25, 0.5, 0.75),
    () => (lampe.distance = 42),
    () => (lampe.decay = 3),
  ]) {
    watch.changed(source);
    ecriture();
    assert.equal(watch.changed(source), true, `écriture non vue : ${ecriture}`);
    assert.equal(watch.changed(source), false, 'annoncée deux fois');
  }
});

test('la cible d’une lampe directionnelle, hors du graphe source, est vue', () => {
  const watch = createHostSceneWatch();
  const { source, soleil } = graphe();
  watch.changed(source);
  soleil.target.position.set(0, -5, 0);
  assert.equal(watch.changed(source), true, 'la direction du soleil a changé');
  assert.equal(watch.changed(source), false);
});

test('un nœud ajouté ou retiré par l’hôte est vu', () => {
  const watch = createHostSceneWatch();
  const { source } = graphe();
  watch.changed(source);
  const ajout = new THREE.Object3D();
  source.add(ajout);
  assert.equal(watch.changed(source), true, 'un nœud de plus');
  source.remove(ajout);
  assert.equal(watch.changed(source), true, 'un nœud de moins');
  assert.equal(watch.changed(source), false);
});

test('la porte d’image ne tient plus une image quand l’hôte a écrit la scène', () => {
  const gate = createWebglFrameGate();
  const { source, mesh } = graphe();
  const coupe = [{ id: 1 }] as Array<{ id: number }>;
  gate.readScene(source);
  gate.keep(1, 3, coupe, 0, false);
  gate.readScene(source);
  gate.keep(1, 3, coupe, 0, false);
  gate.readScene(source);
  assert.equal(gate.held(), true, 'sans écriture, l’image doit être tenue');
  mesh.position.x = 100;
  gate.readScene(source);
  assert.equal(gate.held(), false, 'la scène a bougé sous l’image tenue');
});
