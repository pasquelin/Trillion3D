import {
  hitLightingProbesRun,
  type HitLightingSettings,
} from '../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { waterFrontOf } from '../../blend/water/waterReflection.ts'
import { lightGridOf } from '../../lighting/rays/lightGrid/lightGridFrame.ts'
import type { CacheHitLighting } from '../../lighting/bounce/cache/cacheHitLit.ts'
import { lightFunctionResources } from '../../lighting/lightFunction/frame.ts'
import { lightProfileResources } from '../../lighting/lightProfile/frame.ts'
import { lightProfileStandIn } from '../../lighting/lightProfile/profileStandIn.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { viewKey } from '../backend/state/viewKey.ts'

/** What the hit lighting keeps for one view: the record its image writes over (nothing is allocated an image), the image it was resolved for and the answer. */
interface Held {
  frame: number
  inputs: CacheHitLighting | undefined
  answer: CacheHitLighting | undefined
  /** Whether the image had the settings, the deferred program and the device to decide on: an answer of none is then the settings', not a lack of information. */
  decided: boolean
}

/** The holder of what the hit lighting reads, one a view (a queued update keeps its own view's). */
const held = new WeakMap<object, Held>()

/** The inputs of this image, written over the view's record; none where the settings do not light the probes' hits. */
function resolve(rt: WebgpuPagesRuntime, mine: Held): CacheHitLighting | undefined {
  const { reflection, deferred, device } = rt.gpu
  const settings: HitLightingSettings | undefined = reflection?.settings(
    rt.context,
    waterFrontOf(rt),
  ).hit
  mine.decided = !!settings && !!deferred && !!device
  if (!settings || !deferred || !device || !hitLightingProbesRun(settings)) return undefined
  const lightFunction =
    lightFunctionResources(rt, 'lightFunctionBounce') ?? deferred.placeholders.lightFunction
  const lightProfile = lightProfileResources(rt) ?? lightProfileStandIn(device)
  const exposure = reflection?.frame.exposure ?? 1
  // The view's one light grid, prepared here once an image whoever asks (the reflections' hit lighting prepares the same one).
  const lightGrid = lightGridOf(rt.gpu, device)
  const lightGridView = lightGrid.prepare(rt.lights.store, settings.lightGrid, rt.run.frame)
  if (!mine.inputs)
    return (mine.inputs = {
      settings,
      lightFunction,
      lightProfile,
      lightGrid,
      lightGridView,
      exposure,
    })
  mine.inputs.settings = settings
  mine.inputs.lightFunction = lightFunction
  mine.inputs.lightProfile = lightProfile
  mine.inputs.lightGridView = lightGridView
  mine.inputs.exposure = exposure
  return mine.inputs
}

/**
 * WHAT THE RADIANCE CACHE'S HIT LIGHTING NEEDS OF THIS IMAGE (`hardwareRayTracingLightingMode: 'hitLighting'`, the settings of the reflections' family): the settings, the light functions' atlas and the light profiles', as the bounce's lights read them (`lightFunctionBounce`), and the exposure of the view as the CPU knows it (`ReflectionFrame.exposure`, the view's `preExposureOf` of this image), not the GPU's uniform every view shares.
 * Checked first, so that an image where the settings do not light the probes' hits builds nothing: none then. Resolved once an image for a view, whoever asks (the screen probes, the cache's queue).
 */
export function bounceHitLightingOf(rt: WebgpuPagesRuntime): CacheHitLighting | undefined {
  const key = viewKey(rt.gpu)
  let mine = held.get(key)
  if (!mine)
    held.set(key, (mine = { frame: -1, inputs: undefined, answer: undefined, decided: false }))
  if (mine.frame !== rt.run.frame) {
    mine.frame = rt.run.frame
    mine.answer = resolve(rt, mine)
  }
  return mine.answer
}

/** What the radiance cache follows (`bounceHitLightingOf`, and `null` where the image decided the settings do not light the probes' hits, `undefined` where it could not decide: the cache keeps its hit lighting through an image with no information and gives it back on a decision against it). */
export function bounceHitLightingFollowOf(rt: WebgpuPagesRuntime) {
  const answer = bounceHitLightingOf(rt)
  return answer ?? (held.get(viewKey(rt.gpu))?.decided ? null : undefined)
}
