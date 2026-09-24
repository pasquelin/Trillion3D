import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CAST,
  CAST_WORDS,
  CommandWriter,
  DEFAULT_PHYSICS_BUDGET,
  HIT_WORDS,
  JOLT_COMMIT,
  SHAPE,
  type PhysicsHost,
} from '../../../sdk-core/src/physics/index.ts';
import { Group, Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { Ray } from '../../../sdk-core/src/world/math/volumes.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { createPhysicsBodies } from './bodies.ts';
import { body, startModule } from './module.fixture.ts';
import { createPhysicsPoses } from './poses.ts';
import { physicsRaycast } from './raycast.ts';
import type { PhysicsSession } from './session.ts';
import { createTileStreamer } from './tiles.ts';

/** The golden tile the compiler's cook writes (`physics_cook/tests.rs`): a 2 × 2 m quad rising
 *  from (0, 0) to (2, 1) along x, in native Jolt's binary state. */
const golden = () =>
  readFile(new URL('../../../../tests/fixtures/physics/ramp-tile.bin', import.meta.url));

/** A ray down at `x` through the module, straight: its hit words. */
function castDown(jolt: Awaited<ReturnType<typeof startModule>>, x: number) {
  const query = new Uint32Array(CAST_WORDS);
  query[0] = CAST.ray;
  new Float32Array(query.buffer).set([x, 5, 0, 0, -10, 0], 1);
  return jolt.cast(query);
}

test('a tile cooked by native Jolt is restored in the module, collides, and answers a ray exactly', async () => {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.restore(0, new Uint8Array(await golden()));
  writer.add({ ...body(0, 0, 0, 1), shape: SHAPE.cooked, size: [1, 1, 1], indices: [0] });
  writer.release(0);
  writer.add({ ...body(1, 2, 3, 0.25), position: [1, 3, 0.7] });
  jolt.step(writer.take(), 0);
  const hit = castDown(jolt, 1);
  const f = new Float32Array(hit.buffer);
  assert.equal(hit[0], 0, 'the ramp is hit');
  // The ramp's height at x = 1 is 0.5: the exact triangle, not a box around it.
  assert.ok(Math.abs(f[3] - 0.5) < 1e-4, `hit at y = ${f[3]}`);
  assert.equal(hit[8], 0, 'its cooked material');
  assert.ok(f[5] < 0 && f[6] > 0.8, 'the normal leans back along the slope');
  for (let s = 0; s < 30; s++) jolt.step(null, 1 / 60);
  assert.equal(castDown(jolt, 3)[0], 0xffffffff, 'past the ramp, nothing');
});

test('tiles past budget.physics.triangles are refused by name, the nearest loaded', async () => {
  const bytes = await golden();
  const tile = (x: number) => ({
    url: `t${x}.bin`,
    sha256: 'a'.repeat(64),
    bytes: bytes.length,
    triangles: 2,
    bounds: [x, 0, -1, x + 2, 1, 1],
  });
  const file = {
    formatVersion: 1,
    jolt: JOLT_COMMIT,
    colliders: [{ kind: 'mesh', tiles: [tile(0), tile(10), tile(20)] }],
    instances: [
      { node: 0, collider: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
  };
  const fetched: string[] = [];
  globalThis.fetch = (async (url: string) => {
    fetched.push(url.split('/').pop()!);
    const json = url.endsWith('physics.json');
    return new Response(json ? JSON.stringify(file) : new Uint8Array(bytes));
  }) as typeof fetch;
  const budget = { ...DEFAULT_PHYSICS_BUDGET, bodies: 8, triangles: 4 };
  const scene = new Group();
  const writer = new CommandWriter();
  const { state } = createPhysicsPoses(budget.bodies, scene);
  const bodies = createPhysicsBodies(writer, budget, {} as PhysicsHost, scene, state);
  const errors: { code: string }[] = [];
  const tiles = createTileStreamer(
    writer,
    budget,
    bodies,
    () => {},
    (e) => errors.push(e),
  );
  const model = Object.assign(new Object3D(), {
    isLoadedModel: true as const,
    record: { base: 'https://cache.test/model/' },
  });
  scene.add(model);
  tiles.scan(scene);
  await new Promise((resolve) => setTimeout(resolve, 10));
  tiles.update([0, 0, 0], 1000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(
    errors.map((e) => e.code),
    ['PHYSICS_BUDGET'],
  );
  assert.deepEqual(fetched.slice(1).sort(), ['t0.bin', 't10.bin'], 'the two nearest');
  assert.equal(bodies.count.triangles, 4);
  const hit = new Uint32Array(HIT_WORDS);
  new Float32Array(hit.buffer).set([0.25, 1, 0.5, 0, 0, 1, 0], 1);
  hit[0] = 0;
  const session = { cast: async () => hit, objectOf: tiles.modelOf } as unknown as PhysicsSession;
  const ray = new Ray(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
  const found = await physicsRaycast(session, ray, { exact: true }, 8);
  assert.equal(found?.object, model, 'a tile hit names its model');
  assert.equal(found?.distance, 2);
  await assert.rejects(physicsRaycast(null, ray, { exact: true }, 8), { code: 'PHYSICS_OFF' });
});
