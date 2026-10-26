import type { GpuHiz, HizDepth } from '../../visibility/hiz/gpu/types.ts'
import {
  hizDepthBindEntries,
  hizLevelZeroBindEntries,
} from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { GlobalFieldRead } from '../distanceField/view.ts'
import type { ScreenReflection } from './gpu.ts'
import { skyLightReadBindEntries, type SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { heldProgramGroup, keptProgramGroup } from '../../gpu/bind/programGroups.ts'
import { reflectionForwardLayout, reflectionLayout } from './reflectionPipelines.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_GROUP,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SKY_LIGHT,
  REFLECTION_VIEW_BINDING,
} from './viewLayout.ts'

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image it holds now, its front layer's depth and the lighting's view `lightView`, made
 *  again when one of them is not the one it was made over: the two HDR targets taking turns find a
 *  group each. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
  sky: SkyLightReadSet,
) {
  const image = reflection.lit.image.texture,
    { identity, slots } = reflection.group
  const { next } = identity
  next.length = 0
  next.push(depth, image, lightView, sky.cube, sky.harmonics, sky.params)
  const moved = identity.moved()
  const kept = slots[identity.slot]
  if (kept && !moved) return kept
  const { device } = reflection
  return (slots[identity.slot] = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
      // The lit image the last image lit (`hdrTargetDescriptor`).
      { binding: REFLECTION_IMAGE_BINDING, resource: image.createView() },
      // The transparents' front depth, the front pass's depth itself (`frontLayer.ts`).
      { binding: REFLECTION_FRONT_BINDING, resource: reflection.front.views.depth },
      ...skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
    ],
  }))
}

/** The forward programs' reflection group of `reflection` (`reflectionForwardLayout`): the view, level 0 of the depth `depth`
 *  (`GpuHiz.depth`), the lighting's view `lightView`, the front depth and the sky light, made again when one of them is not the one
 *  it was made over. */
function forwardReflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
  sky: SkyLightReadSet,
) {
  const { device, forward } = reflection
  const front = reflection.front.views.depth
  const { next } = forward.identity
  next.length = 0
  next.push(depth, lightView, front, sky.cube, sky.harmonics, sky.params)
  return (
    heldProgramGroup(forward) ??
    keptProgramGroup(
      device,
      reflectionForwardLayout(device),
      forward,
      [
        { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
        ...hizLevelZeroBindEntries(REFLECTION_DEPTH_BINDING, depth),
        { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
        { binding: REFLECTION_FRONT_BINDING, resource: front },
        ...skyLightReadBindEntries(REFLECTION_SKY_LIGHT, sky),
      ],
      'Trillion3D reflection forward',
    )
  )
}

/** What a frame holds that the reflection reads (`reflectionLightView`, `reflectionField`). */
type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    deferred?: {
      uniform: GPUBuffer
      placeholders: { distanceField: GlobalFieldRead }
    }
  }
  vis: { gpuHiz?: GpuHiz }
  distanceFields?: { scene: GlobalFieldRead }
}

/** The reflection group's other resource: the lighting's view. Undefined while the lighting is not made. */
export const reflectionLightView = ({ gpu }: ReflectionHost) => gpu.deferred?.uniform

/** The global distance field the scene stage marches its rays through: the session's, else the stand-in of a scene
 *  that has none, a view block that holds no clipmap; undefined while the lighting is not made. */
export const reflectionField = ({ gpu, distanceFields }: ReflectionHost) =>
  distanceFields?.scene ?? gpu.deferred?.placeholders.distanceField

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection as the forward programs read it
 *  (`forwardReflectionGroup`). */
export function bindForwardReflection(
  pass: GPURenderPassEncoder,
  rt: ReflectionHost,
  sky: SkyLightReadSet,
) {
  const lightView = reflectionLightView(rt),
    depth = rt.vis.gpuHiz?.depth()
  if (rt.gpu.reflection && lightView && depth)
    pass.setBindGroup(
      REFLECTION_GROUP,
      forwardReflectionGroup(rt.gpu.reflection, depth, lightView, sky),
    )
}
