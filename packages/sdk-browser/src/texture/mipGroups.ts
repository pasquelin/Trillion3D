import { coverageGroups, LEVEL_BIN_BYTES } from './coverageMips.ts'
import { levelSize } from './tiles.ts'
import { levelView, MATERIAL_MIP_FORMAT, materialMipPipeline } from './mips.ts'
import { sameEntries } from '../gpu/core/sameEntries.ts'

/** One texture of a batch: its pool format — its levels stored as `materialMipTexture` says —, its
 *  size, its colour rule — weighted by alpha when every reader takes alpha for coverage, in
 *  straight alpha (`../webgpu/tile/scratch.ts`) — and its readers' cutoff (`CoverageReaders.cutoff`),
 *  0 for none. */
export type MipChain = {
  texture: GPUTexture
  format: GPUTextureFormat
  width: number
  height: number
  weighted: boolean
  cutoff?: number
}

/** A chain of a batch: its texture's rule and size, its levels, its first uniform block, and its
 *  bins' first byte when it cuts its coverage. */
export type ChainPlace = {
  chain: Omit<MipChain, 'cutoff'>
  levels: number
  first: number
  bins?: number
}

/** The buffers a batch binds: its uniforms, their stride, and the bins. */
export type BatchBuffers = { uniforms: GPUBuffer; stride: number; bins: GPUBuffer }

/** What a texture keeps for its reductions: its level views — read in the pool format, written
 *  through its own; one list when they are the same —, and its groups with the batch place and
 *  buffers they were made for. */
type Held = {
  reads: GPUTextureView[]
  writes: GPUTextureView[]
  /** The batch place its groups were made for, and its level sizes. */
  place: unknown[]
  sizes: (readonly [number, number])[]
  reduce: GPUBindGroup[]
  counts?: GPUBindGroup[]
}
const held = new WeakMap<GPUTexture, Held>()
/** The place a chain is asked at, compared with its held one. */
const probe: unknown[] = []

/** The views of `texture`'s first `count` mip levels, one a level, in `format` when given
 *  (`levelView`). */
export const levelViews = (
  texture: GPUTexture,
  count = texture.mipLevelCount,
  format?: GPUTextureFormat,
) => Array.from({ length: count }, (_, level) => levelView(texture, level, format))

/**
 * The dispatch inputs of one chain of a batch: its pipeline, its level sizes, the group reducing
 * each level from the one above (`reduce[level - 1]`) and its count groups when it cuts. Views are
 * made once per texture; groups once per batch place — the uniform block it starts at, its bins,
 * the buffers' identities —: a live texture reduced alone at every new picture makes neither
 * again.
 */
export function chainGroups(
  device: GPUDevice,
  shared: GPUDevice,
  { chain, levels, first, bins: at }: ChainPlace,
  { uniforms, stride, bins }: BatchBuffers,
) {
  const { texture, format, width, height, weighted } = chain
  const { layout, pipeline } = materialMipPipeline(shared, format, weighted)
  let kept = held.get(texture)
  if (!kept || kept.reads.length < levels) {
    const reads = levelViews(texture, levels, format)
    const writes = format === MATERIAL_MIP_FORMAT ? reads : levelViews(texture, levels)
    held.set(texture, (kept = { reads, writes, place: [], sizes: [], reduce: [] }))
  }
  // The place written in one held array: nothing allocated while it holds.
  probe.length = 0
  probe.push(layout, uniforms, bins, stride, first, at, levels)
  if (!sameEntries(kept.place, probe)) {
    const { reads, writes } = kept
    const cover: GPUBufferBinding =
      at === undefined
        ? { buffer: bins, offset: 0, size: LEVEL_BIN_BYTES }
        : { buffer: bins, offset: at, size: levels * LEVEL_BIN_BYTES }
    // Group `level - 1` reduces level `level` from the one above.
    kept.reduce = Array.from({ length: levels - 1 }, (_, above) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: reads[above] },
          {
            binding: 1,
            resource: { buffer: uniforms, offset: (first + above + 1) * stride, size: 32 },
          },
          { binding: 2, resource: cover },
          { binding: 3, resource: writes[above + 1] },
        ],
      }),
    )
    kept.counts =
      at === undefined
        ? undefined
        : coverageGroups(device, { views: reads, uniforms, first, stride, bins: cover }, levels)
    kept.place = probe.slice()
    kept.sizes = Array.from({ length: levels }, (_, level) => levelSize(width, height, level))
  }
  return { levels, sizes: kept.sizes, pipeline, reduce: kept.reduce, counts: kept.counts }
}

export type ChainGroups = ReturnType<typeof chainGroups>
