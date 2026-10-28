import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { createWebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import type { ComputeRun } from '../gpu/core/lazyComputePass.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { noiseViewOn } from '../gpu/noise/blueNoiseTextures.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { frameLights } from '../lighting/shadows/vsm/frame/vsmPlan.ts'
import { lightingPhase } from '../lighting/surfaceCache/lighting/phase.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import type { HairViewGpu } from './viewGpu.ts'
import { deepShadowIndexOf, deepShadowLayerDepths, strandLightOf } from './deepShadowMath.ts'
import {
  HAIR_SURFACE_KIND,
  HAIR_SURFACE_LIGHT_WORDS,
  HAIR_SURFACE_PARAM_WORDS,
  HAIR_SURFACE_SHADOW_BINDINGS as B,
  HAIR_SURFACE_SHADOW_ENTRY,
  HAIR_SURFACE_SHADOW_FORMAT,
  hairSurfaceShadowWgsl,
} from './surfaceShadowWgsl.ts'

const GROUP = 8
/** Room for one element of the largest buffer a program of the pass reads (a deep shadow's view: 160 bytes). */
const BLANK_WORDS = 64
const PASS = `${HAIR_STRANDS_PASS_PREFIX}shadow on the surfaces`
const PASS_DESCRIPTOR: GPUComputePassDescriptor = { label: PASS }

/** The layers of the strands' shadow on the surfaces, a layer a light, and the records of the lights. */
function allocateSurfaceShadow(
  allocator: ResourceAllocator,
  width: number,
  height: number,
  layers: number,
) {
  return {
    layers: allocator.image(
      'shadow on the surfaces',
      [width, height, layers],
      HAIR_SURFACE_SHADOW_FORMAT,
      {
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      },
    ),
    params: allocator.buffer(
      'shadow on the surfaces parameters',
      HAIR_SURFACE_PARAM_WORDS,
      'uniform',
    ),
    lights: allocator.buffer(
      'shadow on the surfaces lights',
      layers * HAIR_SURFACE_LIGHT_WORDS,
      'storage',
    ),
    // Stand in for the volume's parameters and the deep shadows' buffers of a frame that has none: no light of that kind reads them.
    blankUniform: allocator.buffer(
      'shadow on the surfaces blank parameters',
      BLANK_WORDS,
      'uniform',
    ),
    blankStorage: allocator.buffer('shadow on the surfaces blank buffer', BLANK_WORDS, 'storage'),
  }
}

interface SurfaceShadowExtra {
  readonly view: GPUTextureView
  readonly capacity: number
  readonly words: ReturnType<typeof wordViews>
  readonly lightWords: ReturnType<typeof wordViews>
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  group?: GPUBindGroup
}

/** The strands' shadow on the surfaces of a view, kept with it (`HairViewGpu.surfaceShadow`) and grown only. */
export type HairSurfaceShadow = ReturnType<typeof allocateSurfaceShadow> &
  SurfaceShadowExtra &
  HeldSet

const pipelines = new WeakMap<GPUDevice, ReturnType<typeof preparedComputePipeline>>()

function pipelineOf(device: GPUDevice) {
  let pipeline = pipelines.get(device)
  if (!pipeline) {
    const module = device.createShaderModule({ label: PASS, code: hairSurfaceShadowWgsl })
    pipelines.set(
      device,
      (pipeline = preparedComputePipeline(device, {
        label: PASS,
        layout: 'auto',
        compute: { module, entryPoint: HAIR_SURFACE_SHADOW_ENTRY },
      })),
    )
  }
  return pipeline
}

/** The view's set of layers for `count` lights at `width` by `height`: the one it holds where it fits, else made; none where the device has no room. */
function ensureSurfaceShadowSet(
  view: HairViewGpu,
  device: GPUDevice,
  width: number,
  height: number,
  count: number,
) {
  const capacity = Math.max(2, ceilDiv(count, 4) * 4)
  const made = ensureSet<ReturnType<typeof allocateSurfaceShadow>, SurfaceShadowExtra>(
    view.surfaceShadow,
    device,
    {
      key: [width, height, capacity],
      what: 'the shadow of the hair strands on the surfaces',
      label: PASS,
      fits: (held) =>
        held.layers.width === width && held.layers.height === height && held.capacity >= count,
    },
    (allocator) => allocateSurfaceShadow(allocator, width, height, capacity),
    (resources) => ({
      view: resources.layers.createView({ dimension: '2d-array' }),
      capacity,
      words: wordViews(new ArrayBuffer(HAIR_SURFACE_PARAM_WORDS * 4)),
      lightWords: wordViews(new ArrayBuffer(capacity * HAIR_SURFACE_LIGHT_WORDS * 4)),
      identity: createWebgpuBindIdentity(),
    }),
  )
  return made.resources && (view.surfaceShadow = made.resources)
}

/** The record of each light: how the strands shade the surfaces for it, and where it stands. */
function writeLightRecords(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  view: HairViewGpu,
  set: HairSurfaceShadow,
  cam: EngineCamera,
  lightIds: readonly string[],
  count: number,
) {
  const { settings, deepSettings, shadows, voxels } = shadingOf(view)
  const entries = frameLights(rt, 'plan', cam)
  const deepIndex = deepShadowIndexOf(entries, cam.eye)
  const byId = new Map(entries.map(({ light }) => [light.id, light]))
  const { u, f } = set.lightWords
  u.fill(0)
  for (let k = 0; k < count; k++) {
    const source = byId.get(lightIds[k]!)
    const strand = source && source.castsShadow ? strandLightOf(source, cam.eye) : undefined
    if (!strand) continue
    const at = k * HAIR_SURFACE_LIGHT_WORDS
    const index = deepIndex.get(lightIds[k]!)
    const drawn =
      index === undefined ? undefined : shadows?.lights.find((entry) => entry.light === index)
    f[at] = strand.vector[0]
    f[at + 1] = strand.vector[1]
    f[at + 2] = strand.vector[2]
    f[at + 3] = strand.directional ? 0 : 1
    f.set(deepShadowLayerDepths(strand.layerDistribution), at + 4)
    f[at + 15] = 1
    f[at + 16] = strand.range
    if (drawn && shadows && deepSettings) {
      u[at + 8] = HAIR_SURFACE_KIND.deep
      u[at + 9] = drawn.offset / 4
      u[at + 10] = view.inputs.surfaceShadow?.kernelType ?? 0
      u[at + 11] = shadows.set.resolution
      f[at + 12] = deepSettings.depthBiasScale
      f[at + 13] = deepSettings.densityScale
      f[at + 14] = deepSettings.kernelAperture
    } else if (voxels && settings) {
      u[at + 8] = HAIR_SURFACE_KIND.voxel
    }
  }
  writeChanged(device, set.lights, u, 0, count * HAIR_SURFACE_LIGHT_WORDS)
}

/** The parameters of the pass. */
function writeParams(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  view: HairViewGpu,
  set: HairSurfaceShadow,
  count: number,
) {
  const settings = view.inputs.voxel
  const params = set.words
  params.u[0] = count
  params.u[1] = lightingPhase(rt)
  params.u[2] = settings?.jitterMode ?? 0
  params.u[3] = view.inputs.surfaceShadow?.randomType ?? 0
  params.f[4] = settings?.densityScaleShadow ?? 0
  params.f[5] = settings?.depthBiasScaleShadow ?? 0
  params.f[6] = settings?.steppingScaleShadow ?? 1
  writeChanged(device, set.params, params.u, 0, HAIR_SURFACE_PARAM_WORDS)
}

/** What shades the surfaces of a view: the volume, the deep shadows and the settings of each. */
function shadingOf(view: HairViewGpu) {
  return {
    voxels: view.voxel.set,
    settings: view.inputs.voxel,
    shadows: view.deepShadows,
    deepSettings: view.inputs.deepShadow?.settings,
  }
}

/** The bind group of the pass, kept while the resources it names stay. A volume or deep shadows the frame has not made are stood in for by blank buffers: no light of the kind reads them. */
function bindSurfaceShadow(
  device: GPUDevice,
  view: HairViewGpu,
  set: HairSurfaceShadow,
  pipeline: GPUComputePipeline,
  depth: GPUTextureView,
  normals: GPUTextureView,
) {
  const { voxels, shadows } = shadingOf(view)
  const targets = view.record!.targets
  const { next } = set.identity
  next[0] = pipeline
  next[1] = depth
  next[2] = targets.hairOnlyDepthView
  next[3] = targets.coverageView
  next[4] = voxels
  next[5] = shadows?.set
  next[6] = view.viewBlock.buffer
  next[7] = normals
  if (!set.identity.moved() && set.group) return set.group
  const blank = { buffer: set.blankStorage }
  return (set.group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      ...sequentialEntries(
        [
          { buffer: set.params },
          { buffer: set.lights },
          { buffer: view.viewBlock.buffer },
          depth,
          targets.hairOnlyDepthView,
          targets.coverageView,
        ],
        B.params,
      ),
      {
        binding: B.voxelParams,
        resource: voxels ? { buffer: voxels.paramsBuffer } : { buffer: set.blankUniform },
      },
      { binding: B.voxelNodes, resource: voxels ? { buffer: voxels.nodes } : blank },
      { binding: B.voxelPageIndex, resource: voxels ? { buffer: voxels.pageIndex } : blank },
      { binding: B.voxels, resource: voxels ? { buffer: voxels.voxels } : blank },
      { binding: B.viewInfos, resource: shadows ? { buffer: shadows.set.viewInfos } : blank },
      { binding: B.slotMaps, resource: shadows ? { buffer: shadows.set.slotMaps } : blank },
      { binding: B.frontDepth, resource: shadows ? shadows.set.frontView : depth },
      { binding: B.domLayers, resource: shadows ? shadows.set.layersView : targets.coverageView },
      { binding: B.normals, resource: normals },
      { binding: B.out, resource: set.layers.createView({ dimension: '2d-array' }) },
      { binding: B.blueNoise, resource: noiseViewOn(device) },
    ],
  }))
}

