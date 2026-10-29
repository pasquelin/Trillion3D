import type { ResolvedReflectionCapture } from '../../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import { readReflectionCaptureSettings } from '../../../../sdk-core/src/contracts/reflectionCaptureOptions.ts'
import {
  createReflectionCaptures,
  type ReflectionCaptures,
} from '../../lighting/reflectionCapture/capture.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { heldReflectionCaptures, reflectionCaptureHosts } from './reflectionCaptureState.ts'
import { skyLightStateOf } from './skyLightState.ts'

/**
 * THE REFLECTION CAPTURES IN THE FRAME: the scene's captures (`context.sceneReflectionCapture`, the settings `reflectionCaptures…`) looked
 * at once an image is submitted and, when one is due, drawn aside between two images (`ReflectionCaptures.run`), as the sky light's
 * captured scene is. The lighting reads the cube array they make through the set the module holds (`reflectionCaptureReadOf`).
 */
/** The captures of a store as a list, made again when its revision moves. */
const listed = new WeakMap<object, { revision: number; captures: ResolvedReflectionCapture[] }>()
function capturesOf(store: NonNullable<WebgpuPagesRuntime['context']['sceneReflectionCapture']>) {
  let at = listed.get(store)
  if (at?.revision !== store.revision)
    listed.set(store, (at = { revision: store.revision, captures: [...store.values] }))
  return at.captures
}

/** The recaptures the host asked that the captures of a runtime have answered. */
const answered = new WeakMap<WebgpuPagesRuntime, number>()

/** The distance in metres past which a capture holds the sky: the sky light's threshold, where a sky light that is not static shines. */
function skyDistanceOf(rt: WebgpuPagesRuntime) {
  const part = skyLightStateOf(rt).source?.part
  return part && part.light.mobility !== 'static'
    ? part.light.skyDistanceThreshold / 100
    : undefined
}

/** The image was submitted (the main view's, `skyLightSubmitted`): the captures are looked at and the first that is due is drawn. */
export function reflectionCapturesSubmitted(rt: WebgpuPagesRuntime) {
  const store = rt.context.sceneReflectionCapture
  const { device } = rt.gpu
  if (!store || !device) return
  let captures = heldReflectionCaptures.get(rt)
  // No capture: nothing is read, made or kept.
  const settings = store.count === 0 ? undefined : readReflectionCaptureSettings(rt)
  // No capture, or the setting off: the cubes are freed (nothing is made while it is off), and made again when a capture is added.
  if (!settings?.reflectionCaptures) {
    if (captures) {
      captures.dispose()
      heldReflectionCaptures.delete(rt)
    }
    return
  }
  if (!captures)
    heldReflectionCaptures.set(
      rt,
      (captures = createReflectionCaptures(device, (error) =>
        rt.diag.diagnosticFailure('reflection-capture-failed', error),
      )),
    )
  if (answered.get(rt) !== store.recaptures) {
    if (answered.has(rt)) captures.recapture()
    answered.set(rt, store.recaptures)
  }
  const run = {
    revision: store.revision,
    captures: capturesOf(store),
    settings,
    skyDistance: skyDistanceOf(rt),
  }
  if (captures.due(run)) {
    const host = reflectionCaptureHosts.get(rt)
    if (host) void captures.run(host)
  }
}
