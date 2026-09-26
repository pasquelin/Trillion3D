import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_INDEX, CommandWriter, FLAG, OP } from '../../../sdk-core/src/physics/index.ts';
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { CLOTH, flatCloth, softWorld } from './soft.fixture.ts';
import { fakeWorkers, loaded } from './worker.fixture.ts';
import { createWorldPhysics } from './worldPhysics.ts';

// #740: a page-built soft body the page moves is carried there as a cooked one is (#723), its
// simulation kept; placed at another scale, it is refused by name, as a cooked one is.
test('a page-built cloth moved is teleported with its flags, never made again; rescaled, refused by name', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const cloth = new Mesh(plane(1, 1, 2, 2), new Material('meshStandard'));
    cloth.name = 'flag';
    cloth.physics = { type: 'cloth' };
    scene.add(cloth);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    const index = cloth.physics._index;
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
    assert.deepEqual([...worker.words.at(-1)!], [OP.remove, index], 'out, not made at the new scale');
    assert.equal(physics.session()!.engineIdOf(cloth), -1);
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