/**
 * The shadow the hair strands cast on the surfaces, for the lights of the classic shadow mode (`lightIds`, the projected lights in the order the projection reads them): a layer a light of
 * the shadow the strands let through at each pixel, by the light's deep shadow or else by the voxels (`hairSurfaceShadowWgsl`), which the projection takes the least of with the
 * shadow maps' (`VsmProjectionTarget.hairShadow`). `normals` are the surfaces' (xyz the world normal). None where the strands have neither a deep shadow nor a volume, or the pass compiles.
 */
export function encodeHairSurfaceShadow(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  steps: ComputeRun,
  cam: EngineCamera,
  lightIds: readonly string[],
  normals: GPUTextureView,
): GPUTextureView | undefined {
  const { gpu } = rt
  const view = gpu.hair
  const depth = gpu.depthView
  if (!view?.visible || !view.record || !depth || !lightIds.length) return undefined
  const { voxels, settings, shadows, deepSettings } = shadingOf(view)
  if (!(shadows && deepSettings) && !(voxels && settings)) return undefined
  const pipeline = pipelineOf(device).get()
  if (!pipeline) return undefined
  const [width, height] = gpu.allocatedSize
  const count = Math.min(lightIds.length, device.limits.maxTextureArrayLayers)
  const set = ensureSurfaceShadowSet(view, device, width, height, count)
  if (!set) return undefined
  writeLightRecords(rt, device, view, set, cam, lightIds, count)
  writeParams(rt, device, view, set, count)
  const pass = steps.pass(PASS_DESCRIPTOR)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindSurfaceShadow(device, view, set, pipeline, depth, normals))
  pass.dispatchWorkgroups(ceilDiv(width, GROUP), ceilDiv(height, GROUP), count)
  return set.view
}
