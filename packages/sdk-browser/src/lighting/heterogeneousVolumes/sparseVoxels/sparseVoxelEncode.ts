import { wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { SV_PARAMS_BYTES } from './voxelDataWgsl.ts'
import { VG_PARAMS_STRIDE } from '../voxelGrid/gridPasses.ts'
import type { SparseVoxelPasses } from './sparseVoxelPasses.ts'
import { mipVolumeResolution } from './sparseVoxelPlan.ts'

type Vec3 = readonly [number, number, number]

/** The parameters of a pass (`SvParams`): the grid it reads, the level of the voxels it emits, the volume's resolution at mip 0 and its
 *  local bounds. */
export function packSparseVoxelParams(c: {
  resolution: Vec3
  mip: number
  volumeResolution: Vec3
  boundsOrigin: Vec3
  boundsExtent: Vec3
}): ArrayBuffer {
  const out = new ArrayBuffer(SV_PARAMS_BYTES)
  const u = new Uint32Array(out)
  const f = new Float32Array(out)
  u.set(c.resolution, 0)
  u[3] = c.mip
  u.set(c.volumeResolution, 4)
  f.set(c.boundsOrigin, 8)
  f.set(c.boundsExtent, 12)
  return out
}

/** What a sparse voxel pass runs over: the device, the encoder, the pipelines. */
export interface Encoding {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly passes: SparseVoxelPasses
}

/** The scratch the generation takes: two counters and two lists the refinement ping-pongs between, the dispatch arguments, and the
 *  uniform slots of its passes (`VG_PARAMS_STRIDE` apart). */
export interface SparseVoxelScratch {
  readonly counters: readonly [GPUBuffer, GPUBuffer]
  readonly lists: readonly [GPUBuffer, GPUBuffer]
  readonly args: GPUBuffer
  readonly parameters: GPUBuffer
}

/** The uniform slots a generation takes over a texture of `mipCount` levels: the first step, each level of the refinement, its end. */
export const sparseVoxelParameterSlots = (mipCount: number) => mipCount + 1

/** One compute pass of a stage over `counts` workgroups on `entries`, or, with `indirect`, over the groups the buffer names. */
export function dispatch(
  c: Encoding,
  stage: { layout: GPUBindGroupLayout; pipeline: { get(): GPUComputePipeline | undefined } },
  label: string,
  entries: GPUBindGroupEntry[],
  size: Vec3 | { indirect: GPUBuffer },
) {
  const pipeline = stage.pipeline.get()
  if (!pipeline) return
  const group = c.device.createBindGroup({ layout: stage.layout, entries })
  const pass = c.encoder.beginComputePass({
    label: `Trillion3D heterogeneous volume sparse voxels ${label}`,
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  if ('indirect' in size) pass.dispatchWorkgroupsIndirect(size.indirect, 0)
  else pass.dispatchWorkgroups(...size)
  pass.end()
}

/**
 * The sparse voxels of a min texture: every voxel whose value is not zero, appended to `voxels` with its level, their count in `numVoxels`. With
 * `refine`, the voxels whose block of eight is filled are merged level by level into one voxel of the next, as far as the texture's levels go.
 * `minView` is a view of the texture's levels one at a time, as `minViewOf(level)` makes it. `parameters` is written now.
 */
export function encodeGenerateSparseVoxels(
  c: Encoding & {
    minViewOf: (level: number) => GPUTextureView
    minResolution: Vec3
    /** The levels the min texture holds. */
    mipCount: number
    volumeResolution: Vec3
    boundsOrigin: Vec3
    boundsExtent: Vec3
    mipLevel: number
    refine: boolean
    numVoxels: GPUBuffer
    voxels: GPUBuffer
    scratch: SparseVoxelScratch
  },
) {
  const { passes, scratch: s } = c
  const slot = (n: number, resolution: Vec3, mip: number): GPUBindGroupEntry => {
    c.device.queue.writeBuffer(
      s.parameters,
      n * VG_PARAMS_STRIDE,
      packSparseVoxelParams({
        resolution,
        mip,
        volumeResolution: c.volumeResolution,
        boundsOrigin: c.boundsOrigin,
        boundsExtent: c.boundsExtent,
      }),
    )
    return {
      binding: 0,
      resource: { buffer: s.parameters, offset: n * VG_PARAMS_STRIDE, size: SV_PARAMS_BYTES },
    }
  }
  const clear = (counter: GPUBuffer) =>
    dispatch(c, passes.clear, 'clear', [{ binding: 0, resource: wholeBuffer(counter) }], [1, 1, 1])
  const groups = (resolution: Vec3) => resolution.map((n) => Math.ceil(n / 4)) as unknown as Vec3

  clear(c.numVoxels)
  if (!c.refine) {
    dispatch(
      c,
      passes.allocate,
      'allocate',
      [
        slot(0, c.minResolution, c.mipLevel),
        { binding: 1, resource: c.minViewOf(0) },
        { binding: 2, resource: wholeBuffer(c.numVoxels) },
        { binding: 3, resource: wholeBuffer(c.voxels) },
      ],
      groups(c.minResolution),
    )
    return
  }
  // The first step runs over the dense first level; the lists then go level to level, the one read and the one written taking turns.
  let input = 0
  let output = 1
  clear(s.counters[output])
  dispatch(
    c,
    passes.allocateToRefine,
    'allocate to refine',
    [
      slot(0, c.minResolution, c.mipLevel),
      { binding: 1, resource: c.minViewOf(0) },
      { binding: 2, resource: wholeBuffer(c.numVoxels) },
      { binding: 3, resource: wholeBuffer(c.voxels) },
      { binding: 4, resource: wholeBuffer(s.counters[output]) },
      { binding: 5, resource: wholeBuffer(s.lists[output]) },
    ],
    groups(c.minResolution),
  )
  ;[input, output] = [output, input]
  const levels = c.mipCount
  const groupArgs = (counter: GPUBuffer) =>
    dispatch(
      c,
      passes.groupArgs,
      'group arguments',
      [
        { binding: 0, resource: wholeBuffer(counter) },
        { binding: 1, resource: wholeBuffer(s.args) },
      ],
      [1, 1, 1],
    )
  for (let level = 1; level < levels; level++) {
    clear(s.counters[output])
    groupArgs(s.counters[input])
    dispatch(
      c,
      passes.refine,
      'refine',
      [
        slot(level, mipVolumeResolution(c.minResolution, level), c.mipLevel + level),
        { binding: 1, resource: c.minViewOf(level) },
        { binding: 2, resource: wholeBuffer(s.counters[input]) },
        { binding: 3, resource: wholeBuffer(s.lists[input]) },
        { binding: 4, resource: wholeBuffer(s.counters[output]) },
        { binding: 5, resource: wholeBuffer(s.lists[output]) },
        { binding: 6, resource: wholeBuffer(c.numVoxels) },
        { binding: 7, resource: wholeBuffer(c.voxels) },
      ],
      { indirect: s.args },
    )
    ;[input, output] = [output, input]
  }
  // What the last level merged up is final.
  groupArgs(s.counters[input])
  dispatch(
    c,
    passes.flush,
    'flush',
    [
      slot(levels, c.minResolution, c.mipLevel),
      { binding: 1, resource: wholeBuffer(s.counters[input]) },
      { binding: 2, resource: wholeBuffer(s.lists[input]) },
      { binding: 3, resource: wholeBuffer(c.numVoxels) },
      { binding: 4, resource: wholeBuffer(c.voxels) },
    ],
    { indirect: s.args },
  )
}

/**
 * The boxes of the acceleration structure over the sparse voxels: six floats a voxel into `positions` (made for every voxel the grid of
 * `mipLevel` can hold), over the voxels `numVoxels` counts. `parameters` and `args` are as the generation's.
 */
export function encodeSparseVoxelBoxes(
  c: Encoding & {
    volumeResolution: Vec3
    boundsOrigin: Vec3
    boundsExtent: Vec3
    numVoxels: GPUBuffer
    voxels: GPUBuffer
    positions: GPUBufferBinding
    args: GPUBuffer
    parameters: GPUBuffer
  },
) {
  c.device.queue.writeBuffer(
    c.parameters,
    0,
    packSparseVoxelParams({
      resolution: c.volumeResolution,
      mip: 0,
      volumeResolution: c.volumeResolution,
      boundsOrigin: c.boundsOrigin,
      boundsExtent: c.boundsExtent,
    }),
  )
  dispatch(
    c,
    c.passes.groupArgs,
    'group arguments',
    [
      { binding: 0, resource: wholeBuffer(c.numVoxels) },
      { binding: 1, resource: wholeBuffer(c.args) },
    ],
    [1, 1, 1],
  )
  dispatch(
    c,
    c.passes.blas,
    'boxes',
    [
      { binding: 0, resource: { buffer: c.parameters, size: SV_PARAMS_BYTES } },
      { binding: 1, resource: wholeBuffer(c.numVoxels) },
      { binding: 2, resource: wholeBuffer(c.voxels) },
      { binding: 3, resource: c.positions },
    ],
    { indirect: c.args },
  )
}
