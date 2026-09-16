// GEO-03 : l'hôte a le droit d'écrire le graphe source directement — `mesh.position.x = 100`,
// l'intensité et la pose d'une lampe — sans appeler la moindre API du moteur. Aucune révision ne
// l'annonçait, et l'image était tenue sur une scène périmée. La relecture du graphe est ce qui
// l'annonce ; elle est exacte, bornée par les nœuds et les lampes, et idempotente.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHostSceneWatch } from './hostSceneWatch.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';
import { exactPagesBackend } from './index.ts';
import { quadRootsContext, frontCamera } from './pagesBackendScenes.ts';

function graphe() {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  const lampe = new THREE.PointLight(0xffffff, 1);
  const soleil = new THREE.DirectionalLight(0xffffff, 1);
  source.add(mesh, lampe, soleil);
  source.updateMatrixWorld(true);
  return { source, mesh, lampe, soleil };
}

/** Les nœuds relus : les modèles source de ce qui est dessiné, les lampes, et leurs ancêtres. */
const dessine = (...meshes: THREE.Object3D[]) => meshes.map((sourceMesh) => ({ sourceMesh }));

function veille(source: THREE.Object3D, ...meshes: THREE.Object3D[]) {
  const watch = createHostSceneWatch();
  watch.observe(source, dessine(...meshes));
  return watch;
}

test('la première lecture annonce un changement, la suivante n’annonce rien', () => {
  const { source } = graphe();
  const watch = veille(source);
  assert.equal(watch.changed(), true, 'rien n’est encore connu de ce graphe');
  assert.equal(watch.changed(), false, 'une relecture sans écriture doit être muette');
  assert.equal(watch.changed(), false, 'et le rester');
});

test('une pose écrite directement par l’hôte est vue, une seule fois', () => {
  const { source, mesh } = graphe();
  const watch = veille(source, mesh);
  watch.changed();
  mesh.position.x = 100;
  assert.equal(watch.changed(), true, 'le déplacement direct doit être vu');
  assert.equal(watch.changed(), false, 'et ne pas être annoncé deux fois');
});

test('la visibilité écrite directement par l’hôte est vue', () => {
  const { source, mesh } = graphe();
  const watch = veille(source, mesh);
  watch.changed();
  mesh.visible = false;
  assert.equal(watch.changed(), true);
  assert.equal(watch.changed(), false);
});

test('l’intensité, la couleur, la portée et la pose d’une lampe sont vues', () => {
  const { source, lampe } = graphe();
  const watch = veille(source);
  for (const ecriture of [
    () => (lampe.intensity = 7),
    () => (lampe.position.x = 9),
    () => lampe.color.setRGB(0.25, 0.5, 0.75),
    () => (lampe.distance = 42),
    () => (lampe.decay = 3),
  ]) {
    watch.changed();
    ecriture();
    assert.equal(watch.changed(), true, `écriture non vue : ${ecriture}`);
    assert.equal(watch.changed(), false, 'annoncée deux fois');
  }
});

test('la cible d’une lampe directionnelle, hors du graphe source, est vue', () => {
  const { source, soleil } = graphe();
  const watch = veille(source);
  watch.changed();
  soleil.target.position.set(0, -5, 0);
  assert.equal(watch.changed(), true, 'la direction du soleil a changé');
  assert.equal(watch.changed(), false);
});

test('un nœud ajouté ou retiré par l’hôte est vu', () => {
  const { source } = graphe();
  const watch = veille(source);
  watch.changed();
  const ajout = new THREE.PointLight(0xff0000, 2);
  source.add(ajout);
  watch.observe(source, []);
  assert.equal(watch.changed(), true, 'une lampe de plus');
  source.remove(ajout);
  watch.observe(source, []);
  assert.equal(watch.changed(), true, 'une lampe de moins');
  assert.equal(watch.changed(), false);
});

test('la porte d’image ne tient plus une image quand l’hôte a écrit la scène', () => {
  const gate = createWebglFrameGate();
  const { source, mesh } = graphe();
  const coupe = [{ id: 1 }] as Array<{ id: number }>;
  const dessins = dessine(mesh);
  gate.readScene(source, dessins);
  gate.keep(1, 3, coupe, 0, false);
  gate.readScene(source, dessins);
  gate.keep(1, 3, coupe, 0, false);
  gate.readScene(source, dessins);
  assert.equal(gate.held(), true, 'sans écriture, l’image doit être tenue');
  mesh.position.x = 100;
  gate.readScene(source, dessins);
  assert.equal(gate.held(), false, 'la scène a bougé sous l’image tenue');
});

/** Le moteur Three avec une lampe déclarée dans le graphe source, que l'hôte écrira directement. */
function moteurEclaire() {
  const { geometry, material, source, context } = quadRootsContext(true);
  const lampe = new THREE.PointLight(0xffffff, 1);
  source.add(lampe);
  const backend = exactPagesBackend(context);
  const copie = () =>
    backend.scene.children.find((child) => (child as THREE.Light).isLight) as THREE.PointLight;
  return { backend, lampe, copie, dispose: () => (geometry.dispose(), material.dispose()) };
}

test('une lampe écrite directement par l’hôte est recopiée dès l’image suivante', () => {
  const { backend, lampe, copie, dispose } = moteurEclaire();
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(copie().intensity, 1, 'la lampe déclarée est recopiée telle quelle');
  lampe.intensity = 7;
  lampe.position.x = 9;
  backend.render(camera);
  assert.equal(copie().intensity, 7, 'l’intensité écrite par l’hôte n’a pas suivi');
  assert.equal(copie().position.x, 9, 'la pose écrite par l’hôte n’a pas suivi');
  backend.dispose();
  dispose();
});
