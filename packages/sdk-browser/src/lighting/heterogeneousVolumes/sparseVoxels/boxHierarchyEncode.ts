import { wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { VG_PARAMS_STRIDE } from '../voxelGrid/gridPasses.ts'
import { BOX_HEADER_WORDS, boxHeader, type boxLayout } from './boxHierarchyPlan.ts'
import {
  dispatch,
  encodeGenerateSparseVoxels,
  encodeSparseVoxelBoxes,
  type Encoding,
  type SparseVoxelScratch,
} from './sparseVoxelEncode.ts'
import { mipCountOf, mipVolumeResolution, voxelCountOf } from './sparseVoxelPlan.ts'
import { SV_PARAMS_BYTES } from './voxelDataWgsl.ts'

type Vec3 = readonly [number, number, number]

/** The uniform slots the min texture's levels take: one each. */
export const minLevelParameterSlots = (resolution: Vec3) => mipCountOf(resolution)

/** The bytes of the parameters of a min level (`MinParams`): the size of the level written, then 0 to copy or 1 to reduce. */
const packMinParams = (size: Vec3, reduce: boolean) => new Uint32Array([...size, reduce ? 1 : 0])

/**
 * The hierarchy of boxes of a volume of `resolution` voxels from its baked `extinction`: the min texture's levels, the sparse voxels cut out
 * of them from mip `bias` up (merged level by level with `refine`), the box of each voxel, and the hierarchy built over the voxels into `boxes`
 * (`boxLayout`). `minTexture` holds `mipCountOf(resolution)` levels; the scratch `parameters` of the generation, `boxParameters` (two slots,
 * the second unused) and `minParameters` (`minLevelParameterSlots` slots) are separate uniform buffers, `VG_PARAMS_STRIDE` apart.
 */
export function encodeBoxHierarchy(
  c: Encoding & {
    extinction: GPUTexture
    minTexture: GPUTexture
    resolution: Vec3
    bias: number
    refine: boolean
    boundsOrigin: Vec3
    boundsExtent: Vec3
    layout: ReturnType<typeof boxLayout>
    numVoxels: GPUBuffer
    voxels: GPUBuffer
    boxes: GPUBuffer
    scratch: SparseVoxelScratch
    boxParameters: GPUBuffer
    minParameters: GPUBuffer
  },
) {
  const levels = mipCountOf(c.resolution)
  const levelView = (level: number) =>
    c.minTexture.createView({ dimension: '3d', baseMipLevel: level, mipLevelCount: 1 })
  for (let level = 0; level < levels; level++) {
    const size = mipVolumeResolution(c.resolution, level)
    c.device.queue.writeBuffer(
      c.minParameters,
      level * VG_PARAMS_STRIDE,
      packMinParams(size, level > 0),
    )
    dispatch(
      c,
      c.passes.minLevel,
      'min level',
      [
        {
          binding: 0,
          resource: { buffer: c.minParameters, offset: level * VG_PARAMS_STRIDE, size: 16 },
        },
        { binding: 1, resource: level === 0 ? c.extinction.createView() : levelView(level - 1) },
        { binding: 2, resource: levelView(level) },
      ],
      size.map((n) => Math.ceil(n / 4)) as unknown as Vec3,
    )
  }
  const minResolution = mipVolumeResolution(c.resolution, c.bias)
  encodeGenerateSparseVoxels({
    ...c,
    minViewOf: (level) => levelView(c.bias + level),
    minResolution,
    mipCount: levels - c.bias,
    volumeResolution: c.resolution,
    mipLevel: c.bias,
  })
  const capacity = voxelCountOf(minResolution)
  encodeSparseVoxelBoxes({
    ...c,
    volumeResolution: c.resolution,
    positions: { buffer: c.boxes, offset: c.layout.positions * 4, size: capacity * 24 },
    args: c.scratch.args,
    parameters: c.boxParameters,
  })
  c.device.queue.writeBuffer(c.boxes, 0, boxHeader(c.resolution, c.layout))
  c.encoder.clearBuffer(c.boxes, BOX_HEADER_WORDS * 4, (c.layout.nodesEnd - BOX_HEADER_WORDS) * 4)
  dispatch(
    c,
    c.passes.hierarchy,
    'box hierarchy',
    [
      { binding: 0, resource: { buffer: c.boxParameters, size: SV_PARAMS_BYTES } },
      { binding: 1, resource: wholeBuffer(c.numVoxels) },
      { binding: 2, resource: wholeBuffer(c.voxels) },
      { binding: 3, resource: wholeBuffer(c.boxes) },
    ],
    { indirect: c.scratch.args },
  )
}
