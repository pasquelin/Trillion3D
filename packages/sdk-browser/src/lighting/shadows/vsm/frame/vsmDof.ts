import type { DepthOfField } from '../../../../../../sdk-core/src/world/effect/depthOfField.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { compileCocModel } from '../../../../post/effects/depthOfField/cocModel.ts'
import { effectsShown, stagePlan } from '../../../../post/effects/stagePlan.ts'
import { setDofBias, type VsmDofBias } from '../dofBias.ts'

/** The model last compiled and what it was compiled from: an image whose lens and view stand as the one
 *  before compiles none. */
const held = new WeakMap<
  object,
  { volume: unknown; key: string; model: ReturnType<typeof compileCocModel> }
>()

/**
 * The depth of field's bias on the maps' resolution for this frame, written into `into`
 * (`VsmMapSettings.dof`): the strength `shadowMaxDofResolutionBias` where the view draws a depth of
 * field — the chain holds one that draws, on an image that shows the chain —, else none; the model of
 * its circle of confusion for the image the camera draws at its drawn size, as the pass compiles it.
 */
export function followDepthOfField(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  strength: number,
  into: VsmDofBias,
) {
  const pass = effectsShown(rt)
    ? (stagePlan(rt, 'before-resolve')?.passes.find((p) => p.kind === 'depthOfField') as
        DepthOfField | undefined)
    : undefined
  if (!pass || !(strength > 0)) {
    into.strength = 0
    return
  }
  const [width, height] = rt.gpu.targetSize
  const settings = rt.gpu.kindSettings.peek('depthOfField', rt.context)
  const key = [
    width,
    height,
    cam.projection[0],
    cam.projection[5],
    settings.depthOfFieldMaxForegroundRadius,
    settings.depthOfFieldMaxBackgroundRadius,
  ].join('|')
  let kept = held.get(rt)
  if (!kept || kept.volume !== pass.values || kept.key !== key) {
    const model = compileCocModel(
      pass.values,
      { width, height, cotHorizontal: cam.projection[0]!, cotVertical: cam.projection[5]! },
      {
        maxForeground: settings.depthOfFieldMaxForegroundRadius,
        maxBackground: settings.depthOfFieldMaxBackgroundRadius,
      },
    )
    held.set(rt, (kept = { volume: pass.values, key, model }))
  }
  setDofBias(into, kept.model, strength, width)
}
