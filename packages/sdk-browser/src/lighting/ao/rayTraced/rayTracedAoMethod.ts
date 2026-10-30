import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { RayTracedAmbientOcclusionSettings } from '../../../../../sdk-core/src/contracts/rayTracedAmbientOcclusionOptions.ts'
import { RAY_TRACED_SHADOW_VIEW_RULES } from '../../../../../sdk-core/src/contracts/rayTracedShadowOptions.ts'
import { contextReader } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { dagReadGroupEntries, dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { viewKey } from '../../../frame/backend/state/viewKey.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import { groupFor } from '../../../gpu/bind/cachedGroup.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStage } from '../../../gpu/core/computeStages.ts'
import { perViewRuns } from '../../../gpu/core/encoderUniforms.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { releaseOcclusionDenoise } from '../../shadows/denoise/shadowDenoiseFrame.ts'
import { reflectionGroup, reflectionLightView } from '../../reflections/group.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { isPending, isReady } from '../../rays/sceneTrace/sceneMaskHold.ts'
import { sceneMaskKey, type SceneMaskPrograms } from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { sceneRaysOf, type SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { specCache, type AoMethod } from '../method.ts'
import { aoTargetExtent } from '../plan.ts'
import {
  RAY_TRACED_AO_BINDINGS as B,
  RAY_TRACED_AO_ENTRY,
  RAY_TRACED_AO_FORMAT,
  RAY_TRACED_AO_GROUP,
  RAY_TRACED_AO_SCENE,
  rayTracedAoProgram,
} from './rayTracedAoWgsl.ts'

/** Centimetres in a metre: the shadows' normal bias is in centimetres, the scene's lengths in metres. */
const CM = 0.01
/** The least normal bias, in centimetres. */
const LEAST_BIAS_CM = 0.01
const PARAM_WORDS = 16

/** What the kernel is made of on a device: its group 0 layout, the stage of each set of graph masks (started once, off the frame), the scene trace's binder. */
export const rayTracedAoKit = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D ray traced ambient occlusion',
    entries: [
      computeUniformEntry(B.params),
      computeTextureEntry(B.normals, 'unfilterable-float'),
      computeTextureEntry(B.flags, 'uint'),
      computeStorageTextureEntry(B.occlusion, RAY_TRACED_AO_FORMAT, 'write-only'),
      ...dagReadLayoutEntries(),
    ],
  })
  const scene = device.createBindGroupLayout({
    label: 'Trillion3D ray traced ambient occlusion scene trace',
    entries: sceneMaskedLayoutEntries(RAY_TRACED_AO_SCENE.first),
  })
  const words = new ArrayBuffer(PARAM_WORDS * 4)
  /** The stage of each set of graph masks the rays cut by, started once: no frame waits for a candidate, the one the image binds is asked by `get`. */
  const stages = new WeakMap<SceneMaskPrograms, ReturnType<typeof startedComputeStage>>()
  const stageOf = (programs: SceneMaskPrograms) => {
    let stage = stages.get(programs)
    if (!stage) {
      stage = startedComputeStage(
        device,
        [layout, reflectionLayout(device), scene],
        rayTracedAoProgram(programs),
        RAY_TRACED_AO_ENTRY,
        `Trillion3D ray traced ambient occlusion ${sceneMaskKey(programs)}`,
      )
      stages.set(programs, stage)
    }
    return stage
  }
  return {
    layout,
    scene,
    sceneGroup: sceneTraceGroupBinder(device),
    words,
    ints: new Uint32Array(words),
    floats: new Float32Array(words),
    stageOf,
  }
})

/** The uniforms and the bind groups of the runs, a pair a view. */
const runsOf = perViewRuns('Trillion3D ray traced ambient occlusion params', PARAM_WORDS * 4)

/** A view's uniforms, bind groups and denoiser history let go (the image drew the occlusion another way, or none). */
export function releaseRayTracedAo(gpu: { viewKey?: object }) {
  runsOf.release(viewKey(gpu))
  releaseOcclusionDenoise(gpu)
}

const readShadow = contextReader(RAY_TRACED_SHADOW_VIEW_RULES)

/** What the occlusion's rays cast through: the scene trace the lighting made for this image and the compiled stage over the graph programs it holds. */
export interface RayTracedAoStage {
  readonly rays: SceneRays
  readonly pipeline: GPUComputePipeline
}

