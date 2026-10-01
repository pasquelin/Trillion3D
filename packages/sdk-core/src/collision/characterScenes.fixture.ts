import { block } from './character.fixture.ts';
import { meshCollision } from './meshTriangles.ts';
import type { CharacterCollision } from './characterCollision.ts';

/** One scene of `zUniformScenes`: its world and whether the walker sprints. */
export interface WalkScene {
  index: number;
  world: CharacterCollision;
  sprint: boolean;
}

/**
 * Seeded scenes a walker crosses eastward from the origin: a floor and one to three blocks —
 * ledges, overhead beams, slabs tilted about z — each running the same 6 m along z, so nothing in
 * the scene can send a walker sideways. A scene whose blocks already overlap the standing body
 * is skipped. The Park–Miller generator makes every seed the same scenes on every machine.
 */
export function* zUniformScenes(seed: number, count: number, radius: number, height: number) {
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  for (let index = 0; index < count; index++) {
    const blocks = [block(-20, -1, -20, 20, 0, 20)];
    for (let n = 1 + Math.floor(random() * 3); n > 0; n--) {
      const x = 0.5 + random() * 3,
        y = random() < 0.5 ? 0 : random() * 2,
        width = 0.1 + random() * 2,
        tall = 0.05 + random() * 0.8,
        tilt = random() < 0.5 ? 0 : (random() - 0.5) * 2.5;
      const made = block(x, y, -3, x + width, y + tall, 3);
      made.rotation.z = tilt;
      blocks.push(made);
    }
    const world = meshCollision(blocks);
    const sprint = random() < 0.5;
    if (deepest(world, new Float64Array(3), radius, height) > 1e-6) continue;
    yield { index, world, sprint } satisfies WalkScene;
  }
}

/** The deepest overlap of a capsule standing on `feet` in `world`, metres. */
export function deepest(
  world: CharacterCollision,
  feet: Float64Array,
  radius: number,
  height: number,
) {
  let depth = 0;
  world.resolveCapsule({ feet: Float64Array.from(feet), radius, height }, (touch) => {
    depth = Math.max(depth, touch.depth);
  });
  return depth;
}
