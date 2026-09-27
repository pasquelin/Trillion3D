import type { JoltModule } from './joltModule.ts';

/** A module whose steps give `poses` and `events`, leave `diverged` non-finite (engine ids), and
 *  report nothing else. */
export const tickModule = (
  poses: () => Uint32Array,
  events: () => Uint32Array,
  diverged: number[] = [],
) =>
  ({
    poses,
    events,
    dropped: () => 0,
    refused: () => [],
    diverged: () => diverged,
    broken: () => [],
    overflow: () => [],
    vehicles: () => new Uint32Array(0),
    soft: () => new Uint32Array(0),
  }) as unknown as JoltModule;
