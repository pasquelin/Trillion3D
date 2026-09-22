import { gpuPassBlockTotals } from '../../gpuPassBlocks.ts';
import { lastFrameOf, sessionOf } from '../core/worldSession.ts';
import { NOT_DRAWN } from '../core/worldFrames.ts';

/** GPU pass durations of the last frame, grouped by block (`gpuPassBlockTotals`). */
const gpuPasses = (world: object) => gpuPassBlockTotals(lastFrameOf(world)?.gpuPassMs ?? null);
/** CPU bounds of the frames since the last reset (`webgpuPagesCpuSteps.ts`), read once. */
const cpuSteps = (world: object) => sessionOf(world).cpuSteps();

/** The `metric` family: what the image cost, as measured, never estimated. */
export const metric = {
  /** The last frame's metrics; before the first frame, `NOT_DRAWN`, never `null`. */
  frame: (world: object) => lastFrameOf(world) ?? NOT_DRAWN,
  cpuSteps,
  gpuPasses,
  /** The session's profiler (`EngineProfiler`), with the two readings above. */
  createProfiler(world: object) {
    return {
      cpuSteps: () => cpuSteps(world),
      gpuPasses: () => gpuPasses(world),
      report: () => sessionOf(world).getReport(),
    };
  },
};
