import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { effectsMoved } from '../render/encodeEffects.ts'
import { guidesMoved } from '../render/encodeGuides.ts'
import { particlesMoved } from '../../particles/gpu/webgpuParticleFrame.ts'
import { lightFunctionsWaiting } from '../../lighting/lightFunction/frame.ts'
import { lightProfilesWaiting } from '../../lighting/lightProfile/frame.ts'
import { ambientCubemapPending } from '../../lighting/deferred/ambientCubemapFrame.ts'
import { surfaceCacheBusy } from '../../lighting/surfaceCache/frame.ts'
import { cloudsMoved } from '../render/encodeClouds.ts'
import { skyCubemapsPending } from '../render/encodeCloudsSky.ts'
import { finishAnimated } from '../../post/finish/frame.ts'
import { blendGraphsAnimated } from '../../blend/graphWgsl.ts'
import { taaRuns } from '../backend/state/renderScale.ts'
import { taaConverged } from '../../post/taa/landing.ts'
import { readTemporalSetting } from '../../../../sdk-core/src/contracts/temporalOptions.ts'

/**
 * The terms that draw a quiet view again all the same (`holdWebgpuFrame`), each by the name a trace says: guides and effects that
 * may still require drawing this quiet source; a surface cache that has captures left (`surfaceCacheBusy`); a surface — opaque or
 * translucent — or a fog object whose graph reads the time; a sky light whose cubemap is still being written (`skyCubemapsPending`);
 * an ambient cubemap whose mips are (`ambientCubemapPending`); clouds that drift or have not settled (`cloudsMoved`); and a view
 * whose film grain is drawn: its pattern follows the image's number (`finishAnimated`). The temporal pass running
 * (`taaConverging`) and the frame-difference view are terms of the list too: `drawsEveryImage` and a trace name the same ones.
 */
const TERMS: readonly (readonly [string, (rt: WebgpuPagesRuntime) => boolean | undefined])[] = [
  ['taaConverging', (rt) => taaConverging(rt)],
  ['frameDifference', (rt) => rt.run.diagnostic === 'frame-difference'],
  ['surfaceCache', surfaceCacheBusy],
  ['guides', guidesMoved],
  ['effects', effectsMoved],
  ['particles', particlesMoved],
  ['lightFunctions', lightFunctionsWaiting],
  ['lightProfiles', lightProfilesWaiting],
  ['ambientCubemap', ambientCubemapPending],
  ['graphsAnimated', (rt) => rt.vis.graphsAnimated],
  ['blendGraphsAnimated', (rt) => blendGraphsAnimated(rt.vis.blendPipelines?.graphs)],
  ['fogVolumeAnimated', (rt) => rt.gpu.fogVolume?.gpu?.animated],
  ['clouds', cloudsMoved],
  ['skyCubemaps', skyCubemapsPending],
  ['finishAnimated', finishAnimated],
]

/** Whether the view's temporal pass still converges (`taaRuns`, `taaConverged`): its history not
 *  yet whole, so a quiet view is drawn again. Once whole, the image last drawn is the converged one
 *  the hold redisplays to the bit; a revision or a motion breaks the hold (`quiet`), and the pass
 *  resumes on the history it holds. A session opened with `drawConverged` keeps drawing it: the
 *  frame a cost measurement reads. */
function taaConverging(rt: WebgpuPagesRuntime) {
  const frame = rt.gpu.temporal?.frame
  if (!taaRuns(rt) || !frame) return false
  if (rt.context.drawConverged === true) return true
  return !taaConverged(
    frame,
    rt.gpu.targetSize[0],
    rt.gpu.displaySize[0],
    readTemporalSetting(rt, 'temporalHistorySampleCount'),
  )
}

/**
 * Whether a quiet view is drawn again all the same: one of the terms above (a temporal pass that runs until its history is whole,
 * the frame-difference view, which compares each image with the one before, and the rest). The hold reads it every frame, so it
 * allocates nothing.
 */
export function drawsEveryImage(rt: WebgpuPagesRuntime) {
  for (let at = 0; at < TERMS.length; at++) if (TERMS[at][1](rt)) return true
  return false
}

/** The names of the terms that draw the view again: a trace's, read only when one is asked. */
export const everyImageTerms = (rt: WebgpuPagesRuntime) =>
  TERMS.filter(([, term]) => term(rt)).map(([name]) => name)
