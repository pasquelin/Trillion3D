import type { PhysicsStats } from '../../../packages/sdk-browser/src/index.ts';
import { readout } from './readout.ts';
import { ms } from './statsLines.ts';

/** The physics lines a page may show, by readout key: what each prints of `world.physics.stats`
 *  — the bodies held, those awake, the worker's step and the page's share of the frame. */
export const PHYSICS_LINES = {
  bodies: ({ bodies }: PhysicsStats) => String(bodies),
  awake: ({ active }: PhysicsStats) => String(active),
  step: ({ stepMs }: PhysicsStats) => ms(stepMs),
  page: ({ mainMs }: PhysicsStats) => ms(mainMs),
};

/** A line of `PHYSICS_LINES`. */
export type PhysicsLine = keyof typeof PHYSICS_LINES;

/**
 * The physics readouts of an example: one `readout` per line of `lines`, in that order, written
 * each frame the world draws from `world.physics.stats`. Declared after `controls`, like any
 * readout.
 */
export function physicsReadouts(
  world: { onFrame(hook: () => void): unknown; physics: { stats: PhysicsStats } },
  lines: readonly PhysicsLine[],
) {
  const shown = lines.map((line) => [readout(line), PHYSICS_LINES[line]] as const);
  world.onFrame(() => {
    const { stats } = world.physics;
    for (const [write, read] of shown) write(read(stats));
  });
}
