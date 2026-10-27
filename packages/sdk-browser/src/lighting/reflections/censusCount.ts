import type { ReflectionFrameMetrics } from '../../../../sdk-core/src/contracts/reflectionMetrics.ts'
import {
  REFLECTION_CENSUS,
  REFLECTION_FATES,
  REFLECTION_WORK_BUCKETS,
  type ReflectionFate,
} from './censusWgsl.ts'

/** The metrics before any census came back: every count unknown. */
export const WAITING: ReflectionFrameMetrics = {
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
): ReflectionFrameMetrics {
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
    ...(marched && {
      sceneEnded: {
        noField: fate('noField'),
        hit: fate('hit'),
        open: fate('open'),
        miss: fate('miss'),
        bound: fate('bound'),
        distant: fate('distant'),
      },
      sceneWork: Array.from(words.subarray(at.work, at.work + REFLECTION_WORK_BUCKETS)),
    }),
  }
}
