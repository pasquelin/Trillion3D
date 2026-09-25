import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PHYSICS_BUDGET,
  GENERATION_SHIFT,
  JOLT_COMMIT,
} from '../../../sdk-core/src/physics/index.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Group, Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { PhysicsResults } from './protocol.ts';
import { createPhysicsSession } from './session.ts';
import { landed, streamedModel } from './tiles.fixture.ts';
import { fakeWorkers } from './worker.fixture.ts';

/** A `physics.json` of one two-triangle tile at the origin, placed once, and `softBodies`. */
const cooked = (softBodies: object[] = []) => ({
  formatVersion: 2,
  jolt: JOLT_COMMIT,
  colliders: [
    {
      kind: 'mesh',
      tiles: [
        {
          url: 't.bin',
          sha256: 'a'.repeat(64),
          bytes: 1,
          triangles: 2,
          bounds: [0, 0, 0, 2, 1, 1],
        },
      ],
    },
  ],
  instances: [
    { node: 0, collider: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  ],
  softBodies,
});

/** Holds every fetch from now on; `answer(name)` lets the first one waiting for `name` through,
 *  if any, and waits for what it lands. */
function heldFetches() {
  const fetchNow = globalThis.fetch,
    waiting: [string, () => void][] = [];
  globalThis.fetch = ((url: string) =>
    new Promise((go) => waiting.push([url, () => go(fetchNow(url))]))) as typeof fetch;
  return async (name: string) => {
    const at = waiting.findIndex(([url]) => url.endsWith(name));
    if (at >= 0) waiting.splice(at, 1)[0][1]();
    await landed();
  };
}

test('a model back while its physics.json or a tile is on its way holds one set of tile bodies', async () => {
  const { tiles, scene, model, bodies } = await streamedModel(cooked(), new Uint8Array(1));
  const answer = heldFetches();
  const near = () => tiles.update([0, 0, 0], 1000);
  const back = () => {
    scene.remove(model);
    tiles.scan(scene);
    scene.add(model);
    tiles.scan(scene);
  };
  const held = () => [bodies.count.bodies, bodies.count.triangles];
  // Two openings on their way; the earlier lands first, and its tile would load before the later.
  back();
  back();
  await answer('physics.json');
  near();
  await answer('t.bin');
  await answer('physics.json');
  near();
  await answer('t.bin');
  assert.deepEqual(held(), [1, 2], 'the later opening’s tile alone');
  // A tile on its way while its model leaves and comes back, landing after the new opening.
  back();
  await answer('physics.json');
  near();
  back();
  await answer('physics.json');
  await answer('t.bin');
  near();
  await answer('t.bin');
  assert.deepEqual(held(), [1, 2], 'the new opening’s tile alone');
});

/** A tick that moves nothing. */
const tick: PhysicsResults = {
  ...{ type: 'results', buffer: new ArrayBuffer(0), poses: 0, events: 0, dropped: 0, steps: 0 },
  ...{ seconds: 0, water: 0, waterEpoch: 0, stepMs: 0, stepMaxMs: 0, active: 0 },
  ...{ character: null, vehicles: null, soft: null },
};

test('a cooked soft body and a tile the worker refuses give their slots and budget back', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const cloth = {
      ...{ node: 1, position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      ...{ physics: { type: 'cloth', pins: [0] }, vertices: 9, pressure: 0 },
      ...{
        friction: 0.5,
        restitution: 0,
        settings: { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 1 },
      },
    };
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string) => {
      fetched.push(url.split('/').pop()!);
      return {
        ok: true,
        json: async () => cooked([cloth]),
        arrayBuffer: async () => new ArrayBuffer(1),
      };
    }) as unknown as typeof fetch;
    const scene = new Group();
    const model = Object.assign(new Object3D(), {
      isLoadedModel: true as const,
      record: { base: 'https://cache.test/model/' },
    });
    scene.add(model);
    const wanted = { joints: new Set<never>(), vehicles: new Set<never>() };
    const session = createPhysicsSession(
      scene,
      DEFAULT_PHYSICS_BUDGET,
      () => {},
      () => {},
      wanted,
    );
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    const camera = new Camera('perspective');
    session.frame(camera);
    await landed(); // opened: its cloth made in the first slot
    session.frame(camera);
    await landed(); // its tile loaded in the second
    const [soft, tile] = [0, 1].map((index) => index | (1 << GENERATION_SHIFT));
    assert.deepEqual([session.objectOf(soft), session.objectOf(tile)], [model, model]);
    const refusal = { type: 'error', code: 'PHYSICS_FAILED', message: '', fatal: false };
    worker.onmessage({ data: { ...refusal, bodies: [soft, tile] } });
    worker.onmessage({ data: tick });
    assert.equal(session.stats.bodies, 0, 'both slots given back, their budget with them');
    assert.deepEqual([session.objectOf(soft), session.objectOf(tile)], [null, null]);
    session.frame(camera);
    await landed();
    assert.deepEqual(fetched.sort(), ['cloth.bin', 'physics.json', 't.bin'], 'not made again');
    session.dispose();
  } finally {
    restore();
  }
});
