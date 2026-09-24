import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { hostWorldPlacements } from '../../host/world/placements.ts';
import { loadModel } from './loadedModel.ts';
import { createWorldPoses } from './worldPoses.ts';
import { HOST } from './worldRuntime.fixture.ts';

const MODEL = `${HOST}assets/examples/a-model-from-obj/cache/native/full/manifest.json`;

/** Every graph node of `graph` and below that carries a name. */
function named(graph: Object3D, found: Object3D[] = []) {
  if (graph.name) found.push(graph);
  for (const child of graph.children) named(child, found);
  return found;
}

test('every named node of a compiled cache is found by name, posed as its graph node', async () => {
  const model = await loadModel(MODEL, { textureSource: 'cache' });
  const graphs = named(model.record.scene.source);
  assert.ok(graphs.length > 10, 'the cache carries its named nodes');
  for (const graph of graphs) {
    const node = model.getObjectByName(graph.name);
    assert.equal(node?.name, graph.name, `${graph.name} is found`);
    assert.deepEqual(node.position.toArray(), [
      graph.position.x,
      graph.position.y,
      graph.position.z,
    ]);
  }
});

test('moving a node of a compiled cache moves its drawn placement, and no other', async () => {
  const model = await loadModel(MODEL, { textureSource: 'cache' });
  const source = model.record.scene.source;
  const [moved, kept] = named(source);
  const placements = hostWorldPlacements(source);
  const pose = (graph: Object3D) => Array.from(placements.of(graph).elements);
  const before = { moved: pose(moved), kept: pose(kept) };
  const scene = new Object3D();
  scene.add(model);
  const node = model.getObjectByName(moved.name)!;
  node.position.x += 3;
  const poses = createWorldPoses();
  poses.moved(node);
  poses.apply(scene, new Map(), new Map(), () => {});
  placements.refresh();
  const after = pose(moved);
  assert.equal(after[12] - before.moved[12], 3, 'the drawn placement took the move');
  assert.deepEqual(
    after.filter((_, index) => index !== 12),
    before.moved.filter((_, index) => index !== 12),
  );
  assert.deepEqual(pose(kept), before.kept, 'a node left alone keeps its placement');
});
