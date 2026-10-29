import { VG_PARAMS_STRIDE, type VoxelGridPasses } from './gridPasses.ts'
import { topLevelBitmaskEntries } from './topLevelBitmaskWgsl.ts'
import { VG_CLEAR_ROW_WORDS } from './clearTopLevelWgsl.ts'
import { packMajorantParams } from './gridPack.ts'
import { VG_MAJORANT_PARAMS_BYTES } from './majorantWgsl.ts'

type Vec3 = readonly [number, number, number]

/** The cells of a grid of `resolution`. */
export const cellsOf = (resolution: Vec3) => resolution[0] * resolution[1] * resolution[2]

/** The workgroups that cover `resolution` cells in blocks of four a side. */
export const groupsOf = (resolution: Vec3) =>
  resolution.map((n) => Math.ceil(n / 4)) as unknown as Vec3

/** The bytes of the buffers a grid of `resolution` top-level cells holds: its cells, its bitmask, its majorants. */
export const gridBytes = (resolution: Vec3) => ({
  topLevel: cellsOf(resolution) * 4,
  bitmask: topLevelBitmaskEntries(resolution) * 8,
  majorant: cellsOf(resolution) * 8,
})

/** The resolutions of the grids the majorant is folded down: each a quarter of the one before a side, up to one cell. */
export function majorantChain(resolution: Vec3): Vec3[] {
  const chain: Vec3[] = []
  let size = resolution
  while (Math.max(...size) > 1) {
    size = size.map((n) => Math.ceil(n / 4)) as unknown as Vec3
    chain.push(size)
  }
  return chain
}

/** Runs `stage` over `counts` workgroups on `group` (its dynamic offsets `offsets`); nothing while the stage is not compiled, the frame is held for it. */
export function run(
  pass: GPUComputePassEncoder,
  stage: { get(): GPUComputePipeline | undefined },
  group: GPUBindGroup,
  counts: Vec3,
  offsets?: number[],
) {
  const pipeline = stage.get()
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group, offsets)
  pass.dispatchWorkgroups(...counts)
}

export interface Encoding {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly passes: VoxelGridPasses
}

/** Clears the top level of `resolution` cells in `topLevel` to the empty cell. */
export function encodeClearTopLevel(c: Encoding & { topLevel: GPUBuffer; resolution: Vec3 }) {
  const rows = Math.ceil(cellsOf(c.resolution) / VG_CLEAR_ROW_WORDS)
  const group = c.device.createBindGroup({
    layout: c.passes.clear.layout,
    entries: [{ binding: 0, resource: { buffer: c.topLevel, size: cellsOf(c.resolution) * 4 } }],
  })
  const pass = c.encoder.beginComputePass({ label: 'Trillion3D heterogeneous volume grid clear' })
  run(pass, c.passes.clear.pipeline, group, [256, rows, 1])
  pass.end()
}

/**
 * One dispatch a volume over the top level, each reading its parameters from its own slot of `uniform` (`params`, one entry a volume,
 * written now) at a dynamic offset: the voxel size pass and the frustum marking pass.
 */
export function encodePerVolume(
  c: Encoding & {
    stage: VoxelGridPasses['voxelSize']
    topLevel: GPUBuffer
    uniform: GPUBuffer
    params: readonly ArrayBuffer[]
    resolution: Vec3
    label: string
  },
) {
  if (!c.params.length) return
  c.params.forEach((bytes, i) => c.device.queue.writeBuffer(c.uniform, i * VG_PARAMS_STRIDE, bytes))
  const group = c.device.createBindGroup({
    layout: c.stage.layout,
    entries: [
      { binding: 0, resource: { buffer: c.uniform, size: c.params[0].byteLength } },
      { binding: 1, resource: { buffer: c.topLevel, size: cellsOf(c.resolution) * 4 } },
    ],
  })
  const counts = groupsOf(c.resolution)
  const pass = c.encoder.beginComputePass({ label: c.label })
  c.params.forEach((_, i) => run(pass, c.stage.pipeline, group, counts, [i * VG_PARAMS_STRIDE]))
  pass.end()
}

/** The bitmask of the non-empty top-level cells, in `bitmask` (cleared before); one dispatch over the blocks of four cells. `uniform` holds
 *  the resolution (four ints) and is written now. */
