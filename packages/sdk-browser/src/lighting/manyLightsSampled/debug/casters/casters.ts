/**
 * THE SHADOW CASTER VIEWS' RAYS OF A RUNTIME (`castersWgsl.ts`): whether the image casts them, and the pass that does, over the scene trace the lighting made for the image (`SceneRays`).
 * The hits stay in a texture the size of the draw until the next image; the views paint them (`../visualizeWgsl.ts`). Nothing and no texture while the views are not asked or the scene cannot be traced.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { dagReadGroupEntries } from '../../../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../../../gpu/bind/bindIdentity.ts'
import { startedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { releaseSized, sizedTexture, type SizedTexture } from '../../../../gpu/core/sizedTexture.ts'
import { isPending, isReady } from '../../../rays/sceneTrace/sceneMaskHold.ts'
import type { SceneMaskPrograms } from '../../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneTraceGroupBinder } from '../../../rays/sceneTrace/sceneTraceGroup.ts'
import { sceneRaysOf } from '../../../surfaceCache/lighting/surfaceLighting.ts'
import { followSampledLights, hairVoxelsOf } from '../../frame.ts'
import { HAIR_SURFACE_OCCLUSION } from '../../hairSurfaceTraceWgsl.ts'
import { noiseFrame } from '../../../../frame/render/noiseFrame.ts'
import { HAIR_TRAVERSAL_MAX_DISTANCE } from '../../../../hair/voxelTraversalWgsl.ts'
import { skyLightReadOf } from '../../../../frame/render/skyLightState.ts'
import { skyLightReadBindEntries } from '../../../../modules/sky/skyLight/read.ts'
import { visualizeTonemapBindings } from '../../../surfaceCache/sceneDebug/visualizeTonemap.ts'
import { visualizeViewOf, VISUALIZE } from '../modes.ts'
import {
  CASTER_HITS_FORMAT,
  CASTER_RAY,
  CASTERS_BINDINGS as B,
  CASTERS_ENTRY,
  CASTERS_GROUP,
  CASTERS_PARAMS,
  CASTERS_SCENE,
  CASTERS_SKY,
  castersEntries,
  castersSceneEntries,
  castersSkyEntries,
  castersWgsl,
} from './castersWgsl.ts'
import {
  CASTERS_HAIR_BINDINGS as H,
  CASTERS_HAIR_ENTRY,
  CASTERS_HAIR_PARAMS,
  castersHairEntries,
  castersHairWgsl,
} from './castersHairWgsl.ts'

/** The longest a ray goes, in metres. */
const REACH = 10485.76

/** Whether the numbered view `view` is one the rays paint: the shadow casters, their quality and the overview that holds both. */
export const castersView = (view: number) =>
  view === VISUALIZE.overview ||
  view === VISUALIZE.shadowCasters ||
  view === VISUALIZE.shadowCasterQuality

/**
 * Whether this image wants the rays: the main view draws a caster view and the settings let the rays through the scene's triangles. The lighting then makes the scene trace for the image
 * (`LightingInputs.probes`), whatever else is traced.
 */
export function castersTraced(rt: WebgpuPagesRuntime) {
  if (rt.views.active !== rt.views.main) return false
  const values = followSampledLights(rt)
  return (
    values.sampledLightsHardwareRayTracing &&
    castersView(visualizeViewOf(values, rt.run.diagnostic))
  )
}

/** What the rays are made of on a device: the layouts, the stage of each set of graph masks (started once, off the frame) and the scene trace's binder. */
const kitOf = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D sampled casters',
    entries: castersEntries(),
  })
  const scene = device.createBindGroupLayout({
    label: 'Trillion3D sampled casters scene trace',
    entries: castersSceneEntries(),
  })
  const sky = device.createBindGroupLayout({
    label: 'Trillion3D sampled casters sky light',
    entries: castersSkyEntries(),
  })
  const hairLayout = device.createBindGroupLayout({
    label: 'Trillion3D sampled casters hair',
    entries: castersHairEntries(),
  })
  let hairStage: ReturnType<typeof startedComputeStage> | undefined
  const stages = new WeakMap<SceneMaskPrograms, ReturnType<typeof startedComputeStage>>()
  return {
    layout,
    scene,
    sky,
    sceneGroup: sceneTraceGroupBinder(device),
    hairLayout,
    /** The strands' march, its pipeline started at the first image that has hair to trace. */
    hairPipeline: () =>
      (hairStage ??= startedComputeStage(
        device,
        [hairLayout],
        castersHairWgsl(),
        CASTERS_HAIR_ENTRY,
        'Trillion3D sampled casters hair',
      )).get(),
    stageOf(programs: SceneMaskPrograms) {
      let stage = stages.get(programs)
      if (!stage) {
        stage = startedComputeStage(
          device,
          [layout, scene, sky],
          castersWgsl(programs),
          CASTERS_ENTRY,
          'Trillion3D sampled casters',
        )
        stages.set(programs, stage)
      }
      return stage
    },
  }
})

