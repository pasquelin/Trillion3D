// `gateCore.ts` separates a scene that MOVED from a scene that changed SHAPE. Reading the
// watched list anew is a walk of the whole source graph, one hook and one snapshot per node: a
// node the engine moves every image would pay it every image, for a set whose members did not
// change. These tests hold that separation on the public entry, never on an internal counter.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { createFrameGateCore } from './gateCore.ts';

/** A source graph and the entry list that names the node the engine draws. */
function scene() {
  const source = new G.GraphGroup(),
    mesh = G.mesh();
  mesh.name = 'drawn';
  source.add(mesh);
  return { source, drawn: [{ sourceMesh: mesh }] };
}

/** How many times frame entry asked for the drawn list, hence rebuilt the watched set. */
function counted(drawn: ReadonlyArray<unknown>) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    list: () => {
      calls++;
      return drawn;
    },
  };
}

test('a pose the engine moved does not have the source graph read anew on the next image', () => {
  const { source, drawn } = scene();
  const gate = createFrameGateCore(1);
  const list = counted(drawn);
  gate.readScene(source, list.list);
  const built = list.calls;
  assert.ok(built > 0, 'the first image builds the watched set');
  gate.sceneMoved();
  gate.readScene(source, list.list);
  assert.equal(list.calls, built, 'a move rebuilds nothing');
});

test('a change of shape still has it read anew: that is what a new instance or light needs', () => {
  const { source, drawn } = scene();
  const gate = createFrameGateCore(1);
  const list = counted(drawn);
  gate.readScene(source, list.list);
  const built = list.calls;
  gate.sceneChanged();
  gate.readScene(source, list.list);
  assert.ok(list.calls > built, 'a reshape reads the graph again');
});

test('both announce the scene: a held frame is refused after either of them', () => {
  const { source, drawn } = scene();
  for (const announce of ['sceneMoved', 'sceneChanged'] as const) {
    const gate = createFrameGateCore(1);
    const before = gate.revisions.scene;
    gate[announce]();
    assert.notEqual(gate.revisions.scene, before, `${announce} moves the scene revision`);
    gate.readScene(source, drawn);
  }
});

test('a host write of its own is still taken after a move: the watch keeps listening', () => {
  const { source, drawn } = scene();
  const mesh = (drawn[0] as { sourceMesh: G.GraphMesh }).sourceMesh;
  const gate = createFrameGateCore(1);
  gate.readScene(source, drawn);
  gate.sceneMoved();
  const revision = gate.revisions.scene;
  gate.readScene(source, drawn);
  assert.equal(gate.revisions.scene, revision, 'a still scene announces nothing');
  mesh.visible = false;
  gate.readScene(source, drawn);
  assert.notEqual(gate.revisions.scene, revision, 'the host write is still seen');
});

test('a move announced before the first image still has the watched set built', () => {
  const { source, drawn } = scene();
  const mesh = (drawn[0] as { sourceMesh: G.GraphMesh }).sourceMesh;
  const gate = createFrameGateCore(1);
  gate.sceneMoved();
  gate.readScene(source, drawn);
  const revision = gate.revisions.scene;
  mesh.visible = false;
  gate.readScene(source, drawn);
  assert.notEqual(gate.revisions.scene, revision, 'the host write reaches a watch that exists');
});

test('a reshape then a move before the same image: the node the reshape brought in is hooked', () => {
  const { source, drawn } = scene();
  const gate = createFrameGateCore(1);
  const entrant = G.mesh();
  const list = [...drawn, { sourceMesh: entrant }];
  gate.readScene(source, drawn);
  source.add(entrant);
  gate.sceneChanged(); // the reshape: the watched set owes a rebuild
  gate.sceneMoved(); // a pose the engine moved, same interval, before the image
  gate.readScene(source, list);
  const revision = gate.revisions.scene;
  entrant.visible = false;
  gate.readScene(source, list);
  assert.notEqual(gate.revisions.scene, revision, 'the write on the entered node is seen');
});
