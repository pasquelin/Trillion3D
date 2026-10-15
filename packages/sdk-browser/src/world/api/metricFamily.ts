import { gpuPassBlockTotals } from '../../diagnostic/gpuPasses.ts'
import { lastFrameOf } from '../core/worldSession.ts'
import { NOT_DRAWN } from '../core/worldFrames.ts'

/**
 * GPU pass durations of the last frame, grouped by block (`gpuPassBlockTotals`).
 * @param world - The world to read.
 */
const gpuPasses = (world: object) => gpuPassBlockTotals(lastFrameOf(world)?.gpuPassMs ?? null)
/** The `metric` family: what the image cost, as measured, never estimated. The CPU bounds are the
 *  world's own (`world.cpuSteps`), the frame report its session's profiler. */
export const metric = {
  /**
   * The last frame's metrics; before the first frame, `NOT_DRAWN`, never `null`.
   * @param world - The world to read.
   */
  frame: (world: object) => lastFrameOf(world) ?? NOT_DRAWN,
  gpuPasses,
}
