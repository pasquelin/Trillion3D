// GEO-03: the host is allowed to write the source graph directly — `mesh.position.x = 100`,
// a lamp's intensity and pose — without calling any engine API. No revision
// announced it, and the frame was held on a stale scene. A pose write is what announces
// itself now (#6): the hooked field increments the watch's revision and the frame compares one
// integer; the other fields are a few values per node, taken by the same read.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../graph/graph.fixture.ts';
import { createHostSceneWatch } from './watch.ts';
import { createWebglFrameGate } from '../../webgl/core/frameGate.ts';
import { exactPagesBackend } from '../../../../../bench/witnesses/measurement.ts';
import { quadRootsContext, frontCamera } from '../../backend/pagesBackendScenes.fixture.ts';

function graphe() {
  const source = new G.GraphGroup();
  const mesh = G.mesh(new G.GraphGeometry(), G.basicSurface());
  const lampe = G.pointLight(0xffffff, 1);
  const soleil = G.directionalLight(0xffffff, 1);
  source.add(mesh, lampe, soleil);
  source.updateMatrixWorld(true);
  return { source, mesh, lampe, soleil };
}

/** The reread nodes: the source models of what is drawn, the lamps, and their ancestors. */
const dessine = (...meshes: G.GraphNode[]) => meshes.map((sourceMesh) => ({ sourceMesh }));

function veille(source: G.GraphNode, ...meshes: G.GraphNode[]) {
  const watch = createHostSceneWatch();
  watch.observe(source, dessine(...meshes));
  return watch;
}

test('the first read announces a change, the next one announces nothing', () => {
  const { source } = graphe();
  const watch = veille(source);
  assert.equal(watch.take(), 'moved', 'nothing is known of this graph yet');
  assert.equal(watch.take(), 0, 'a reread with no write must be silent');
  assert.equal(watch.take(), 0, 'and stay so');
});

test('a pose written directly by the host is seen, once only', () => {
  const { source, mesh } = graphe();
  const watch = veille(source, mesh);
  watch.take();
  mesh.position.x = 100;
  assert.equal(watch.take(), 'moved', 'the direct move must be seen');
  assert.equal(watch.take(), 0, 'and must not be announced twice');
});

test('visibility written directly by the host is seen; a reparent reshapes', () => {
  const { source, mesh } = graphe();
  const watch = veille(source, mesh);
  watch.take();
  mesh.visible = false;
  assert.equal(watch.take(), 'moved');
  assert.equal(watch.take(), 0);
  new G.GraphGroup().add(mesh);
  assert.equal(watch.take(), 'reshaped', 'the ancestor chain changed');
  assert.equal(watch.take(), 0);
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
    watch.take();
    ecriture();
    assert.equal(watch.take(), 'moved', `write not seen: ${ecriture}`);
    assert.equal(watch.take(), 0, 'announced twice');
  }
});

test("a directional lamp's target, outside the source graph, is seen", () => {
  const { source, soleil } = graphe();
  const watch = veille(source);
  watch.take();
  soleil.target!.position.set(0, -5, 0);
  assert.equal(watch.take(), 'moved', 'the sun direction has changed');
  assert.equal(watch.take(), 0);
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
  // What `setTransform` does: writes the node, then declares the scene changed.
  mesh.position.x = 5;
  gate.sceneChanged();
  gate.readScene(source, dessins);
  assert.equal(gate.revisions.scene, before + 1, 'one change, one revision');
  gate.readScene(source, dessins);
  assert.equal(gate.revisions.scene, before + 1, 'and none after');
  // A structural engine write settled the same way leaves no reshape pending either.
  new G.GraphGroup().add(mesh);
  gate.sceneChanged();
  gate.readScene(source, dessins);
  gate.readScene(source, dessins);
  assert.equal(gate.revisions.scene, before + 2, 'the reparent costs its one revision');
});

test('a lamp retargeted by the host: the new target is hooked, its later pose is seen', () => {
  const gate = createWebglFrameGate();
  const { source, soleil } = graphe();
  gate.readScene(source, []);
  gate.readScene(source, []);
  const cible = new G.GraphNode();
  soleil.target = cible;
  gate.readScene(source, []); // the retarget is a scene change: the list is rebuilt at once
  const after = gate.revisions.scene;
  // Written in the tick right after the reshape frame: the new target is already hooked.
  cible.position.y = -3;
  gate.readScene(source, []);
  assert.equal(gate.revisions.scene, after + 1, 'the new target moved: seen');
  gate.readScene(source, []);
  assert.equal(gate.revisions.scene, after + 1, 'a pose write rebuilt nothing and repeats nothing');
});

/** The Three engine with a lamp declared in the source graph, which the host will write directly. */
function litEngine() {
  const { geometry, material, source, context } = quadRootsContext(true);
  const lampe = G.pointLight(0xffffff, 1);
  source.add(lampe);
  const backend = exactPagesBackend(context);
  const copie = () =>
    backend.scene.children.find(G.isPlacedLight) as G.GraphLight;
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
