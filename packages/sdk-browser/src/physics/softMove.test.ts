import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_INDEX, CommandWriter, FLAG, OP } from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { CLOTH, flatCloth, softWorld } from './soft.fixture.ts';
import { fakePhysicsWorld, idleTick } from './worker.fixture.ts';

// #740: a page-built soft body the page moves is carried there as a cooked one is (#723), its
// simulation kept; placed at another scale, it is refused by name and made again once back at it,
// as a cooked one is.
test('a page-built cloth moved is teleported with its flags; rescaled, refused by name until back', async () => {
  const { scene, physics, worker, restore } = await fakePhysicsWorld();
  try {
    const cloth = new Mesh(plane(1, 1, 2, 2), new Material('meshStandard'));
    cloth.name = 'flag';
    cloth.physics = { type: 'cloth' };
    scene.add(cloth);
    physics.frame();
    const index = cloth.physics!._index;
    cloth.position.set(3, 2, 1);
    cloth.visible = false;
    physics.frame();
    // Moved, then hidden: TELEPORT is 9 words, FLAGS 3, one of each per write, no REMOVE or SOFT.
    const moved = worker.words.at(-1)!;
    assert.equal(moved.length, 2 * 12);
    for (let at = 0; at < moved.length; at += 12)
      assert.deepEqual(
        [moved[at], moved[at + 1], moved[at + 9], moved[at + 10]],
        [OP.teleport, index, OP.flags, index],
      );
    assert.deepEqual([...new Float32Array(moved.buffer, 8, 3)], [3, 2, 1], 'where the page put it');
    assert.equal(moved.at(-1), FLAG.hidden, 'hidden: its vertices stay in the worker');
    cloth.scale.setScalar(2);
    physics.frame();
    assert.equal(physics.handle.error?.code, 'PHYSICS_FAILED');
    assert.deepEqual(
      [...worker.words.at(-1)!],
      [OP.remove, index],
      'out, not made at the new scale',
    );
    assert.equal(physics.session()!.engineIdOf(cloth), -1);
    cloth.scale.setScalar(1);
    physics.frame();
    assert.equal(worker.words.at(-1)![0], OP.soft, 'back at its scale, made again');
    assert.notEqual(physics.session()!.engineIdOf(cloth), -1);
    physics.dispose();
  } finally {
    restore();
  }
});

// #573: a soft body drawn where it is, into its geometry, is no new shape: made again from it, it
// would lose its velocity every tick.
test('a soft body drawn where it is keeps its body: nothing removed nor made again', async () => {
  const { scene, physics, worker, restore } = await fakePhysicsWorld();
  try {
    const cloth = new Mesh(plane(1, 1, 2, 2), new Material('meshStandard'));
    cloth.physics = { type: 'cloth' };
    scene.add(cloth);
    physics.frame();
    const [version, sent] = [cloth.geometry.version, worker.words.length];
    const soft = new Uint32Array(2 + 9 * 3);
    soft.set([physics.session()!.engineIdOf(cloth), 9]);
    new Float32Array(soft.buffer).fill(0.5, 2);
    worker.onmessage({ data: { ...idleTick, soft } });
    physics.frame();
    assert.equal(cloth.geometry.usage, 'dynamic', 'never cut into pages again');
    assert.equal(cloth.geometry.version, version + 2, 'its positions and normals written');
    assert.deepEqual(new Set(cloth.geometry.attributes.position.array), new Set([0.5]));
    const made = worker.words.slice(sent).filter((w) => w[0] === OP.remove || w[0] === OP.soft);
    assert.deepEqual(made, [], 'no REMOVE, no SOFT');
    physics.dispose();
  } finally {
    restore();
  }
});

test('a hidden soft body streams no vertex, falling or at rest; shown again, it streams them', async () => {
  const jolt = await softWorld();
  flatCloth(jolt, 0.5, []);
  const writer = new CommandWriter();
  const flag = (flags: number) => {
    writer.flags(CLOTH & BODY_INDEX, flags);
    return writer.take();
  };
  jolt.step(flag(FLAG.hidden), 1 / 60);
  assert.equal(jolt.soft().length, 0, 'hidden, falling, and no vertex sent');
  for (let s = 0; s < 600 && jolt.soft().length === 0; s++) jolt.step(null, 1 / 60);
  assert.equal(jolt.soft().length, 0, 'ten seconds hidden, come to rest, nothing sent');
  jolt.step(flag(0), 1 / 60);
  assert.equal(jolt.soft()[0], CLOTH, 'shown, its vertices are sent');
});
