import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION, OP, type CookedBody } from '../../../sdk-core/src/physics/index.ts';
import { createPhysicsPoses } from './poses.ts';
import { moversOf } from './tilePlace.ts';
import { cooked, landed, place, streamedModel, tile } from './tiles.fixture.ts';
import { poseRecord } from './worker.fixture.ts';

/** Node 0's dynamic crate, two metres up, and node 1 kinematic, each placed by its own tile. */
const crate = {
  ...{ node: 0, motion: { mass: 5 }, shape: { type: 'box', box: { size: [1, 1, 1] } } },
  ...{ position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
} as CookedBody;
const lift = { ...crate, node: 1, motion: { isKinematic: true }, position: [10, 0, 0] };
const collider = { tiles: [tile()], material: null };
const file = { ...cooked([collider, collider], [place(0), place(1)]), bodies: [crate, lift] };
const close = (a: ArrayLike<number>, b: number[]) => b.every((v, i) => Math.abs(a[i] - v) < 1e-6);

test('a declared dynamic body simulates, and its compiled node is drawn where it is simulated', async () => {
  const streamed = await streamedModel(file, new Uint8Array(4), {}, 1, [crate, lift]);
  const { tiles, scene, model, writer, bodies, errors } = streamed;
  const [node, still] = model.children;
  tiles.update([0, 0, 0], 1000);
  await landed();
  const words = writer.take();
  assert.deepEqual(errors, []);
  assert.deepEqual([words[0], words[2], words[5]], [OP.add, MOTION.dynamic, 0], 'dynamic, awake');
  assert.equal(bodies.count.bodies, 2, 'the two bodies, neither node’s tile doubling them');
  const id = words[1];
  // Its model moved: the body is put where its node is now drawn.
  model.position.set(1, 0, 0);
  model.updateMatrixWorld(true);
  tiles.moved(model);
  const moved = writer.take();
  assert.deepEqual([moved[0], ...new Float32Array(moved.buffer, 8, 3)], [OP.teleport, 1, 2, 0]);
  // A tick: its node is drawn at the simulated pose, local to its model; the other one stays.
  const poses = createPhysicsPoses(8, scene);
  const posed = { ...bodies, retire() {} };
  const half = Math.SQRT1_2;
  poses.receive(poseRecord(id, [1, 0.5, 0, 0, half, 0, half]), 1, posed, 0);
  poses.apply(posed);
  assert.ok(close(node.position.elements, [0, 0.5, 0]), `${node.position.toArray()}`);
  assert.ok(close(node.quaternion.elements, [0, half, 0, half]), 'turned as simulated');
  assert.ok(close(node.scale.elements, [1, 1, 1]), 'its scale kept');
  node.updateWorldMatrix(true, false);
  assert.ok(close(node.matrixWorld.elements.slice(12), [1, 0.5, 0]), 'drawn where simulated');
  assert.ok(close(still.position.elements, [10, 0, 0]), 'the kinematic node left alone');
  // It wants ground around it as any mover: its radius, at its drawn place.
  const movers = moversOf(bodies.meshes, bodies.slots.nested, bodies.state.velocity);
  assert.deepEqual(movers, [1, 0.5, 0, 1]);
});

test('a model with no dynamic body moves no node and wants no ground for one', async () => {
  const alone = { ...file, bodies: [lift] };
  const { tiles, bodies, writer } = await streamedModel(alone, new Uint8Array(4), {}, 1, [lift]);
  tiles.update([0, 0, 0], 1000);
  await landed();
  const words = writer.take();
  assert.deepEqual([words[0], words[2]], [OP.add, MOTION.kinematic]);
  assert.deepEqual(bodies.slots.nested.filter(Boolean), [], 'no node moved by the physics');
  assert.deepEqual(moversOf(bodies.meshes, bodies.slots.nested, bodies.state.velocity), []);
});
