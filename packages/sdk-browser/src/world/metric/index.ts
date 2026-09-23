import { gpuPassBlockTotals } from '../../gpu/core/passBlocks.ts';
import { lastFrameOf, sessionOf } from '../core/worldSession.ts';
import { NOT_DRAWN } from '../core/worldFrames.ts';

/**
 * GPU pass durations of the last frame, grouped by block (`gpuPassBlockTotals`).
 * @param world - The world to read.
 */
const gpuPasses = (world: object) => gpuPassBlockTotals(lastFrameOf(world)?.gpuPassMs ?? null);
/**
 * CPU bounds of the frames since the last reset (`webgpu/pages/render/cpuSteps.ts`), read once.
 * @param world - The world to read.
 */
const cpuSteps = (world: object) => sessionOf(world).cpuSteps();

/** The `metric` family: what the image cost, as measured, never estimated. */
export const metric = {
  /**
   * The last frame's metrics; before the first frame, `NOT_DRAWN`, never `null`.
   * @param world - The world to read.
   */
  frame: (world: object) => lastFrameOf(world) ?? NOT_DRAWN,
  cpuSteps,
  gpuPasses,
  /**
   * The session's profiler (`EngineProfiler`), with the two readings above.
   * @param world - The world to watch.
   */
  createProfiler(world: object) {
    return {
      cpuSteps: () => cpuSteps(world),
      gpuPasses: () => gpuPasses(world),
      report: () => sessionOf(world).getReport(),
    };
  },
};
