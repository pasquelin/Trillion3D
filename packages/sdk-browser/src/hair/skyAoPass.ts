import { drawFullscreenTriangle } from '../gpu/shader/fullscreenTriangle.ts'
import { readHairStrandsSetting } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../gpu/bind/bindIdentity.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { lightingPhase } from '../lighting/surfaceCache/lighting/phase.ts'
import { HAIR_SKY_AO_BINDINGS, HAIR_SKY_AO_PARAM_WORDS, hairSkyAoWgsl } from './skyAoWgsl.ts'
import type { HairViewGpu } from './viewGpu.ts'
import type { HairVoxelSettings } from './inputs.ts'
import type { HairVoxelSet } from './voxelPass.ts'

/** The format of the occlusion the lighting reads (`AO_OCCLUSION_FORMAT`). */
const AO_FORMAT: GPUTextureFormat = 'r8unorm'
const CENTIMETRE = 0.01

/** The occlusion with the strands' laid on it, and the parameters of the pass. */
function allocateSkyAo(allocator: ResourceAllocator, width: number, height: number) {
  return {
    merged: allocator.texture('sky occlusion', [width, height], AO_FORMAT, {
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }),
    params: allocator.buffer('sky occlusion parameters', HAIR_SKY_AO_PARAM_WORDS, 'uniform'),
  }
}

interface SkyAoExtra {
  readonly words: ReturnType<typeof wordViews>
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  group?: GPUBindGroup
  readonly descriptor: GPURenderPassDescriptor & {
    colorAttachments: GPURenderPassColorAttachment[]
  }
}

/** The strands' occlusion pass of a view, kept with it (`HairViewGpu.skyAo`). */
export type HairSkyAo = ReturnType<typeof allocateSkyAo> & SkyAoExtra & HeldSet

const pipelineOf = (() => {
  const made = new WeakMap<GPUDevice, ReturnType<typeof preparedPipeline>>()
  return (device: GPUDevice) => {
    let pipeline = made.get(device)
    if (!pipeline) {
      const name = `${HAIR_STRANDS_PASS_PREFIX}sky occlusion`
      const module = device.createShaderModule({ label: name, code: hairSkyAoWgsl })
      made.set(
        device,
        (pipeline = preparedPipeline(device, {
          label: name,
          layout: 'auto',
          vertex: { module, entryPoint: 'fullscreen' },
          fragment: { module, entryPoint: 'hairSkyAoMain', targets: [{ format: AO_FORMAT }] },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
        })),
      )
    }
    return pipeline
  }
})()

/** Whether the strands darken the occlusion this image: the setting is on, the image holds strands and their voxels. */
const hairSkyAoWanted = (rt: WebgpuPagesRuntime) =>
  readHairStrandsSetting(rt, 'hairSkyAO') && !!rt.gpu.hair?.visible && !!rt.gpu.hair.voxel.set

/** The view's occlusion pass set for `size`, made where it is not held; none where the device has no room. */
function ensureSkyAo(view: HairViewGpu, device: GPUDevice, size: readonly [number, number]) {
  const made = ensureSet<ReturnType<typeof allocateSkyAo>, SkyAoExtra>(
    view.skyAo,
    device,
    {
      key: [size[0], size[1]],
      what: 'the sky occlusion of the hair strands',
      label: `${HAIR_STRANDS_PASS_PREFIX}sky occlusion`,
    },
    (allocator) => allocateSkyAo(allocator, size[0], size[1]),
    () => ({
      words: wordViews(new ArrayBuffer(HAIR_SKY_AO_PARAM_WORDS * 4)),
      identity: createWebgpuBindIdentity(),
      descriptor: {
        label: `${HAIR_STRANDS_PASS_PREFIX}sky occlusion`,
        colorAttachments: [{ view: undefined as never, loadOp: 'clear', storeOp: 'store' }],
      },
    }),
  )
  if (!made.resources) return undefined
  const set = made.resources
  view.skyAo = set
  return made.resources && (view.skyAo = made.resources)
}

/** The parameters of the pass: the settings of the strands' occlusion and the image's own. */
function writeSkyAoParams(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  set: HairSkyAo,
  settings: HairVoxelSettings,
) {
  const { u, f } = set.words
  u[0] = readHairStrandsSetting(rt, 'hairSkyAOSampleCount')
  u[1] = lightingPhase(rt)
  f[4] = readHairStrandsSetting(rt, 'hairSkyAODistanceThreshold') * CENTIMETRE
  f[5] = rt.gpu.ambientOcclusion?.settings.power ?? 1
  f[6] = rt.gpu.ambientOcclusion?.settings.intensity ?? 1
  f[7] = settings.densityScaleAO
  f[8] = settings.steppingScaleEnvironment
  f[9] = settings.depthBiasScaleEnvironment
  writeChanged(device, set.params, u, 0, HAIR_SKY_AO_PARAM_WORDS)
}

/** The bind group of the pass, kept while the resources it names stay. */
function bindSkyAo(
  device: GPUDevice,
  set: HairSkyAo,
  pipeline: GPURenderPipeline,
  voxels: HairVoxelSet,
  source: GPUTextureView,
  depth: GPUTextureView,
  normals: GPUTextureView,
  uniform: GPUBuffer,
) {
  const B = HAIR_SKY_AO_BINDINGS
  const { next } = set.identity
  next[0] = pipeline
  next[1] = voxels
  next[2] = source
  next[3] = depth
  next[4] = normals
  next[5] = uniform
  if (!set.identity.moved() && set.group) return set.group
  return (set.group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: voxels.paramsBuffer } },
      ...sequentialEntries(
        [
          { buffer: voxels.nodes },
          { buffer: voxels.pageIndex },
          { buffer: voxels.voxels },
          { buffer: set.params },
          source,
          depth,
          normals,
          { buffer: uniform },
        ],
        B.nodes,
      ),
    ],
  }))
}

/**
 * The occlusion `source` (`width` by `height`) with the strands' laid on it, in a texture of the view's: the least of the two at each pixel
 * (`hairSkyAoWgsl`). The lighting reads the one returned in place of `source`; none while the pass compiles, the strands have no voxels or the
 * device has no room, the occlusion standing as it is. `normals` and `depth` are the image's.
 */
export function encodeHairSkyAo(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  source: GPUTextureView,
  size: readonly [number, number],
  normals: GPUTextureView,
): GPUTextureView | undefined {
  const view = rt.gpu.hair
  const voxels = view?.voxel.set
  const depth = rt.gpu.depthView
  const deferred = rt.gpu.deferred
  if (!view || !voxels || !view.inputs.voxel || !depth || !deferred || !hairSkyAoWanted(rt))
    return undefined
  const pipeline = pipelineOf(device).get()
  if (!pipeline) return undefined
  const set = ensureSkyAo(view, device, size)
  if (!set) return undefined
  writeSkyAoParams(rt, device, set, view.inputs.voxel)
  const group = bindSkyAo(device, set, pipeline, voxels, source, depth, normals, deferred.uniform)
  set.descriptor.colorAttachments[0]!.view = set.merged
  drawFullscreenTriangle(encoder, set.descriptor, pipeline, group, size[0], size[1])
  return set.merged
}
