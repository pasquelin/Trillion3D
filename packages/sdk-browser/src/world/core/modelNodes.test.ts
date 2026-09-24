import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { LoadedModel, type ModelRecord } from './loadedModel.ts';
import { createWorldPoses } from './worldPoses.ts';

/** A compiled model's graph as its loader builds it: a root, a turbine and its rotor, and a
 *  crane nobody looks up. */
function compiledModel() {
  const root = new G.GraphNode(),
    turbine = new G.GraphNode(),
    rotor = new G.GraphNode(),
    crane = new G.GraphNode();
  root.name = 'Scene';
  turbine.name = 'turbine';
  turbine.position.set(10, 0, 0);
  rotor.name = 'rotor';
  rotor.position.set(0, 5, 0);
  crane.name = 'crane';
  root.add(turbine, crane);
  turbine.add(rotor);
  const record = { scene: { source: root } } as unknown as ModelRecord;
  return { model: new LoadedModel(record), turbine, rotor };
}

/** Every scene node under `node`, itself left out. */
function countBelow(node: Object3D) {
  let count = -1;
  node.traverse(() => count++);
  return count;
}

test('a compiled model builds no scene node until one is looked up, then only its chain', () => {
  const { model } = compiledModel();
  assert.equal(countBelow(model), 0, 'loading allocates nothing per graph node');
  const scene = new Object3D();
  scene.add(model);
  const rotor = scene.getObjectByName('rotor')!;
  assert.equal(countBelow(model), 3, 'the root, the turbine and the rotor; the crane is left');
  assert.equal(scene.getObjectByName('rotor'), rotor, 'a second lookup finds the same node');
  assert.equal(countBelow(model), 3);
  assert.equal(model.getObjectByName('missing'), undefined);
});

test('every named node of a compiled model is found by name, posed as its graph node', () => {
  const { model, turbine, rotor } = compiledModel();
  for (const graph of [turbine, rotor]) {
    const node = model.getObjectByName(graph.name)!;
    assert.ok(node, `${graph.name} is reachable`);
    assert.deepEqual(node.position.toArray(), [graph.position.x, graph.position.y, 0]);
  }
  assert.equal(model.getObjectByName('rotor')!.parent, model.getObjectByName('turbine'));
});

test('moving a node of a compiled model moves the graph node it is drawn from', () => {
  const { model, turbine, rotor } = compiledModel();
  const scene = new Object3D();
  scene.add(model);
  const poses = createWorldPoses();
  const node = model.getObjectByName('rotor')!;
  node.rotation.set(0, 0, Math.PI / 2);
  node.visible = false;
  poses.moved(node);
  poses.apply(scene, new Map(), new Map(), () => {});
  assert.equal(rotor.position.y, 5, 'the local pose is kept');
  assert.ok(Math.abs(rotor.quaternion.z - Math.SQRT1_2) < 1e-12, 'the turn reached the graph');
  assert.equal(rotor.visible, false, 'and so did the visibility');
  assert.deepEqual([turbine.position.x, turbine.quaternion.z], [10, 0], 'its parent is left');
});

test('a node whose matrix is its pose is read from and written to its matrix', () => {
  const { model, rotor } = compiledModel();
  rotor.position.set(0, 0, 0);
  rotor.matrix.makeTranslation(0, 7, 0);
  rotor.matrixAutoUpdate = false;
  const node = model.getObjectByName('rotor')!;
  assert.equal(node.position.y, 7, 'the pose comes from the matrix');
  node.position.x = 2;
  const poses = createWorldPoses();
  poses.moved(node);
  poses.apply(model, new Map(), new Map(), () => {});
  assert.deepEqual([rotor.matrix.elements[12], rotor.matrix.elements[13]], [2, 7]);
});

test('the graph the file carried is left out of a saved scene, its subtree with it', () => {
  const { model } = compiledModel();
  model.getObjectByName('rotor');
  assert.equal(model._fromFile(model.getObjectByName('Scene')!), true);
});
