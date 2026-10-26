import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { computeStorageTextureEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/**
 * THE CELL TABLE: the one float texture that names, for each cell of every level, the slot of the probe that holds it (the pool's,
 * `pool/poolWgsl.ts`) — read with `textureLoad`, written by the pool as a storage texture, not a storage buffer: the lit passes hold their
 * storage buffers within the eight WebGPU guarantees. `rgba32float` keeps every slot bit for bit; `TABLE_LANES` entries a texel, one
 * entry a cell, in the order of `cellEntry` (`gridWgsl.ts`), the slot + 1 of the probe or zero. One layer. No entry is ever dropped: a
 * size the device cannot hold is refused before anything is made (`limits.ts`).
 */
export const BOUNCE_ATLAS_FORMAT: GPUTextureFormat = 'rgba32float'

/** Entries of the table a texel holds, one lane each. */
export const TABLE_LANES = 4

/** Probes along a row of the maps the radiance cache keeps (`cache/cacheLayout.ts`): a power of two, so that a slot's row is a shift. */
export const POOL_ROW_PROBES = 128

/** Texels along a row of the table, and its one layer. */
export const TABLE_WIDTH = 1024
export const TABLE_LAYER = 0

/** The table's width, height and layers for `entries` entries. */
export const tableExtent = (entries: number): [number, number, number] => [
  TABLE_WIDTH,
  Math.max(1, ceilDiv(ceilDiv(entries, TABLE_LANES), TABLE_WIDTH)),
  1,
]

/** Bytes of a table of this extent. */
export const tableBytes = (extent: readonly number[]) =>
  textureBytesOf({ size: extent, format: BOUNCE_ATLAS_FORMAT })!

/** The layout entry of the table at `binding`: read with `textureLoad`, or written as a storage texture when `out`. */
export const atlasEntry = (binding: number, out = false) =>
  out
    ? computeStorageTextureEntry(binding, BOUNCE_ATLAS_FORMAT, 'write-only', '2d-array')
    : computeTextureEntry(binding, 'unfilterable-float', '2d-array')

/** `tableEntry`: the slot + 1 the table names for an entry, zero for none — the entry's texel, and its lane in it. */
export const TABLE_AT_WGSL = wgslBlock(
  'TABLE_AT_WGSL',
  [],
  `${wgslConsts({ TABLE_WIDTH, TABLE_LAYER, TABLE_LANES })}
fn tableEntry(entry:u32)->u32{
 let texel=entry/TABLE_LANES;
 let lanes=textureLoad(cellTable,vec2u(texel%TABLE_WIDTH,texel/TABLE_WIDTH),TABLE_LAYER,0);
 return u32(lanes[entry%TABLE_LANES]);
}`,
)