export function encodeTopLevelBitmask(
  c: Encoding & { topLevel: GPUBuffer; bitmask: GPUBuffer; uniform: GPUBuffer; resolution: Vec3 },
) {
  c.encoder.clearBuffer(c.bitmask, 0, topLevelBitmaskEntries(c.resolution) * 8)
  c.device.queue.writeBuffer(c.uniform, 0, new Int32Array([...c.resolution, 0]))
  const group = c.device.createBindGroup({
    layout: c.passes.bitmask.layout,
    entries: [
      { binding: 0, resource: { buffer: c.uniform, size: 16 } },
      { binding: 1, resource: { buffer: c.topLevel, size: cellsOf(c.resolution) * 4 } },
      { binding: 2, resource: { buffer: c.bitmask } },
    ],
  })
  const pass = c.encoder.beginComputePass({ label: 'Trillion3D heterogeneous volume grid bitmask' })
  run(pass, c.passes.bitmask.pipeline, group, groupsOf(c.resolution))
  pass.end()
}

/** The bytes of each of the two scratch grids the majorant's chain ping-pongs between: the first, the largest, of the chain (256 at least). */
export const chainBytes = (resolution: Vec3) => {
  const [first] = majorantChain(resolution)
  return Math.max(256, first ? cellsOf(first) * 8 : 0)
}

/**
 * The majorant grid in `majorant` (a cell of two words per top-level cell): the greatest extinction of each cell's bottom level; and,
 * with `maximum`, the chain of grids four times coarser down to one cell, folded by the greatest, whose one value is then written into the
 * first cell of the majorant grid. `parameters` holds the uniform slots of the passes (`VG_PARAMS_STRIDE` apart, written now) and `chain` the
 * two scratch grids (`chainBytes` each) the folds take turns in.
 */
export function encodeMajorantGrid(
  c: Encoding & {
    topLevel: GPUBuffer
    indirection: GPUBuffer
    extinction: GPUBuffer
    majorant: GPUBuffer
    chain: readonly [GPUBuffer, GPUBuffer]
    parameters: GPUBuffer
    resolution: Vec3
    indirectionGrid: boolean
    maximum: boolean
  },
) {
  const { device, passes } = c
  const sizes = c.maximum ? majorantChain(c.resolution) : []
  const inputSizes = [c.resolution, ...sizes.slice(0, -1)]
  ;[c.resolution, ...inputSizes].forEach((input, slot) =>
    device.queue.writeBuffer(
      c.parameters,
      slot * VG_PARAMS_STRIDE,
      packMajorantParams(c.resolution, c.indirectionGrid, input),
    ),
  )
  const bind = (
    stage: VoxelGridPasses['buildMajorant'],
    slot: number,
    input: GPUBuffer,
    output: GPUBuffer,
  ) =>
    device.createBindGroup({
      layout: stage.layout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: c.parameters,
            offset: slot * VG_PARAMS_STRIDE,
            size: VG_MAJORANT_PARAMS_BYTES,
          },
        },
        { binding: 1, resource: { buffer: c.topLevel } },
        { binding: 2, resource: { buffer: c.indirection } },
        { binding: 3, resource: { buffer: c.extinction } },
        { binding: 4, resource: { buffer: input } },
        { binding: 5, resource: { buffer: output } },
      ],
    })
  const pass = c.encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume grid majorant',
  })
  // The build reads no input grid; a scratch one stands in, as a buffer may not be read and written by the same dispatch.
  run(
    pass,
    passes.buildMajorant.pipeline,
    bind(passes.buildMajorant, 0, c.chain[0], c.majorant),
    groupsOf(c.resolution),
  )
  sizes.forEach((size, k) =>
    run(
      pass,
      passes.downsampleMajorant.pipeline,
      bind(
        passes.downsampleMajorant,
        1 + k,
        k === 0 ? c.majorant : c.chain[(k - 1) % 2],
        c.chain[k % 2],
      ),
      size,
    ),
  )
  if (sizes.length)
    run(
      pass,
      passes.copyMaximum.pipeline,
      bind(passes.copyMaximum, 0, c.chain[(sizes.length - 1) % 2], c.majorant),
      [1, 1, 1],
    )
  pass.end()
}
