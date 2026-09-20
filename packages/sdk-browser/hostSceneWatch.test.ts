// GEO-03: the host is allowed to write the source graph directly — `mesh.position.x = 100`,
// a lamp's intensity and pose — without calling any engine API. No revision
// announced it, and the frame was held on a stale scene. The write itself is what announces
// it now (#6): the hooked field increments the watch's revision, the frame compares one
// integer, and a still scene rereads no node.
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

/** The reread nodes: the source models of what is drawn, the lamps, and their ancestors. */
const dessine = (...meshes: THREE.Object3D[]) => meshes.map((sourceMesh) => ({ sourceMesh }));

function veille(source: THREE.Object3D, ...meshes: THREE.Object3D[]) {
  const watch = createHostSceneWatch();
  watch.observe(source, dessine(...meshes));
  return watch;
}

test('the first read announces a change, the next one announces nothing', () => {
  const { source } = graphe();
  const watch = veille(source);
  assert.equal(watch.changed(), true, 'nothing is known of this graph yet');
  assert.equal(watch.changed(), false, 'a reread with no write must be silent');
  assert.equal(watch.changed(), false, 'and stay so');
});

test('a pose written directly by the host is seen, once only', () => {
  const { source, mesh } = graphe();
  const watch = veille(source, mesh);
  watch.changed();
  mesh.position.x = 100;
  assert.equal(watch.changed(), true, 'the direct move must be seen');
  assert.equal(watch.changed(), false, 'and must not be announced twice');
});

test('visibility written directly by the host is seen', () => {
  const { source, mesh } = graphe();
  const watch = veille(source, mesh);
  watch.changed();
  mesh.visible = false;
  assert.equal(watch.changed(), true);
  assert.equal(watch.changed(), false);
});

test("a lamp's intensity, colour, range and pose are seen", () => {
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
    assert.equal(watch.changed(), true, `write not seen: ${ecriture}`);
    assert.equal(watch.changed(), false, 'announced twice');
  }
});

test("a directional lamp's target, outside the source graph, is seen", () => {
  const { source, soleil } = graphe();
  const watch = veille(source);
  watch.changed();
  soleil.target.position.set(0, -5, 0);
  assert.equal(watch.changed(), true, 'the sun direction has changed');
  assert.equal(watch.changed(), false);
});

test('a node added or removed by the host is seen', () => {
  const { source } = graphe();
  const watch = veille(source);
  watch.changed();
  const ajout = new THREE.PointLight(0xff0000, 2);
  source.add(ajout);
  watch.observe(source, []);
  assert.equal(watch.changed(), true, 'one more lamp');
  source.remove(ajout);
  watch.observe(source, []);
  assert.equal(watch.changed(), true, 'one fewer lamp');
  assert.equal(watch.changed(), false);
});

test('the frame gate no longer holds a frame when the host has written the scene', () => {
  const gate = createWebglFrameGate();
  const { source, mesh } = graphe();
  const coupe = [{ id: 1 }] as Array<{ id: number }>;
  const dessins = dessine(mesh);
  gate.readScene(source, dessins);
  gate.keep(1, 3, coupe, 0, false);
  gate.readScene(source, dessins);
  gate.keep(1, 3, coupe, 0, false);
  gate.readScene(source, dessins);
  assert.equal(gate.held(), true, 'with no write, the frame must be held');
  mesh.position.x = 100;
  gate.readScene(source, dessins);
  assert.equal(gate.held(), false, 'the scene moved under the held frame');
});

test('a write the engine made itself is settled with its revision, not announced twice', () => {
  const gate = createWebglFrameGate();
  const { source, mesh } = graphe();
  const dessins = dessine(mesh);
  gate.readScene(source, dessins);
  gate.readScene(source, dessins);
  const before = gate.revisions.scene;
  // What `setTransform` does: writes the node, declares the scene changed, notes the walk done.
  mesh.position.x = 5;
  gate.sceneChanged();
  gate.noteWorldsUpdated();
  gate.readScene(source, dessins);
  assert.equal(gate.revisions.scene, before + 1, 'one change, one revision');
  gate.readScene(source, dessins);
  assert.equal(gate.revisions.scene, before + 1, 'and none after');
});

test('a lamp retargeted by the host: the new target is hooked, its later pose is seen', () => {
  const gate = createWebglFrameGate();
  const { source, soleil } = graphe();
  gate.readScene(source, []);
  gate.readScene(source, []);
  const cible = new THREE.Object3D();
  soleil.target = cible;
  gate.readScene(source, []);
  const after = gate.revisions.scene;
  gate.readScene(source, []);
  assert.equal(gate.revisions.scene, after, 'the retarget is announced once');
  cible.position.y = -3;
  gate.readScene(source, []);
  assert.equal(gate.revisions.scene, after + 1, 'the new target moved: seen');
});

/** The Three engine with a lamp declared in the source graph, which the host will write directly. */
function litEngine() {
  const { geometry, material, source, context } = quadRootsContext(true);
  const lampe = new THREE.PointLight(0xffffff, 1);
  source.add(lampe);
  const backend = exactPagesBackend(context);
  const copie = () =>
    backend.scene.children.find((child) => (child as THREE.Light).isLight) as THREE.PointLight;
  return { backend, lampe, copie, dispose: () => (geometry.dispose(), material.dispose()) };
}

test('a lamp written directly by the host is copied on the next frame', () => {
  const { backend, lampe, copie, dispose } = litEngine();
  const camera = frontCamera();
  backend.render(camera);
  assert.equal(copie().intensity, 1, 'the declared lamp is copied as-is');
  lampe.intensity = 7;
  lampe.position.x = 9;
  backend.render(camera);
  assert.equal(copie().intensity, 7, 'the intensity written by the host did not follow');
  assert.equal(copie().position.x, 9, 'the pose written by the host did not follow');
  backend.dispose();
  dispose();
});
