import type { MeasuredWorld } from '../session/explorer.ts';
import type { FrameMetrics, JobProgress } from '../../../../sdk-core/src/index.ts';
import type { ParticlePool } from '../../../../sdk-core/src/fluids/particles.ts';
import type { World } from './world.ts';
export type { JobProgress };

/** What the families that read a world's engine reach it by, without the page holding it. */
type Access = { session: () => MeasuredWorld | null; last: () => FrameMetrics | null };
const worlds = new WeakMap<object, Access & { particles: ParticlePool[] }>();

/** `held.particles`: the pools the world gives every session it opens (`worldSwitches.ts`). */
export const registerWorld = (
  world: object,
  access: Access,
  held: { particles: ParticlePool[] },
) => {
  worlds.set(world, { ...access, particles: held.particles });
};

/** The session drawing `world` now; a world that draws nothing yet is refused by name. */
export function sessionOf(world: object): MeasuredWorld {
  const session = worlds.get(world)?.session();
  if (!session)
    throw new Error('This world draws nothing yet: add an object or load a model first');
  return session;
}

/** Steps `pool` on the GPU at every frame `world` draws, its time advanced by the world's loop:
 *  the measurement entry's way in (#420) until particles have a public face (#423). Returns the
 *  remover. */
export function attachParticles(world: World, pool: ParticlePool) {
  const pools = worlds.get(world)!.particles;
  pools.push(pool);
  const stop = world.beforeFrame(({ delta }) => pool.advance(delta));
  world.invalidate();
  return () => {
    stop();
    pools.splice(pools.indexOf(pool), 1);
  };
}

/** The metrics of the last frame `world` drew, null before its first. */
export const lastFrameOf = (world: object) => worlds.get(world)?.last() ?? null;

/**
 * `world.awaitPages`: resolves once the pages the current view reads are resident. It takes no
 * picture (`image: false`): a world whose loop redraws every frame — a large world streaming, an
 * animated scene — never holds an image still long enough to read one back, and a wait that asked
 * for it never settled (#408). A capture reads its own image (`capture.buffer`). `onProgress`
 * hears `pages` as each one it lacked lands.
 */
export async function awaitViewPages(
  runtime: { settled(): Promise<void> },
  session: () => MeasuredWorld | null,
  onProgress?: (event: JobProgress) => void,
) {
  await runtime.settled();
  await session()?.awaitPages({ image: false, onProgress });
}