interface CastersState {
  hits?: SizedTexture
  params?: GPUBuffer
  readonly words: Uint32Array<ArrayBuffer>
  /** The parameters' words as floats, written in place each image. */
  readonly floats: Float32Array<ArrayBuffer>
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  group?: GPUBindGroup
  readonly skyIdentity: ReturnType<typeof createWebgpuBindIdentity>
  skyGroup?: GPUBindGroup
  /** The strands' hits, their parameters and bind group, while the image has hair to trace. */
  hair?: SizedTexture
  hairParams?: GPUBuffer
  readonly hairWords: Uint32Array<ArrayBuffer>
  readonly hairFloats: Float32Array<ArrayBuffer>
  readonly hairIdentity: ReturnType<typeof createWebgpuBindIdentity>
  hairGroup?: GPUBindGroup
}
const states = new WeakMap<WebgpuPagesRuntime, CastersState>()

/** The ray flags the settings ask for. */
export const casterRayFlags = (materialMode: number, forceTwoSided: boolean) =>
  (materialMode === 0 ? CASTER_RAY.opaque : 0) | (forceTwoSided ? 0 : CASTER_RAY.cullBack)

/**
 * Casts the rays of a draw of `size` pixels across and down over the display, once an image: the view of the texture they write (and, where the image has hair to trace, of the strands' hits beside it), none while the image has no scene trace, the pass is
 * compiling or the draw is too large for a texture. The rays honour the cut-out masks when `sampledLightsEvaluateMaterialMode` is above 0 and meet the backs of one-sided triangles
 * when `sampledLightsForceTwoSided` is on.
 */
