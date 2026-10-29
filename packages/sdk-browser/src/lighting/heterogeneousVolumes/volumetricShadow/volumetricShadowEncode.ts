import { VG_PARAMS_STRIDE } from '../voxelGrid/gridPasses.ts'
import { AVSM_PARAMS_BYTES } from './convertBeerToAvsmWgsl.ts'
import { AVSM_RENDER_PARAMS_BYTES } from './renderVolumetricShadowMapWgsl.ts'
import type { VolumetricShadowPasses } from './volumetricShadowPasses.ts'

type Size = readonly [number, number]

/** The parameters of the passes (`AvsmParams`). */
export function packAvsmParams(c: {
  resolution: Size
  maxSampleCount: number
  compress: boolean
  absoluteError: number
  relativeError: number
}): ArrayBuffer {
  const out = new ArrayBuffer(AVSM_PARAMS_BYTES)
  const i = new Int32Array(out)
  const f = new Float32Array(out)
  i.set([...c.resolution, c.maxSampleCount, c.compress ? 1 : 0], 0)
  f.set([c.absoluteError, c.relativeError], 4)
  return out
}

/** The texels of a map of `resolution` once its groups of 8 x 8 are counted whole: what the conversions and the compression allocate for. */
export const paddedTexels = (resolution: Size) =>
  Math.ceil(resolution[0] / 8) * 8 * Math.ceil(resolution[1] / 8) * 8

/** The atlas words a fixed run of `maxSampleCount` samples takes a texel: the top level and the bottom level, each padded to four. */
export const atlasWordsPerTexel = (maxSampleCount: number) =>
  Math.ceil(Math.ceil(maxSampleCount / 4) / 4) * 4 + Math.ceil(maxSampleCount / 4) * 4

/** The bytes of the buffers a volumetric shadow map of `resolution`, `faces` faces and `maxSampleCount` samples a texel takes. */
export const volumetricShadowBytes = (resolution: Size, faces: number, maxSampleCount: number) => {
  const texels = paddedTexels(resolution) * faces
  return {
    // Four words a texel.
    indirection: texels * 16,
    atlas: texels * atlasWordsPerTexel(maxSampleCount) * 4,
    // Two words an entry, a run of maxSampleCount entries a texel.
    list: resolution[0] * resolution[1] * faces * maxSampleCount * 8,
  }
}

interface Encoding {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly passes: VolumetricShadowPasses
}

const groupsOf = (resolution: Size, faces: number): [number, number, number] => [
  Math.ceil(resolution[0] / 8),
  Math.ceil(resolution[1] / 8),
  faces,
]

/** One compute pass of a stage over `groups`, on a bind group of `entries`. Nothing while the stage is not compiled. */
function dispatch(
  c: Encoding,
  stage: { layout: GPUBindGroupLayout; pipeline: { get(): GPUComputePipeline | undefined } },
  label: string,
  entries: GPUBindGroupEntry[],
  groups: [number, number, number],
) {
  const pipeline = stage.pipeline.get()
  if (!pipeline) return
  const pass = c.encoder.beginComputePass({
    label: `Trillion3D heterogeneous volume shadow map ${label}`,
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, c.device.createBindGroup({ layout: stage.layout, entries }))
  pass.dispatchWorkgroups(...groups)
  pass.end()
}

/** The binding of the parameters of a pass that keeps every sample (no compression, no error bound), written at slot 0 of `uniform`. */
const plainParameters = (
  c: Encoding,
  uniform: GPUBuffer,
  resolution: Size,
  maxSampleCount: number,
) =>
  parameters(
    c,
    uniform,
    0,
    packAvsmParams({
      resolution,
      maxSampleCount,
      compress: false,
      absoluteError: 0,
      relativeError: 0,
    }),
  )

/** Writes `bytes` into the uniform buffer at slot `slot` and returns its binding. */
function parameters(
  c: Encoding,
  uniform: GPUBuffer,
  slot: number,
  bytes: ArrayBuffer,
): GPUBindGroupEntry {
  c.device.queue.writeBuffer(uniform, slot * VG_PARAMS_STRIDE, bytes)
  return {
    binding: 0,
    resource: { buffer: uniform, offset: slot * VG_PARAMS_STRIDE, size: bytes.byteLength },
  }
}

/**
 * A Beer shadow map as a volumetric shadow map: the allocator cleared, one dispatch over the map's groups, every group allocating its run of
 * the atlas. `parameters` is a uniform buffer; `allocator` holds one word.
 */
export function encodeConvertBeerToVolumetric(
  c: Encoding & {
    beerView: GPUTextureView
    resolution: Size
    allocator: GPUBuffer
    indirection: GPUBuffer
    atlas: GPUBuffer
    uniform: GPUBuffer
  },
) {
  c.encoder.clearBuffer(c.allocator, 0, 4)
  const params = plainParameters(c, c.uniform, c.resolution, 2)
  dispatch(
    c,
    c.passes.convertBeer,
    'convert from Beer',
    [
      params,
      { binding: 1, resource: c.beerView },
      { binding: 2, resource: { buffer: c.allocator } },
      { binding: 3, resource: { buffer: c.indirection } },
      { binding: 4, resource: { buffer: c.atlas } },
    ],
    groupsOf(c.resolution, 1),
  )
}

/** Clears a texture to transparent black by a render pass, as the clear of a storage texture the next pass writes (the texture is a render target too). */
export function clearTexture(encoder: GPUCommandEncoder, view: GPUTextureView) {
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D heterogeneous volume shadow map clear',
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
  })
  pass.end()
}

