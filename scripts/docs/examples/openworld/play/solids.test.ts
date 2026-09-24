import assert from 'node:assert/strict';
import test from 'node:test';
import initJolt from 'jolt-physics/wasm';
import type { ColliderInstance } from '../../../../../site/examples/kit/openworld/play/collision.ts';
import { idleInputs, STEP } from '../../../../../site/examples/kit/openworld/play/protocol.ts';
import { createSim, step } from '../../../../../site/examples/kit/openworld/play/sim/core.ts';
import {
  playerPosition,
  teleport,
} from '../../../../../site/examples/kit/openworld/play/sim/player.ts';
import { SQUARE_CENTRE } from '../regions/countryside/church.ts';
import { fixtureWorld, LIMITS, slope, solidSource, tileHeights } from './fixture.ts';

const J = await initJolt();

/** A church square in the start's tile, its church 45 m to the spire's tip. */
const SQUARE: ColliderInstance = {
  prop: 'countryside/church-square',
  position: [500, slope(500, -500), -500],
  yaw: 0,
  scale: [1, 1, 1],
};

function world(tiles: Record<string, readonly ColliderInstance[]>) {
  const base = fixtureWorld(),
    [x, , z] = [SQUARE.position[0] + 8, 0, SQUARE.position[2] + SQUARE_CENTRE[2]],
    source = solidSource(tiles),
    fetched: string[] = [];
  const data = {
    ...base,
    markers: [
      ...base.markers,
      { kind: 'teleport', name: 'square', position: [x, slope(x, z) + 3, z], yaw: 0 } as const,
    ],
  };
  const sim = createSim(J, data, LIMITS, {
    heights: async (tx, tz) => tileHeights(tx, tz),
    colliders: { tile: source.tile, mesh: (id) => (fetched.push(id), source.mesh(id)) },
  });
  return { sim, fetched };
}

async function run(sim: ReturnType<typeof world>['sim'], seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    step(sim, idleInputs(), STEP);
    if (i % 4 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
}

test('a walker put on the church square stands on its cobbles, not on a box to the spire', async () => {
  const { sim } = world({ '4_3': [SQUARE] });
  await run(sim, 1);
  teleport(sim, 'square');
  await run(sim, 2);
  const [, y] = playerPosition(sim),
    floor = SQUARE.position[1] + SQUARE_CENTRE[1];
  assert.ok(Math.abs(y - floor) < 0.1, `feet at ${y.toFixed(2)}, the square at ${floor}`);
});

test("a prop placed in many tiles is fetched and built once, and the tiles' bodies share it", async () => {
  const block = (x: number, z: number): ColliderInstance => ({
    prop: 'block',
    position: [x, slope(x, z), z],
    yaw: 0.3,
    scale: [2, 1, 2],
  });
  const { sim, fetched } = world({
    '4_3': [block(60, -20), block(70, -20)],
    '4_4': [block(60, 20)],
    '3_4': [block(-60, 20)],
  });
  await run(sim, 2);
  assert.deepEqual(fetched, ['block']);
  assert.equal(sim.ground.solids.shapes.size, 1);
  assert.ok(sim.ground.solids.shapes.get('block')!.GetRefCount() >= 4);
});
