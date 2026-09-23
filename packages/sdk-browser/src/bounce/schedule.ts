import {
  BOUNCE_PROBES_PER_FRAME,
  type BounceCascades,
  type BounceOccupancy,
} from '../../../sdk-core/src/index.ts';

/**
 * Probe scheduler: who works this frame, and how far.
 *
 * The total batch comes from the millisecond budget; this is where it is split among
 * levels, at the published shares — the finest surrounds the camera, it is the one the
 * frame reads most, it receives the most. Each level advances its own cursor in a circle
 * over its probes and counts its rounds: bounce is deemed converged only when the slowest
 * level has finished its own.
 *
 * The cursor **skips cells that do not deserve a probe** — empty sky, the solid heart of a
 * block — which the occupancy map knows before the frame. That is what lets a small room
 * sweep its few dozen useful probes in one frame instead of walking a whole cube, and it
 * is also what gives the requested priority: what surrounds the camera and touches
 * geometry goes before the rest.
 *
 * No per-frame allocation: the queue and the cursors are set once and for all.
 */
export function createBounceSchedule(cascades: BounceCascades, occupancy: BounceOccupancy) {
  const levels = cascades.levels.length;
  const side = cascades.size;
  const cursors = new Uint32Array(levels);
  const rounds = new Uint32Array(levels);
  // The frame ceiling, plus one probe per level: `shareOf` guarantees at least one to each.
  const capacity = BOUNCE_PROBES_PER_FRAME + levels;
  const queue = new Uint32Array(capacity);
  const cell = [0, 0, 0];
  /** True when a level rank holds a cell that deserves a probe. */
  const holds = (level: number, index: number) => {
    const base = cascades.levels[level].base;
    let rank = index;
    for (let axis = 0; axis < 3; axis++) {
      const wrapped = rank % side;
      rank = (rank - wrapped) / side;
      cell[axis] = base[axis] + ((((wrapped - base[axis]) % side) + side) % side);
    }
    return occupancy.occupied(level, cell[0], cell[1], cell[2]);
  };
  /** Frames of the last complete round of each level: measured, never estimated. */
  const roundFrames = new Uint32Array(levels).fill(1);
  const elapsed = new Uint32Array(levels);
  return {
    queue,
    /** Complete rounds of the slowest level since the last invalidation. */
    get sweeps() {
      return Math.min(...rounds);
    },
    /** Frames of a complete round, the longest of the level measurements: the lag bound. */
    get sweepFrames() {
      return Math.max(1, ...roundFrames);
    },
    /**
     * A light has changed, or the cascade has slid: the bounce series is no longer closed and
     * work resumes. The cursors themselves do not rewind — a light that moves every frame
     * would put them back at the start forever, and only the first probes would ever be
     * updated. Refresh is rolling, never blocking.
     */
    restart() {
      rounds.fill(0);
    },
    /**
     * The frame queue: ranks to update, level by level, within the batch. Returns the number
     * of groups to dispatch. Each level examines its own probes at most once: the loop is
     * bounded before the frame, like all the others (X2).
     */
    plan(total: number) {
      const shares = cascades.shareOf(total);
      let groups = 0;
      for (let level = 0; level < levels; level++) {
        let taken = 0;
        elapsed[level]++;
        for (
          let examined = 0;
          examined < cascades.probesPerLevel && taken < shares[level] && groups < capacity;
          examined++
        ) {
          const index = cursors[level];
          cursors[level] = index + 1;
          if (cursors[level] >= cascades.probesPerLevel) {
            cursors[level] = 0;
            rounds[level]++;
            roundFrames[level] = Math.max(1, elapsed[level]);
            elapsed[level] = 0;
          }
          if (!holds(level, index)) continue;
          queue[groups++] = level * cascades.probesPerLevel + index;
          taken++;
        }
      }
      return groups;
    },
  };
}
