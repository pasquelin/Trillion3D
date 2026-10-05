import type { JoltModule } from './joltModule.ts';

/** A module whose steps give `poses` and `events`, leave `diverged` non-finite and bring
 *  `recovered` soft bodies back to a good state (engine ids), and report nothing else. */
export const tickModule = (
  poses: () => Uint32Array,
  events: () => Uint32Array,
  diverged: number[] = [],
  recovered: number[] = [],
) =>
  ({
    poses,
    events,
    dropped: () => 0,
    refused: () => [],
    diverged: () => diverged,
    recovered: () => recovered,
    broken: () => [],
    overflow: () => [],
    vehicles: () => new Uint32Array(0),
    soft: () => new Uint32Array(0),
    character: () => new Float32Array(1),
  }) as unknown as JoltModule;
