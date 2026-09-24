import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { LoadedModel, type ModelRecord } from './loadedModel.ts';
import { createWorldPoses } from './worldPoses.ts';

/** A compiled model's graph as its loader builds it: a root, a turbine, and its rotor. */
function compiledModel() {
  const root = new G.GraphNode(),
    turbine = new G.GraphNode(),
    rotor = new G.GraphNode();
  root.name = 'Scene';
  turbine.name = 'turbine';
  turbine.position.set(10, 0, 0);
  rotor.name = 'rotor';
  rotor.position.set(0, 5, 0);
  root.add(turbine);
  turbine.add(rotor);
  const record = { scene: { source: root } } as unknown as ModelRecord;
  return { model: new LoadedModel(record), turbine, rotor };
}

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
  const { model, rotor } = compiledModel();
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
});

test('the graph the file carried is left out of a saved scene, its subtree with it', () => {
  const { model } = compiledModel();
  assert.equal(model._fromFile(model.getObjectByName('Scene')!), true);
});