export function encodeCasters(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  size: readonly [number, number],
) {
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  const deferred = rt.gpu.deferred
  const tone = visualizeTonemapBindings(rt)
  if (!rays || !deferred || !tone) return undefined
  const kit = kitOf(device)
  const pipeline = rays.sceneTrace.maskHold
    .use('sampled casters', '', kit.stageOf, isReady, isPending)
    ?.kernel.get()
  if (!pipeline) return undefined
  let state = states.get(rt)
  if (!state) {
    const words = new Uint32Array(CASTERS_PARAMS.words)
    const hairWords = new Uint32Array(CASTERS_HAIR_PARAMS.words)
    state = {
      hairWords,
      hairFloats: new Float32Array(hairWords.buffer),
      hairIdentity: createWebgpuBindIdentity(),
      words,
      floats: new Float32Array(words.buffer),
      identity: createWebgpuBindIdentity(),
      skyIdentity: createWebgpuBindIdentity(),
    }
    states.set(rt, state)
  }
  state.hits = sizedTexture(device, state.hits, size, {
    label: 'Trillion3D sampled casters hits',
    format: CASTER_HITS_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  if (!state.hits) return undefined
  state.params ??= device.createBuffer({
    label: 'Trillion3D sampled casters params',
    size: CASTERS_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const values = followSampledLights(rt)
  const at = CASTERS_PARAMS.at
  const { words, floats } = state
  const [width, height] = size
  words[at.size] = width
  words[at.size + 1] = height
  words[at.size + 2] = rt.gpu.displaySize[0]
  words[at.size + 3] = rt.gpu.displaySize[1]
  floats[at.trace] = 0
  floats[at.trace + 1] = REACH
  words[at.ray] = casterRayFlags(
    values.sampledLightsEvaluateMaterialMode,
    values.sampledLightsForceTwoSided,
  )
  words[at.ray + 1] = tone.baked ? 1 : 0
  device.queue.writeBuffer(state.params, 0, state.words)
  const { next } = state.identity
  const { nodes, frames, worlds, tree } = rays.views
  next.length = 0
  next.push(
    kit.layout,
    state.params,
    state.hits.view,
    deferred.uniform,
    ...tone.resources.slice(1),
    nodes,
    frames,
    worlds,
    tree,
  )
  if (state.identity.moved())
    state.group = device.createBindGroup({
      label: 'Trillion3D sampled casters',
      layout: kit.layout,
      entries: [
        { binding: B.params, resource: { buffer: state.params } },
        { binding: B.hits, resource: state.hits.view },
        { binding: B.view, resource: { buffer: deferred.uniform } },
        ...tone.resources.slice(1).map((resource, k) => ({ binding: B.tone + 1 + k, resource })),
        ...dagReadGroupEntries(rays.views),
      ],
    })
  const sky = skyLightReadOf(rt)
  const skyNext = state.skyIdentity.next
  skyNext.length = 0
  skyNext.push(kit.sky, sky.cube, sky.sampler, sky.harmonics, sky.params)
  if (state.skyIdentity.moved())
    state.skyGroup = device.createBindGroup({
      label: 'Trillion3D sampled casters sky light',
      layout: kit.sky,
      entries: skyLightReadBindEntries(CASTERS_SKY, sky),
    })
  const pass = encoder.beginComputePass({ label: 'Trillion3D sampled casters' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, state.group!)
  pass.setBindGroup(
    CASTERS_SCENE.group,
    kit.sceneGroup(kit.scene, rays.sceneTrace, CASTERS_SCENE.first),
  )
  pass.setBindGroup(CASTERS_SKY.group, state.skyGroup!)
  pass.dispatchWorkgroups(ceilDiv(size[0], CASTERS_GROUP), ceilDiv(size[1], CASTERS_GROUP))
  pass.end()
  return {
    hits: state.hits.view,
    hair: encodeCastersHair(rt, device, encoder, kit, state, deferred.uniform, size),
  }
}

/**
 * Marches the same rays through the strands' voxels, once an image, when the image holds hair and `sampledLightsHairVoxelTraces` holds: the view of the texture of the strands' hits, none otherwise
 * (and none while the pass compiles).
 */
function encodeCastersHair(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  kit: ReturnType<typeof kitOf>,
  state: CastersState,
  view: GPUBuffer,
  size: readonly [number, number],
) {
  const values = followSampledLights(rt)
  const voxels = hairVoxelsOf(rt, values)
  if (!voxels) {
    state.hair = releaseSized(device, state.hair)
    return undefined
  }
  const pipeline = kit.hairPipeline()
  state.hair = sizedTexture(device, state.hair, size, {
    label: 'Trillion3D sampled casters hair hits',
    format: CASTER_HITS_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  if (!pipeline || !state.hair) return undefined
  state.hairParams ??= device.createBuffer({
    label: 'Trillion3D sampled casters hair params',
    size: CASTERS_HAIR_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { hairWords: words, hairFloats: floats } = state
  const at = CASTERS_HAIR_PARAMS.at
  words[at.size] = size[0]
  words[at.size + 1] = size[1]
  words[at.size + 2] = rt.gpu.displaySize[0]
  words[at.size + 3] = rt.gpu.displaySize[1]
  floats[at.voxel] = voxels.settings.densityScaleShadow
  floats[at.voxel + 1] = voxels.settings.steppingScaleShadow
  floats[at.voxel + 2] = HAIR_SURFACE_OCCLUSION
  floats[at.voxel + 3] = Math.min(REACH, HAIR_TRAVERSAL_MAX_DISTANCE)
  words[at.random] = voxels.settings.jitterMode
  words[at.random + 1] = noiseFrame(rt)
  device.queue.writeBuffer(state.hairParams, 0, words)
  const { set } = voxels
  const { next } = state.hairIdentity
  next.length = 0
  next.push(
    kit.hairLayout,
    set.paramsBuffer,
    set.nodes,
    set.pageIndex,
    set.voxels,
    state.hairParams,
    view,
    state.hair.view,
  )
  if (state.hairIdentity.moved())
    state.hairGroup = device.createBindGroup({
      label: 'Trillion3D sampled casters hair',
      layout: kit.hairLayout,
      entries: [
        { binding: 0, resource: { buffer: set.paramsBuffer } },
        { binding: 1, resource: { buffer: set.nodes } },
        { binding: 2, resource: { buffer: set.pageIndex } },
        { binding: 3, resource: { buffer: set.voxels } },
        { binding: H.params, resource: { buffer: state.hairParams } },
        { binding: H.view, resource: { buffer: view } },
        { binding: H.hits, resource: state.hair.view },
      ],
    })
  const pass = encoder.beginComputePass({ label: 'Trillion3D sampled casters hair' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, state.hairGroup!)
  pass.dispatchWorkgroups(ceilDiv(size[0], CASTERS_GROUP), ceilDiv(size[1], CASTERS_GROUP))
  pass.end()
  return state.hair.view
}

/** Gives the rays' texture and parameters of `rt` back. */
export function releaseCasters(rt: WebgpuPagesRuntime) {
  const state = states.get(rt)
  const device = rt.gpu.device
  if (!state) return
  if (device) {
    state.hits = releaseSized(device, state.hits)
    state.hair = releaseSized(device, state.hair)
  }
  state.params?.destroy()
  state.hairParams?.destroy()
  states.delete(rt)
}
