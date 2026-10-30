import type { ReflectionFrameMetrics } from '../../../../sdk-core/src/contracts/reflectionMetrics.ts'
import {
  REFLECTION_CENSUS,
  REFLECTION_FATES,
  REFLECTION_SCREEN_ENDS,
  REFLECTION_WORK_BUCKETS,
  type ReflectionFate,
  type ReflectionScreenEnd,
} from './censusWgsl.ts'

/** The metrics with the exact steps of the marches beside their buckets: the mean over the rays that marched and the longest march (null until a census came back, or where the stage marches nothing). */
export interface ReflectionCountedMetrics extends ReflectionFrameMetrics {
  sceneStepsMean: number | null
  sceneStepsMax: number | null
  /** Why the rays the screen stage cast ended as they did, each once (`REFLECTION_SCREEN_ENDS`, `censusWgsl.ts`); they add up to `rays`. */
  screenEnded: Record<ReflectionScreenEnd, number> | null
  /** The rays that ended `behind` by how far behind the surface they stopped (`gap`: under 2, 2 to 8, 8 to 32, over 32 thicknesses), by the pyramid level of the last tile they passed above
   *  (`mip`: 0, 1, 2, 3 and over) and by the iteration they stopped at (`step`: 1 to 3, 4 to 10, 11 and over); a ray the walk gave up for want of lanes is in none. */
  screenBehind: { gap: number[]; mip: number[]; step: number[] } | null
  /** The rays that ended `leftScreen`: `never` stepped (the walk began at the border), `stepped` the rest. */
  screenLeft: { never: number; stepped: number } | null
}

/** The metrics before any census came back: every count unknown. */
export const WAITING: ReflectionCountedMetrics = {
  sceneStepsMean: null,
  sceneStepsMax: null,
  screenEnded: null,
  screenBehind: null,
  screenLeft: null,
  censusReads: null,
  censusFrame: null,
  rays: null,
  screenRays: null,
  sceneRays: null,
  sceneEnded: null,
  sceneWork: null,
}

/** The metrics a census `words` of image `frame` gives, `reads` the censuses that came back; `marched` whether the image's scene stage marched its rays
 *  through the field, the one that counts how they ended and the steps they took (`sceneEnded`, `sceneWork`): the stage that casts them through the
 *  scene's triangles (`hardware.ts`) binds no counters, its eighth storage buffer being the last the stage may hold, and leaves both unknown. */
export function countedBy(
  words: Uint32Array,
  reads: number,
  frame: number,
  marched: boolean,
): ReflectionCountedMetrics {
  const at = REFLECTION_CENSUS
  const fate = (name: ReflectionFate) => words[at.fates + REFLECTION_FATES.indexOf(name)]
  return {
    ...WAITING,
    censusReads: reads,
    censusFrame: frame,
    // Every ray the screen stage casts ends in exactly one of these two.
    rays: words[at.screen] + words[at.left],
    screenRays: words[at.screen],
    sceneRays: words[at.left],
    screenEnded: Object.fromEntries(
      REFLECTION_SCREEN_ENDS.map((name, i) => [name, words[at.ended + i]]),
    ) as Record<ReflectionScreenEnd, number>,
    screenBehind: {
      gap: Array.from(words.subarray(at.behindGap, at.behindGap + 4)),
      mip: Array.from(words.subarray(at.behindMip, at.behindMip + 4)),
      step: Array.from(words.subarray(at.behindStep, at.behindStep + 3)),
    },
    screenLeft: { never: words[at.leftScreen], stepped: words[at.leftScreen + 1] },
    ...(marched && {
      sceneEnded: {
        noField: fate('noField'),
        hit: fate('hit'),
        open: fate('open'),
        bound: fate('bound'),
        distant: fate('distant'),
      },
      sceneWork: Array.from(words.subarray(at.work, at.work + REFLECTION_WORK_BUCKETS)),
      sceneStepsMean: marchedRays(words) ? words[at.workSum] / marchedRays(words) : null,
      sceneStepsMax: marchedRays(words) ? words[at.workMax] : null,
    }),
  }
}

/** The rays whose march took steps: every bucket of `work` counts each once. */
const marchedRays = (words: Uint32Array) =>
  words.subarray(REFLECTION_CENSUS.work, REFLECTION_CENSUS.work + REFLECTION_WORK_BUCKETS).reduce((a, b) => a + b, 0)
