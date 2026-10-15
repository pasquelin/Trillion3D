import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthBindEntries } from '../gpu/hiz/pyramidTexture.ts'
import type { ProxyResources } from '../gpu/dag/cutReaders.ts'
import { sceneBindEntries } from '../bounce/sceneBindings.ts'
import type { ScreenReflection } from './gpu.ts'
import { reflectionLayout } from './reflectionPipelines.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_FRONT_BINDING,
  REFLECTION_GROUP,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SAMPLER_BINDING,
  REFLECTION_SCENE_BINDINGS,
  REFLECTION_VIEW_BINDING,
} from './viewLayout.ts'

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image its pyramid holds now, its front layer's depth, the lighting's view `lightView` and the
 *  proxy every reflection ray walks (`proxy`, the culling's or the stand-in), made again when one of
 *  them is not the one it was made over: the two HDR targets taking turns find a group each. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
  proxy: ProxyResources,
) {
  const image = reflection.radiance.image.texture,
    { identity, slots } = reflection.group
  const { next } = identity
  next.length = 0
  next.push(depth, image, lightView, proxy.buffer, proxy.worlds, proxy.tree)
  const moved = identity.moved()
  const kept = slots[identity.slot]
  if (kept && !moved) return kept
  const { device } = reflection
  return (slots[identity.slot] = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: REFLECTION_VIEW_BINDING, resource: { buffer: reflection.uniform } },
      { binding: REFLECTION_SAMPLER_BINDING, resource: reflection.radiance.sampler },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
      // Every level of the pyramid: the lit image and its mips (`hdrTargetDescriptor`).
      { binding: REFLECTION_IMAGE_BINDING, resource: image.createView() },
      // The transparents' front depth, the front pass's depth itself (`frontLayer.ts`).
      { binding: REFLECTION_FRONT_BINDING, resource: reflection.front.views.depth },
      // The proxy the chain's rays walk, in every program that reads the chain (`proxy.ts`).
      ...sceneBindEntries(REFLECTION_SCENE_BINDINGS, proxy),
    ],
  }))
}

/** What a frame holds that the reflection reads (`reflectionLightView`, `reflectionProxy`). */
type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    deferred?: {
      uniform: GPUBuffer
      placeholders: {
        runtime: GPUBuffer
        runtimeWorlds: GPUTextureView
        runtimeTree: GPUTextureView
      }
    }
  }
  vis: { gpuHiz?: GpuHiz }
  run: { gpuSelection?: { proxy(): ProxyResources | undefined } }
}

/** The reflection group's other resource: the lighting's view. Undefined while the lighting is not made. */
export const reflectionLightView = ({ gpu }: ReflectionHost) => gpu.deferred?.uniform

/** What a reflection ray can meet of the scene: the proxy, its blended copies taken before the cut
 *  (`dispatchCut`), else the lighting's empty stand-in; undefined while the lighting is not made. */
export function reflectionProxy({ gpu, run }: ReflectionHost): ProxyResources | undefined {
  const placeholders = gpu.deferred?.placeholders
  if (!placeholders) return undefined
  const proxy = run.gpuSelection?.proxy()
  return {
    buffer: proxy?.buffer ?? placeholders.runtime,
    worlds: proxy?.worlds ?? placeholders.runtimeWorlds,
    tree: proxy?.tree ?? placeholders.runtimeTree,
  }
}

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid and the proxy, made with the frame's targets and the visibility programs. */
export function bindForwardReflection(pass: GPURenderPassEncoder, rt: ReflectionHost) {
  const depth = rt.vis.gpuHiz?.depth(),
    lightView = reflectionLightView(rt),
    proxy = reflectionProxy(rt)
  if (rt.gpu.reflection && depth && lightView && proxy)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(rt.gpu.reflection, depth, lightView, proxy))
}