/** A volumetric shadow map as a Beer shadow map: the strip cleared to transparent, then written, the faces side by side. */
export function encodeConvertVolumetricToBeer(
  c: Encoding & {
    beerView: GPUTextureView
    resolution: Size
    faces: number
    maxSampleCount: number
    lists: GPUBuffer
    uniform: GPUBuffer
    /** Whether the strip is cleared first (a render pass: the texture is a render target); a strip of exactly the map's size is written whole. */
    clear?: boolean
  },
) {
  if (c.clear !== false) clearTexture(c.encoder, c.beerView)
  const params = plainParameters(c, c.uniform, c.resolution, c.maxSampleCount)
  dispatch(
    c,
    c.passes.convertToBeer,
    'convert to Beer',
    [params, { binding: 1, resource: { buffer: c.lists } }, { binding: 2, resource: c.beerView }],
    groupsOf(c.resolution, c.faces),
  )
}

/** The lists compressed into an indirection buffer and an atlas: the allocator cleared, one dispatch over the groups, the faces along z. */
export function encodeCompressVolumetricShadowMap(
  c: Encoding & {
    resolution: Size
    faces: number
    maxSampleCount: number
    lists: GPUBuffer
    allocator: GPUBuffer
    indirection: GPUBufferBinding
    atlas: GPUBufferBinding
    uniform: GPUBuffer
  },
) {
  c.encoder.clearBuffer(c.allocator, 0, 4)
  const params = plainParameters(c, c.uniform, c.resolution, c.maxSampleCount)
  dispatch(
    c,
    c.passes.compress,
    'compress',
    [
      params,
      { binding: 1, resource: { buffer: c.lists } },
      { binding: 2, resource: { buffer: c.allocator } },
      { binding: 3, resource: c.indirection },
      { binding: 4, resource: c.atlas },
    ],
    groupsOf(c.resolution, c.faces),
  )
}

/** Two lists combined into a third, texel by texel. */
export function encodeCombineVolumetricShadowMaps(
  c: Encoding & {
    resolution: Size
    faces: number
    maxSampleCount: number
    compress: boolean
    absoluteError: number
    relativeError: number
    listA: GPUBuffer
    listB: GPUBuffer
    combined: GPUBuffer
    uniform: GPUBuffer
  },
) {
  const params = parameters(c, c.uniform, 0, packAvsmParams(c))
  dispatch(
    c,
    c.passes.combine,
    'combine',
    [
      params,
      { binding: 1, resource: { buffer: c.listA } },
      { binding: 2, resource: { buffer: c.listB } },
      { binding: 3, resource: { buffer: c.combined } },
    ],
    groupsOf(c.resolution, c.faces),
  )
}

/** The parameters of the render (`AvsmRenderParams`): the faces' matrices from texel space to the world, column-major, up to six. */
export function packRenderParams(c: {
  resolution: Size
  maxSampleCount: number
  jitter: boolean
  stepSize: number
  maxStepCount: number
  debugTweak: number
  frameIndexMod8: number
  absoluteError: number
  relativeError: number
  compress: boolean
  temporalJitter: Size
  /** The point the samples' distances are measured from; none measures them from the start of each texel's ray. */
  distanceFrom?: readonly [number, number, number]
  shadowToWorld: readonly ArrayLike<number>[]
}): ArrayBuffer {
  const out = new ArrayBuffer(AVSM_RENDER_PARAMS_BYTES)
  const i = new Int32Array(out)
  const f = new Float32Array(out)
  i.set([...c.resolution, c.maxSampleCount, c.jitter ? 1 : 0], 0)
  f[4] = c.stepSize
  i.set([c.maxStepCount, c.debugTweak, c.frameIndexMod8], 5)
  f.set([c.absoluteError, c.relativeError], 8)
  i[10] = c.compress ? 1 : 0
  f.set(c.temporalJitter, 12)
  if (c.distanceFrom) f.set([...c.distanceFrom, 1], 16)
  c.shadowToWorld.forEach((m, k) => f.set(Array.from(m), 20 + 16 * k))
  return out
}

/**
 * The volumetric shadow map of a light or of the camera from the voxel grids: for a light the debug strip cleared first and the
 * allocator of its linked lists set to one sample a texel, for the camera the allocator alone; then one dispatch over the faces' groups.
 * `grids` is the grid parameters' uniform and `storage` the grids' buffers in the order the kernel binds them (the ortho grid's top
 * level, indirection and extinction cells, the frustum grid's top level and extinction cells).
 */
export function encodeRenderVolumetricShadowMap(
  c: Encoding & {
    kind: 'light' | 'camera'
    resolution: Size
    faces: number
    params: ArrayBuffer
    gridParams: ArrayBuffer
    uniform: GPUBuffer
    gridUniform: GPUBuffer
    storage: readonly [GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer, GPUBuffer]
    lists: GPUBuffer
    allocator: GPUBuffer
    debugView: GPUTextureView
    noiseView: GPUTextureView
  },
) {
  if (c.kind === 'light') clearTexture(c.encoder, c.debugView)
  c.device.queue.writeBuffer(c.allocator, 0, new Uint32Array([c.resolution[0] * c.resolution[1]]))
  c.device.queue.writeBuffer(c.gridUniform, 0, c.gridParams)
  dispatch(
    c,
    c.passes.render,
    c.kind === 'light' ? 'render for a light' : 'render for the camera',
    [
      parameters(c, c.uniform, 0, c.params),
      { binding: 1, resource: { buffer: c.gridUniform, size: c.gridParams.byteLength } },
      ...c.storage.map((buffer, k): GPUBindGroupEntry => ({
        binding: 2 + k,
        resource: { buffer },
      })),
      { binding: 7, resource: { buffer: c.lists } },
      { binding: 8, resource: c.debugView },
      { binding: 9, resource: c.noiseView },
    ],
    groupsOf(c.resolution, c.faces),
  )
}
