import { SELECTION_NONE as NONE } from '../../core/selection.ts'
import { bandError, bandSphere, dagRecords } from '../records.fixture.ts'
import { projectedError, thresholdOf, type DagViewFrames } from './math.fixture.ts'
import type { PackedDag } from '../types.ts'

/** The parent band of world cluster `c` — its world group's error — projected in the world DAG's
 *  frame, as `worldCovers` projects it. */
export function oracleWorldPixels(packed: PackedDag, frames: DagViewFrames) {
  const root = packed.world!.root,
    records = dagRecords(packed),
    { hot } = records
  return (c: number) => {
    const sphere = bandSphere(records, c, 1)
    return projectedError(
      bandError(records, c, 1),
      hot[sphere],
      hot[sphere + 1],
      hot[sphere + 2],
      hot[sphere + 3],
      frames.views[root],
      frames.stretches[root],
      frames.focal,
      frames.near,
      frames.perspective,
    )
  }
}

/**
 * The CPU mirror of `worldCovers` (`../shader/placementTreeWgsl.ts`): whether the world DAG draws a
 * placement in its place — its object's world cluster not ready, or that cluster's parent band, its
 * world group's error, projected within the threshold in the world DAG's frame. `ready` is the cut
 * rule's residency; none, every cluster is.
 */
export function oracleWorldCovers(
  packed: PackedDag,
  frames: DagViewFrames,
  ready?: ArrayLike<number>,
) {
  const world = packed.world
  if (!world) return () => false
  const pixels = oracleWorldPixels(packed, frames)
  return (w: number) => {
    const c = world.links[w]
    if (c === NONE) return false
    if (ready && !ready[c]) return true
    return !(pixels(c) > thresholdOf(frames, world.root))
  }
}