/** The stage of this image, none while the lighting made no scene trace for it (the scene has no triangles, its buffers do not fit) or the program is still compiling: the image keeps
 *  the screen-space search then. */
export function rayTracedAoStage(rt: WebgpuPagesRuntime): RayTracedAoStage | undefined {
  const { device } = rt.gpu
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!device || !rays) return undefined
  const kit = rayTracedAoKit(device)
  const pipeline = rays.sceneTrace.maskHold
    .use('ray traced ambient occlusion', '', kit.stageOf, isReady, isPending)
    ?.kernel.get()
  return pipeline && { rays, pipeline }
}

/** The pixel's radius in the world, per metre of depth under a perspective (the pixel's own under an orthographic projection): half a pixel's size, the projection's reciprocal scale over the width. */
const pixelRadius = (projectionX: number, width: number) => 1 / (projectionX * width)

/**
 * THE RAY-TRACED METHOD OF THE OCCLUSION (`ready` at once: the stage is asked by `rayTracedAoStage`, off the frame): one compute pass of the kernel (`rayTracedAoWgsl.ts`) over the drawn
 * image, into the view's one texture, which the lighting reads as it reads the search's. `needed.traced` is the stage the image casts through.
 */
export function rayTracedMethod(options: RayTracedAmbientOcclusionSettings): AoMethod {
  const cache = specCache((extent) => ({
    textures: [
      {
        name: 'ao',
        size: aoTargetExtent('ao', extent),
        format: RAY_TRACED_AO_FORMAT,
        storage: true,
      },
    ],
    passes: 0,
    paramBytes: 0,
  }))
  return {
    spec: cache.spec,
    get extent() {
      return cache.extent
    },
    ready: () => true,
    draw(encoder, view, needed, image) {
      const { rt, traced } = needed
      const output = view.textures.ao!
      if (!traced || !rt.gpu.reflection) return output
      const hiz = rt.vis.gpuHiz?.depth()
      const lightView = reflectionLightView(rt)
      const surfaces = rt.gpu.surfaces
      if (!hiz || !lightView || !surfaces) return output
      const kit = rayTracedAoKit(needed.device)
      const [width, height] = image.view
      const { ints: words, floats } = kit
      words.set([width, height, options.samples, image.frame], 0)
      words.set([0, 0, width, height], 4)
      floats.set(
        [
          options.radius,
          options.intensity,
          Math.max(readShadow(rt, 'rayTracedShadowsNormalBias'), LEAST_BIAS_CM) * CM,
          pixelRadius(image.projection[0]!, width),
        ],
        8,
      )
      words.set([0, options.twoSided ? 1 : 0, options.materials ? 1 : 0, 0], 12)
      const { uniforms, groups: cache } = runsOf.of(viewKey(rt.gpu), needed.device)
      const params = uniforms.next(needed.device, encoder)
      needed.device.queue.writeBuffer(params.buffer, 0, kit.words)
      const { nodes, frames, worlds, tree } = traced.rays.views
      const flags = surfaces.views()[3]!
      const group = groupFor(
        needed.device,
        cache,
        `run${params.index}`,
        kit.layout,
        [params.buffer, needed.normals, flags, output, nodes, frames, worlds, tree],
        () => [
          { binding: B.params, resource: { buffer: params.buffer } },
          { binding: B.normals, resource: needed.normals },
          { binding: B.flags, resource: flags },
          { binding: B.occlusion, resource: output },
          ...dagReadGroupEntries(traced.rays.views),
        ],
      )
      const pass = encoder.beginComputePass({ label: 'ao.rayTraced' })
      pass.setPipeline(traced.pipeline)
      pass.setBindGroup(0, group)
      pass.setBindGroup(1, reflectionGroup(rt.gpu.reflection, hiz, lightView, skyLightReadOf(rt)))
      pass.setBindGroup(
        RAY_TRACED_AO_SCENE.group,
        kit.sceneGroup(kit.scene, traced.rays.sceneTrace, RAY_TRACED_AO_SCENE.first),
      )
      pass.dispatchWorkgroups(
        ceilDiv(width, RAY_TRACED_AO_GROUP),
        ceilDiv(height, RAY_TRACED_AO_GROUP),
        1,
      )
      pass.end()
      return output
    },
  }
}
