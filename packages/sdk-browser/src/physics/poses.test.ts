import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASLEEP_BIT,
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  ObjectPhysics,
  POSE_WORDS,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createPhysicsBodies, type Bodied } from './bodies.ts';
import { createPhysicsPoses } from './poses.ts';

test('a pose sent again unchanged moves nothing and asks for no frame', () => {
  const poses = createPhysicsPoses(4, new Group());
  const crate = new Mesh(box()) as Bodied;
  crate.physics = new ObjectPhysics('dynamic');
  const words = new Uint32Array(POSE_WORDS);
  new Float32Array(words.buffer).set([0, 2, 0, 0, 0, 0, 1], 1);
  assert.equal(
    poses.receive(words, 1, [crate], 0, () => {}),
    1,
  );
  assert.equal(poses.apply([crate]), false);
  assert.equal(crate.position.y, 2);
  assert.equal(
    poses.receive(words, 1, [crate], 0, () => {}),
    0,
  );
  assert.equal(poses.apply([crate]), false);
});

test('a pose drawn by the batch leaves position, quaternion and angles coherent', () => {
  const poses = createPhysicsPoses(4, new Group());
  const crate = new Mesh(box()) as Bodied;
  crate.physics = new ObjectPhysics('dynamic');
  const words = new Uint32Array(POSE_WORDS);
  const half = Math.SQRT1_2;
  new Float32Array(words.buffer).set([1, 2, 3, 0, half, 0, half], 1);
  poses.receive(words, 1, [crate], 0, () => {});
  poses.apply([crate]);
  assert.deepEqual([crate.position.x, crate.position.y, crate.position.z], [1, 2, 3]);
  assert.ok(
    Math.abs(crate.rotation.y - Math.PI / 2) < 1e-3,
    `turned a quarter, ${crate.rotation.y}`,
  );
  crate.updateWorldMatrix(true, false);
  assert.ok(Math.abs(crate.matrixWorld.elements[13] - 2) < 1e-6, 'the tree holds the pose');
});

test('a seated body is drawn straight into its row, the world told the span once', () => {
  const scene = new Group();
  const crate = new Mesh(box()) as Bodied;
  crate.physics = new ObjectPhysics('dynamic');
  crate.scale.set(2, 2, 2);
  scene.add(crate);
  const batch = { rows: { matrices: new Float64Array(64) } };
  const told: unknown[] = [];
  scene._link = {
    pose() {},
    posed: (nodes) => told.push(['posed', nodes.length]),
    structure() {},
    content() {},
    seat: () => ({ batch, row: 2 }),
    seatEpoch: () => 0,
    placed: (at, from, to) => told.push([at === batch, from, to]),
  };
  crate._link = scene._link;
  const poses = createPhysicsPoses(4, scene);
  const words = new Uint32Array(POSE_WORDS);
  new Float32Array(words.buffer).set([1, 2, 3, 0, 0, 0, 1], 1);
  poses.receive(words, 1, [crate], 0, () => {});
  told.length = 0;
  poses.apply([crate]);
  assert.deepEqual(told, [[true, 2, 2]]);
  crate.updateWorldMatrix(true, false);
  assert.deepEqual(batch.rows.matrices.subarray(32, 48), crate.matrixWorld.elements);
});

test('a decorative body asleep is placed, taken out, and never added again', () => {
  const scene = new Group();
  const bodies = createPhysicsBodies(
    new CommandWriter(),
    DEFAULT_PHYSICS_BUDGET,
    {} as PhysicsHost,
    scene,
  );
  const mesh = new Mesh(box(), new Material('meshStandard'));
  mesh.physics = { decorative: true };
  const chip = mesh as Bodied;
  scene.add(chip);
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)));
  const poses = createPhysicsPoses(4, scene);
  const words = new Uint32Array(POSE_WORDS);
  words[0] = chip.physics._index | ASLEEP_BIT;
  new Float32Array(words.buffer).set([0, 0.5, 0, 0, 0, 0, 1], 1);
  poses.receive(words, 1, bodies.meshes, 16, bodies.retire);
  assert.equal(chip.position.y, 0.5);
  assert.equal(bodies.count.decorative, 0);
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)));
  assert.equal(bodies.count.bodies, 0);
});
