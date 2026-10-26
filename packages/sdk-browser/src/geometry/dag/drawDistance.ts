import type { DrawDistance } from '../selection/types.ts'

/**
 * THE DRAW DISTANCE ON THE CPU: the words a column holds it in, one layout for the cell files'
 * decode, the placement rows' column and the packing's (`DRAW_DISTANCE_STRIDE`). The arithmetic of
 * `outsideDrawDistances` (`shader/drawDistanceWgsl.ts`) is the shader's; its twin is `drawDistanceOracle.fixture.ts`.
 */

/** The floats a placement holds in a column of draw distances: the nearest, the farthest, and 1
 *  where the object is one instance of an instanced mesh (`DrawDistance.perInstance`). */
export const DRAW_DISTANCE_STRIDE = 3

/** Whether distances name one: a farthest above 0, or — for an object of its own — a nearest
 *  above 0 alone; an instance's nearest alone is none. */
const namesDrawDistance = (min: number, max: number, perInstance: boolean) =>
  max > 0 || (!perInstance && min > 0)

/** The distances placement `index` of a `column` holds, none when it names none or no placement
 *  does (`column` undefined). */
export function drawDistanceAt(
  column: ArrayLike<number> | undefined,
  index: number,
): DrawDistance | undefined {
  if (!column) return undefined
  const at = DRAW_DISTANCE_STRIDE * index,
    min = column[at],
    max = column[at + 1],
    perInstance = column[at + 2] === 1
  return namesDrawDistance(min, max, perInstance) ? { min, max, perInstance } : undefined
}

/** Whether placement `index` of a `column` is drawn at the distances `held` names, read in place:
 *  nothing is made of the column's floats unless they differ. */
export function sameDrawDistanceAt(
  column: ArrayLike<number> | undefined,
  index: number,
  held: DrawDistance | undefined,
) {
  if (!column) return !held
  const at = DRAW_DISTANCE_STRIDE * index,
    min = column[at],
    max = column[at + 1],
    perInstance = column[at + 2] === 1
  if (!namesDrawDistance(min, max, perInstance)) return !held
  return !!held && held.min === min && held.max === max && held.perInstance === perInstance
}

/** Placement `index` of `column` holds `distance`, none for `undefined`. */
export function writeDrawDistanceAt(
  column: { [index: number]: number },
  index: number,
  distance: DrawDistance | undefined,
) {
  const at = DRAW_DISTANCE_STRIDE * index
  column[at] = distance?.min ?? 0
  column[at + 1] = distance?.max ?? 0
  column[at + 2] = distance?.perInstance ? 1 : 0
}
