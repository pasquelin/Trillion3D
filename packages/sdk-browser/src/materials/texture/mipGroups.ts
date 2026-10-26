import { previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import { levelTurnPipeline, levelView, MATERIAL_MIP_FORMAT, materialMipPipeline } from './mips.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'

/** Bytes of a level's uniform block (`LEVEL_WGSL`, `mipsWgsl.ts`). */
export const LEVEL_BYTES = 16

/** One texture of a batch: its pool format — its levels stored as `materialMipTexture` says — and
 *  its size. */
export type MipChain = {
  texture: GPUTexture
  format: GPUTextureFormat
  width: number
  height: number
  /** Raw texels to store into level 0 turned by `flags` (`turnLevel`, `mipsWgsl.ts`) before any
   *  level reads it: what `writeTexture` put in `raw`, an `rgba8unorm` texture of the picture's
   *  size. */
  turn?: { raw: GPUTexture; flags: number }
}

/** A chain of a batch: its texture and size, its levels and its first uniform block. */
export type ChainPlace = { chain: MipChain; levels: number; first: number }

/** The buffer a batch binds: its uniforms, and their stride. */
export type BatchBuffers = { uniforms: GPUBuffer; stride: number }

/** What a texture keeps for its reductions: its level views — read in the pool format, written
 *  through its own; one list when they are the same —, and its groups with the identity of the
 *  batch place and buffers they were made for. */
type Held = {
  reads: GPUTextureView[]
  writes: GPUTextureView[]
  /** The batch place its groups were made for (`createWebgpuBindIdentity`), and its level sizes. */
  place: WebgpuBindIdentity
  sizes: (readonly [number, number])[]
  reduce: GPUBindGroup[]
}
// Kept with the texture, as long as it: the batches reduce many textures at once, each its own
// groups (`bindIdentity.ts`, its one exception).
const held = new WeakMap<GPUTexture, Held>()

/** The views of `texture`'s first `count` mip levels, one a level, in `format` when given
 *  (`levelView`). */
const levelViews = (
  texture: GPUTexture,
  count = texture.mipLevelCount,
  format?: GPUTextureFormat,
) => Array.from({ length: count }, (_, level) => levelView(texture, level, format))

/**
 * The dispatch inputs of one chain of a batch: its pipeline, its level sizes and the group reducing
 * each level from the one above (`reduce[level - 1]`). Views are made once per texture; groups once
 * per batch place — the uniform block it starts at, the buffer's identity —: a live texture
 * reduced alone at every new picture makes neither again.
 */
export function chainGroups(
  device: GPUDevice,
  shared: GPUDevice,
  { chain, levels, first }: ChainPlace,
  { uniforms, stride }: BatchBuffers,
) {
  const { texture, format, width, height } = chain
  const { layout, pipeline } = materialMipPipeline(shared, format)
  let kept = held.get(texture)
  if (!kept || kept.reads.length < levels) {
    const reads = levelViews(texture, levels, format)
    const writes = format === MATERIAL_MIP_FORMAT ? reads : levelViews(texture, levels)
    held.set(
      texture,
      (kept = { reads, writes, place: createWebgpuBindIdentity(), sizes: [], reduce: [] }),
    )
  }
  // The place written in the identity's one array: nothing allocated while it holds.
  const { next } = kept.place
  next[0] = layout
  next[1] = uniforms
  next[2] = stride
  next[3] = first
  next[4] = levels
  if (kept.place.moved()) {
    const { reads, writes } = kept
    // Group `level - 1` reduces level `level` from the one above.
    kept.reduce = Array.from({ length: levels - 1 }, (_, above) =>
      device.createBindGroup({
        layout,
        entries: sequentialEntries([
          reads[above],
          { buffer: uniforms, offset: (first + above + 1) * stride, size: LEVEL_BYTES },
          writes[above + 1],
        ]),
      }),
    )
    kept.sizes = Array.from({ length: levels }, (_, level) =>
      previewLevelSize(width, height, level),
    )
  }
  // The turn of level 0, on the reduction's layout: the raw texels its source, level 0 written.
  const turn = chain.turn && {
    pipeline: levelTurnPipeline(shared, chain.turn.flags),
    group: device.createBindGroup({
      layout,
      entries: sequentialEntries([
        chain.turn.raw.createView(),
        { buffer: uniforms, offset: first * stride, size: LEVEL_BYTES },
        kept.writes[0],
      ]),
    }),
  }
  // A chain whose turn is not compiled reduces nothing: the levels would read an unwritten level 0.
  return {
    levels,
    sizes: kept.sizes,
    pipeline: turn && !turn.pipeline ? undefined : pipeline,
    reduce: kept.reduce,
    turn,
  }
}

export type ChainGroups = ReturnType<typeof chainGroups>
