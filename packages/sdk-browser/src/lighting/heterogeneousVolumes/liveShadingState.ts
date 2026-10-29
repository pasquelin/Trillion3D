import type { SparseVolumeEntry } from './sparseVolumeFile.ts'
import { advanceHeterogeneousVolumeFrame } from '../../../../sdk-core/src/scene/heterogeneousVolume/playback.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { VECTOR_FORMAT } from '../../post/taa/velocityWgsl.ts'
import {
  heterogeneousVolumeBounds,
  type ResolvedHeterogeneousVolume,
} from '../../../../sdk-core/src/scene/heterogeneousVolume/contracts.ts'
import { type WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { type CompiledGraph, compileGraph } from '../../materials/graph/compile.ts'
import { compileKept, isRefusal } from '../../materials/graph/kept.ts'
import { SHADOW_TILE_POOL_WGSL, colorSampleWgsl } from '../../materials/virtual/wgsl.ts'
import { createVolumeImage } from './liveShadingGpu.ts'
import {
  HV_FORMAT,
  HV_MAX_SPARSE,
  compositeBeerLayoutEntries,
  compositeLayoutEntries,
  compositeProgram,
  type HvVariant,
  holdoutLayoutEntries,
  liveShadingLayoutEntries,
  liveShadingProgram,
  sparseAllowed,
  sparseSlotsOf,
} from './liveShadingProgram.ts'
import { type HeterogeneousShadowMap } from './beerShadowMapGpu.ts'
import type { PackResources } from './beerShadowMapPack.ts'
import { type SparseVolumeFrameGpu, uploadSparseVolumeFrame } from './sparseVolumeGpu.ts'
import { type SparseVolumes } from './sparseVolumeLoad.ts'
import type { VoxelGrids } from './voxelGridShadows.ts'

/** The pipelines of a program, by the slot they fill. */
type PipelineSlot = 'cache' | 'march' | 'beer' | 'ao' | 'existence' | 'dilate' | 'bake' | 'avsm'

export interface Program {
  readonly compiled: CompiledGraph
  readonly layout: GPUBindGroupLayout
  readonly variant: HvVariant
  cache?: GPUComputePipeline
  march?: GPUComputePipeline
  beer?: GPUComputePipeline
  ao?: GPUComputePipeline
  existence?: GPUComputePipeline
  dilate?: GPUComputePipeline
  bake?: GPUComputePipeline
  avsm?: GPUComputePipeline
  /** The module the pipelines are of, and the pass that samples the material at the voxels of a grid (made when a grid is built, `voxelGrid/gridVolume.ts`). */
  module?: GPUShaderModule
  raster?: GPUComputePipeline
}

interface Upload {
  readonly key: string
  readonly gpu: SparseVolumeFrameGpu
  readonly resolution: readonly [number, number, number]
}

export interface Targets {
  readonly size: readonly [number, number]
  readonly factor: number
  readonly images: [GPUTexture, GPUTexture]
}

export interface State {
  programs: Map<string, Program>
  sparse?: SparseVolumes
  reading?: Promise<void>
  failed: boolean
  uploads: Map<string, Upload>
  frames: Map<string, number>
  lastClock: number
  targets?: Targets
  caches: Map<string, GPUTexture>
  /** The buffers and images the frame writes, kept by role: a destroyed resource cannot be submitted, and one a frame writes
   *  twice would keep the last write. */
  buffers: Map<string, GPUBuffer>
  steps: Map<string, GPUTexture>
  sampler?: GPUSampler
  stand?: GPUTexture
  /** A texture no pass reads, bound where a pass reads the cache it does not write. */
  standOut?: GPUTexture
  /** A one-cell page table, bound for a sparse volume slot with no volume. */
  standPages?: GPUTexture
  /** What the beer map and the velocity bindings hold where a pass does not use them. */
  standBeer?: GPUTexture
  standBeerOut?: GPUTexture
  standVelocity?: GPUTexture
  /** The camera's beer map and the volumes' radiance in two layers (`cameraMap.ts`), at the volumes' size. */
  camera?: { texture: GPUTexture; view: GPUTextureView; size: readonly [number, number] }
  /** The voxel grids the last shadows phase built (`voxelGridShadows.ts`), for the passes that read them. */
  voxelGrids?: VoxelGrids
  /** The maps of the lights the last image built (packed by `packShadowMaps`). */
  maps: HeterogeneousShadowMap[]
  /** The maps of the lights packed in one buffer for the passes that apply the lights (`beerShadowMapPack.ts`), none where there is none. */
  packedMaps?: GPUBuffer
  pack?: PackResources
  compose?: {
    layout: GPUBindGroupLayout
    pipeline?: GPURenderPipeline
    upsample?: GPURenderPipeline
    /** The pass that adds the holdout to the alpha, with its layout. */
    holdout?: GPURenderPipeline
    holdoutLayout: GPUBindGroupLayout
    /** The composition with the translucency, which reads the beer map of the camera and the depth. */
    beer?: GPURenderPipeline
    beerLayout: GPUBindGroupLayout
    format: GPUTextureFormat
  }
}

export const states = new WeakMap<object, State>()

/** The buffer of the role `key`, `size` bytes, made at the first ask and again if its size changed. */
export function bufferOf(
  held: State,
  device: GPUDevice,
  key: string,
  size: number,
  usage: GPUBufferUsageFlags,
) {
  let buffer = held.buffers.get(key)
  if (buffer?.size !== size) {
    buffer?.destroy()
    buffer = device.createBuffer({ label: `Trillion3D heterogeneous volume ${key}`, size, usage })
    held.buffers.set(key, buffer)
  }
  return buffer
}

/** The image of the role `key` at `size`, made at the first ask and again if its size changed. */
export function stepImage(
  held: State,
  device: GPUDevice,
  key: string,
  size: readonly [number, number],
  format: GPUTextureFormat = 'rgba16float',
) {
  let image = held.steps.get(key)
  if (image?.width !== size[0] || image.height !== size[1] || image.format !== format) {
    image?.destroy()
    image = createVolumeImage(device, size, `Trillion3D heterogeneous volume ${key}`, format)
    held.steps.set(key, image)
  }
  return image
}

export function release(held: State) {
  for (const buffer of held.buffers.values()) buffer.destroy()
  for (const image of held.steps.values()) image.destroy()
  held.buffers.clear()
  held.steps.clear()
  for (const upload of held.uploads.values()) upload.gpu.destroy()
  for (const cache of held.caches.values()) cache.destroy()
  held.targets?.images.forEach((image) => image.destroy())
  held.stand?.destroy()
  held.standOut?.destroy()
  held.standPages?.destroy()
  held.standBeer?.destroy()
  held.standBeerOut?.destroy()
  held.standVelocity?.destroy()
  held.camera?.texture.destroy()
  held.camera = undefined
  held.maps = []
  held.packedMaps = undefined
  held.voxelGrids = undefined
  held.uploads.clear()
  held.caches.clear()
  held.targets = held.stand = held.standOut = held.standPages = undefined
  held.standBeer = held.standBeerOut = held.standVelocity = undefined
}

/** Lets go of the held resources whose role (their key) `drops` names: the buffers, the images and the cache textures a switched-off option left. */
export function dropHeld(held: State, drops: (key: string) => boolean) {
  for (const group of [held.buffers, held.steps, held.caches] as Map<string, { destroy(): void }>[])
    for (const [key, resource] of group) if (drops(key)) (resource.destroy(), group.delete(key))
}

/** The volume's graph compiled for this pass, kept: none where it does not compile or reads what the pass cannot bind. */
export function compiledOf(volume: ResolvedHeterogeneousVolume): CompiledGraph | undefined {
  if (!volume.graph) return undefined
  const made = compileKept(volume.graph, 'heterogeneous', () => {
    const compiled = compileGraph(volume.graph!, {
      sample: colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      derivatives: 'neighbours',
      named: true,
    })
    if (!compiled.uses.sparseVolumes)
      throw new Error('a heterogeneous volume graph reads a sparse volume')
    if (sparseSlotsOf(compiled).length > HV_MAX_SPARSE)
      throw new Error(`a heterogeneous volume graph reads at most ${HV_MAX_SPARSE} sparse volumes`)
    return compiled
  })
  return isRefusal(made) ? undefined : made
}

/** The program of a graph, its pipelines asked off the frame the first time. */
export function programOf(
  held: State,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  compiled: CompiledGraph,
  beer: GPUTextureFormat,
  holdout: boolean,
  variant: HvVariant = 'plain',
): Program {
  const key = `${compiled.key}:${beer}:${holdout}:${variant}`
  let program = held.programs.get(key)
  if (program) return program
  const sparse = sparseSlotsOf(compiled).length
  // A graph that reads more sparse volumes than the stage may sample textures for gets a program with no pipeline: nothing is drawn.
  const allowed = sparseAllowed(
    device.limits.maxSampledTexturesPerShaderStage,
    compiled.uses.textures,
  )
  if (sparse > allowed) {
    rt.diag.diagnosticFailure(
      'heterogeneous-volume-program-failed',
      new Error(
        `a heterogeneous volume graph reads ${sparse} sparse volumes, the device lets it read ${allowed}`,
      ),
    )
    program = { compiled, variant, layout: device.createBindGroupLayout({ entries: [] }) }
    held.programs.set(key, program)
    return program
  }
  const layout = device.createBindGroupLayout({
    entries: liveShadingLayoutEntries(sparse, compiled.uses.textures, beer, holdout, variant),
  })
  program = { compiled, variant, layout }
  held.programs.set(key, program)
  const module = device.createShaderModule({
    label: 'Trillion3D heterogeneous volume',
    code: liveShadingProgram(compiled, beer, holdout, variant),
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const failed = (error: unknown) =>
    rt.diag.diagnosticFailure('heterogeneous-volume-program-failed', error)
  const made = program
  made.module = module
  // The program that builds the adaptive map has that one kernel to run; the others, all but that one.
  const entries: readonly (readonly [PipelineSlot, string])[] =
    variant === 'avsm'
      ? [['avsm', 'hvAvsmShadowMain']]
      : [
          ['cache', 'hvLightingCacheMain'],
          ['march', 'hvLiveShadingMain'],
          ['ao', 'hvAmbientOcclusionMain'],
          ['beer', 'hvBeerShadowMain'],
          ['existence', 'hvExistenceMain'],
          ['dilate', 'hvDilateMain'],
          ['bake', 'hvBakeMain'],
        ]
  for (const [slot, entryPoint] of entries)
    device
      .createComputePipelineAsync({
        label: `Trillion3D heterogeneous volume ${slot}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      })
      .then((pipeline) => {
        made[slot] = pipeline
        rt.run.gate.resourcesChanged()
      }, failed)
  return program
}

/** The volumes laid over the image: their radiance added, the image times their transmittance. */
const OVER: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'src-alpha' },
  alpha: { srcFactor: 'zero', dstFactor: 'src-alpha' },
}

/** The composition's pipelines, each under the slot of `State.compose` it fills, the layout it binds and the fragment it runs: the iteration of the upsampling,
 *  written into an image of the volumes' format; the last, which blends over the lit image, with the translucency (the camera's beer map read) or without; and the
 *  holdout, which adds to the alpha alone (the reference: alpha = surface alpha times the transmittance plus the holdout). */
const composePipelines = (format: GPUTextureFormat) =>
  [
    {
      slot: 'upsample',
      label: 'upsample',
      layout: 'layout',
      fragment: 'hvComposeFragment',
      target: { format: HV_FORMAT },
    },
    {
      slot: 'pipeline',
      label: 'compose',
      layout: 'layout',
      fragment: 'hvComposeFragment',
      target: { format, blend: OVER },
    },
    {
      slot: 'beer',
      label: 'compose with the translucency',
      layout: 'beerLayout',
      fragment: 'hvComposeBeerFragment',
      target: { format, blend: OVER },
    },
    {
      slot: 'holdout',
      label: 'holdout',
      layout: 'holdoutLayout',
      fragment: 'hvHoldoutFragment',
      target: {
        format,
        writeMask: GPUColorWrite.ALPHA,
        blend: {
          color: { srcFactor: 'zero', dstFactor: 'one' },
          alpha: { srcFactor: 'one', dstFactor: 'one' },
        },
      },
    },
  ] as const

/** The composition's pipelines over one module (`composePipelines`), asked off the frame. */
export function composeOf(
  held: State,
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  format: GPUTextureFormat,
) {
  if (held.compose?.format === format) return held.compose
  const layouts = {
    layout: device.createBindGroupLayout({ entries: compositeLayoutEntries() }),
    holdoutLayout: device.createBindGroupLayout({ entries: holdoutLayoutEntries() }),
    beerLayout: device.createBindGroupLayout({ entries: compositeBeerLayoutEntries() }),
  }
  const compose: NonNullable<State['compose']> = { ...layouts, format }
  held.compose = compose
  const module = device.createShaderModule({
    label: 'Trillion3D heterogeneous volume compose',
    code: compositeProgram(),
  })
  const failed = (error: unknown) =>
    rt.diag.diagnosticFailure('heterogeneous-volume-program-failed', error)
  for (const { slot, label, layout, fragment, target } of composePipelines(format))
    device
      .createRenderPipelineAsync({
        label: `Trillion3D heterogeneous volume ${label}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layouts[layout]] }),
        vertex: { module, entryPoint: 'hvComposeVertex' },
        fragment: { module, entryPoint: fragment, targets: [target] },
        primitive: { topology: 'triangle-list' },
      })
      .then((pipeline) => {
        compose[slot] = pipeline
        rt.run.gate.resourcesChanged()
      }, failed)
  return compose
}

