import { BOUNCE_SETTINGS, bounceBatchOf } from '../../../sdk-core/src/index.ts'
import { bounceGroup, bounceLayout, type BounceSlot } from './bindings.ts'
import { BOUNCE_ATLAS_FORMAT } from './atlas.ts'
import { atlasExtent } from '../webgpu/core/floatAtlas.ts'
import { textureLimits } from '../gpu/core/textureLimits.ts'
import { BOUNCE_SURFACE_SHADER, SURFACE_WORKGROUP, surfaceCacheBytes } from './surfaceWgsl.ts'
import { surfaceCacheTexels } from './sizes.ts'
import type { GpuBounceProxy } from './proxy.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { ceilDiv, workgroupCount } from '../../../math/src/scalar/integers.ts'

/** What the cache pass binds: the grid, the proxy and its albedo, lights, frozen probes, the
 *  cache — the two atlases of `atlas.ts`. */
const SURFACE_TYPES: BounceSlot[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'atlas-array',
  'atlas-out',
  'uniform',
]

export type GpuBounceSurface = Awaited<ReturnType<typeof createGpuBounceSurface>>

/** The cache's atlas for `texels` cells on a device whose textures reach `side` — its view —, the
 *  uniform of the span a frame sweeps, and what frees both. */
function surfaceTargets(device: GPUDevice, texels: number, side: number) {
  const texture = device.createTexture({
    label: 'Trillion3D bounce surface cache v2',
    size: atlasExtent(texels, side),
    format: BOUNCE_ATLAS_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const span = device.createBuffer({
    label: 'Trillion3D bounce surface span v1',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const release = () => {
    texture.destroy()
    span.destroy()
  }
  return { view: texture.createView(), span, release }
}

/** The sweep's layout and pipeline, its shader checked first; a shader or pipeline refused
 *  `release`s what the cache made. */
async function surfacePipeline(device: GPUDevice, release: () => void) {
  try {
    const module = await createCheckedShaderModule(
      device,
      BOUNCE_SURFACE_SHADER,
      'BOUNCE_SURFACE_SHADER',
    )
    const layout = bounceLayout(device, SURFACE_TYPES)
    const pipeline = await buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateSurface' },
    })
    return { layout, pipeline }
  } catch (error) {
    release()
    throw error
  }
}

/** The sweep's group of the resources `bound` names for a light buffer, made again when the light
 *  buffer it names was replaced. */
function surfaceGroups(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  bound: (lights: GPUBuffer) => (GPUBuffer | GPUTextureView)[],
) {
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (current: GPUBuffer) => {
    identity.next[0] = current
    if (identity.moved() || !group)
      group = bounceGroup(device, layout, bound(current), SURFACE_TYPES)
    return group
  }
}

/** The sweep over a cache of `texels` cells: its span's words, where it is, its full sweeps since
 *  the last invalidation, the cells of the last frame, and its batch — at most `ceiling`. */
function surfaceSweep(texels: number) {
  const ceiling = Math.min(BOUNCE_SETTINGS.surfaceTexelsPerFrame, texels)
  return { ceiling, words: new Uint32Array(4), cursor: 0, sweeps: 0, updated: 0, batch: ceiling }
}
type SurfaceSweep = ReturnType<typeof surfaceSweep>

/** The frame's batch, the fraction of the ceiling the millisecond budget kept (`load`), from where
 *  the sweep is: its span's words. */
function spanWords(sweep: SurfaceSweep, texels: number, load: number) {
  sweep.batch = bounceBatchOf(sweep.ceiling, load)
  const { words } = sweep
  words[0] = sweep.cursor
  words[1] = sweep.batch
  words[2] = texels
  return words
}

/** The sweep past the frame's batch, back to the first cell after the last: one more sweep. */
function advance(sweep: SurfaceSweep, texels: number) {
  sweep.updated = sweep.batch
  sweep.cursor += sweep.batch
  if (sweep.cursor >= texels) {
    sweep.cursor = 0
    sweep.sweeps++
  }
}

/**
 * Proxy surface cache and the pass that sweeps it.
 *
 * One cell per triangle and per face, updated on a fixed cell budget per frame. The sweep
 * restarts as soon as a light changes — the same invalidation as a shadow map — and stops by
 * itself when nothing moves: a still scene does not encode this pass.
 */
export async function createGpuBounceSurface(
  device: GPUDevice,
  proxy: GpuBounceProxy,
  lights: () => GPUBuffer,
  grid: { uniform: GPUBuffer; snapshot: GPUTextureView },
) {
  const texels = surfaceCacheTexels(proxy.triangleCount)
  const { side } = textureLimits(device.limits)
  const bytes = surfaceCacheBytes(proxy.triangleCount, side)
  const { view, span, release } = surfaceTargets(device, texels, side)
  const { layout, pipeline } = await surfacePipeline(device, release)
  const groupOf = surfaceGroups(device, layout, (current) => [
    grid.uniform,
    proxy.buffer,
    proxy.albedo,
    current,
    grid.snapshot,
    view,
    span,
  ])
  const sweep = surfaceSweep(texels)
  return {
    /** The cache's atlas, which the probe pass and the lit passes read. */
    view,
    texels,
    /** What the cache occupies in GPU memory, published in the diagnostic. */
    bytes,
    /** Frames of a full cache sweep at the current batch: the other half of the lag. */
    get sweepFrames() {
      return workgroupCount(texels, Math.max(1, sweep.batch))
    },
    /** Full sweeps since the last invalidation. */
    get sweeps() {
      return sweep.sweeps
    },
    /** Cells updated by the last encoded frame. */
    get lastTexels() {
      return sweep.updated
    },
    /** A light changed: the whole cache is stale, the sweep resumes where it was.
     *  Rewinding the cursor would only redo the same cells every frame of a moving light. */
    restart() {
      sweep.sweeps = 0
    },
    /**
     * Encodes a cell batch whose size is the fraction of the ceiling the millisecond budget
     * kept, as a dispatch of the bounce's open compute `pass`, before the probes read the cache.
     */
    encode(pass: GPUComputePassEncoder, load: number) {
      device.queue.writeBuffer(span, 0, spanWords(sweep, texels, load))
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, groupOf(lights()))
      pass.dispatchWorkgroups(ceilDiv(sweep.batch, SURFACE_WORKGROUP), 1, 1)
      advance(sweep, texels)
    },
    dispose: release,
  }
}
