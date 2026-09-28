import test from 'node:test';
import assert from 'node:assert/strict';
import { OP, SHAPE } from '../../../sdk-core/src/physics/index.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsPoses } from './poses.ts';
import {
  cooked,
  declared,
  fixture,
  landed,
  modelStreamer,
  place,
  stubFetch,
  streamedModel,
  tile,
} from './tiles.fixture.ts';
import { poseRecord } from './worker.fixture.ts';

const ramp = async () => new Uint8Array(await fixture('ramp-tile.bin'));
const box = { type: 'box', box: { size: [1, 1, 1] } };
const close = (a: ArrayLike<number>, b: number[]) => b.every((v, i) => Math.abs(a[i] - v) < 1e-5);
/** The pose command (TELEPORT or MOVE_KINEMATIC, 9 words) at word `at` of `words`: its op, slot
 *  and place. */
const pose = (words: Uint32Array, at = 0) => [
  ...[words[at], words[at + 1]],
  ...new Float32Array(words.buffer, words.byteOffset + (at + 2) * 4, 3),
];

test('a kinematic body inside a dynamic body’s subtree follows its moving parent, not its model', async () => {
  const crate = declared(0, [0, 2, 0], { mass: 5 }, box);
  const lid = declared(2, [1, 2, 0], { isKinematic: true }, box);
  const collider = { tiles: [tile()], material: null };
  const file = { ...cooked([collider], [place(0)]), bodies: [crate, lid] };
  stubFetch(file, await ramp());
  const { tiles, scene, model, writer, bodies, errors } = modelStreamer({}, 1, [crate]);
  const [top] = model.children;
  const inner = new Object3D();
  inner.position.set(1, 0, 0);
  top.add(inner);
  model.updateMatrixWorld(true);
  model._nodeAt = (i: number) =>
    i === 0
      ? { node: top, indices: [0, 2], radius: 1 }
      : i === 2
        ? { node: inner, indices: [2], radius: 1 }
        : null;
  tiles.scan(scene);
  await landed();
  tiles.update([0, 0, 0], 1000);
  await landed();
  const words = writer.take();
  assert.deepEqual(errors, []);
  const id = words[1];
  assert.equal(bodies.count.bodies, 2, 'the crate and its lid, node 0’s tile left out');
  // The crate's tick: its node drawn a metre lower and turned a quarter about y.
  const poses = createPhysicsPoses(8, scene);
  const posed = { ...bodies, retire() {} };
  const half = Math.SQRT1_2;
  poses.receive(poseRecord(id, [0, 1, 0, 0, half, 0, half]), 1, posed, 0);
  poses.apply(posed);
  tiles.update([0, 0, 0], 1000);
  const [op, slot, ...at] = pose(writer.take());
  assert.deepEqual([op, slot], [OP.moveKinematic, 1], 'the lid driven, pushing what it meets');
  assert.ok(close(at, [0, 1, -1]), `where the turned crate carries it: ${at}`);
  tiles.update([0, 0, 0], 1000);
  assert.equal(writer.take().length, 0, 'a lid standing still sends nothing');
  // Its model moved by the page: the lid goes where its node is drawn, not where the model puts it.
  model.position.set(3, 0, 0);
  model.updateMatrixWorld(true);
  tiles.moved(model);
  const moved = writer.take();
  const [crateOp, , ...crateAt] = pose(moved);
  const [lidOp, , ...lidAt] = pose(moved, 9);
  assert.deepEqual([crateOp, lidOp], [OP.teleport, OP.moveKinematic]);
  assert.ok(close(crateAt, [3, 1, 0]) && close(lidAt, [3, 1, -1]), `${crateAt} / ${lidAt}`);
});

test('a declared body a rescale refused is made again once its model is back at a scale it takes', async () => {
  const ball = declared(0, [0, 1, 0], { isKinematic: true }, { type: 'sphere' });
  const file = { ...cooked([], []), bodies: [ball] };
  const { tiles, model, writer, bodies, errors } = await streamedModel(file, await ramp());
  assert.equal(writer.take()[0], OP.add, 'made at its cooked scale');
  model.scale.set(2, 1, 1);
  model.updateMatrixWorld(true);
  tiles.moved(model);
  assert.deepEqual([...writer.take()], [OP.remove, 0], 'stretched, the sphere leaves');
  assert.deepEqual(
    errors.map((e) => e.code),
    ['PHYSICS_FAILED'],
    'refused by name',
  );
  assert.equal(bodies.count.bodies, 0);
  tiles.moved(model);
  assert.deepEqual(
    [writer.take().length, errors.length],
    [0, 1],
    'the same scale: not tried again',
  );
  model.scale.set(3, 3, 3);
  model.updateMatrixWorld(true);
  tiles.moved(model);
  const words = writer.take();
  assert.deepEqual([words[0], words[4]], [OP.add, SHAPE.sphere], 'back at a scale it takes: made');
  assert.deepEqual([errors.length, bodies.count.bodies], [1, 1]);
  tiles.moved(model);
  assert.equal(writer.take()[0], OP.moveKinematic, 'held once, never made twice');
});

test('a body whose collider is another node’s mesh leaves that node’s tile out too', async () => {
  const collider = { tiles: [tile()], material: null };
  const hull = { type: 'cooked', url: 'hull.bin', sha256: 'h'.repeat(64), bytes: 1 };
  const three = [place(0), place(1), place(2)];
  const body = declared(0, [0, 0, 0], { isKinematic: true }, hull, { colliderNode: 1 });
  const file = { ...cooked([collider, collider, collider], three), bodies: [body] };
  const { tiles, writer, bodies, errors } = await streamedModel(file, await ramp());
  tiles.update([0, 0, 0], 1000);
  await landed();
  assert.deepEqual(errors, []);
  assert.equal(bodies.count.bodies, 2, 'the body and node 2’s tile: node 1’s ground is the body’s');
  const older = { ...file, bodies: [{ ...body, colliderNode: undefined }] };
  const before = await streamedModel(older, await ramp());
  before.tiles.update([0, 0, 0], 1000);
  await landed();
  assert.equal(before.bodies.count.bodies, 3, 'a file cooked before it keeps node 1’s tile');
});