/** The upload of frame `index` of the sparse volume of `entry`, held under `owner`: made at the first ask, the one before it let go. */
export function uploadOf(
  held: State,
  device: GPUDevice,
  sparse: SparseVolumes,
  owner: string,
  entry: SparseVolumeEntry,
  index: number,
) {
  const key = `${owner}:${index}`
  const found = held.uploads.get(owner)
  if (found?.key === key) return found
  found?.gpu.destroy()
  const upload: Upload = {
    key,
    gpu: uploadSparseVolumeFrame(device, sparse.frame(entry, index), key),
    resolution: entry.resolution,
  }
  held.uploads.set(owner, upload)
  return upload
}
/** The one-texel stand-ins bound where a pass does not use a resource: the sampler, the cache, the page table, the beer map and the velocity. */
export function ensureStandIns(held: State, device: GPUDevice, beerFormat: GPUTextureFormat) {
  held.sampler ??= device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  held.stand ??= device.createTexture({
    label: 'Trillion3D heterogeneous volume stand-in',
    dimension: '3d',
    size: [1, 1, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  held.standPages ??= device.createTexture({
    label: 'Trillion3D heterogeneous volume stand-in pages',
    dimension: '3d',
    size: [1, 1, 1],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  held.standOut ??= device.createTexture({
    label: 'Trillion3D heterogeneous volume stand-in out',
    dimension: '3d',
    size: [1, 1, 1],
    format: HV_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING,
  })
  if (held.standBeerOut && held.standBeerOut.format !== beerFormat)
    (held.standBeerOut.destroy(), (held.standBeerOut = undefined))
  held.standBeer ??= device.createTexture({
    label: 'Trillion3D heterogeneous volume stand-in beer map',
    size: [1, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  held.standBeerOut ??= device.createTexture({
    label: 'Trillion3D heterogeneous volume stand-in beer map out',
    size: [1, 1],
    format: beerFormat,
    usage: GPUTextureUsage.STORAGE_BINDING,
  })
  held.standVelocity ??= device.createTexture({
    label: 'Trillion3D heterogeneous volume stand-in velocity',
    size: [1, 1],
    format: VECTOR_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING,
  })
}

/** Where a volume is this image: the frame it shows (a playing volume carries on from the one it showed), its voxels' way to the world
 *  and back, and its bounds. */
export function placementOf(
  held: State,
  sparse: SparseVolumes,
  volume: ResolvedHeterogeneousVolume,
  dt: number,
) {
  const entry = sparse.volumeOfNode(volume.source)!
  const frameCount = entry.frames.length
  const shown = advanceHeterogeneousVolumeFrame(
    {
      ...volume,
      frame: volume.playing ? (held.frames.get(volume.id) ?? volume.frame) : volume.frame,
    },
    frameCount,
    dt,
  )
  held.frames.set(volume.id, shown)
  const index = Math.min(Math.floor(shown), frameCount - 1)
  // The volume's voxels to the world: the frame's own transform, then the object's.
  const toWorld = new Float64Array(16)
  const toLocal = new Float64Array(16)
  multiplyMatrix4(
    toWorld,
    Float64Array.from(volume.matrix),
    Float64Array.from(entry.frames[index].matrix),
  )
  invertMatrix4(toLocal, toWorld)
  const bounds = heterogeneousVolumeBounds(entry.resolution, volume.pivotAtCentroid)
  const centre = bounds.min.map((m, i) => (m + bounds.max[i]) / 2) as [number, number, number]
  const extent = bounds.min.map((m, i) => (bounds.max[i] - m) / 2) as [number, number, number]
  return { volume, entry, index, toWorld, toLocal, centre, extent }
}
