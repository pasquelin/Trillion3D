import { PROBE_FLOATS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { TABLE_LANES } from '../../../../sdk-core/src/bounce/probeSlots.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { computeStorageTextureEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/**
 * THE BOUNCE ATLAS: the probes and the table that names them are one float texture read with
 * `textureLoad` and written by compute passes as a storage texture, not a storage buffer: the
 * deferred lighting holds its storage buffers within the eight WebGPU guarantees, and its sampled
 * textures within the sixteen. `rgba32float` keeps every value bit for bit. Two layers of the same
 * extent (`probeAtlasExtent`): the pool's probes, `PROBE_TEXELS` texels each, `POOL_ROW_PROBES`
 * along a row; and the table, `TABLE_LANES` entries a texel — one entry a cell of every level, the
 * slot + 1 of the probe that holds it or zero —, laid out in the order of `ProbeSlots.entryAt`. No
 * entry is ever dropped: a size the device cannot hold is refused before anything is made
 * (`limits.ts`).
 */
export const BOUNCE_ATLAS_FORMAT: GPUTextureFormat = 'rgba32float'

/** Vectors of a probe: its texels in the atlas. */
export const PROBE_TEXELS = PROBE_FLOATS / 4

/** Probes along a row of the pool's layer: a power of two, so that a slot's row is a shift. */
const POOL_ROW_PROBES = 128

/** The layers of the atlas: the pool's probes, then the table that names them. */
const POOL_LAYER = 0
export const TABLE_LAYER = 1
const ATLAS_LAYERS = 2

/** Texels along a row of either layer. */
export const ATLAS_WIDTH = POOL_ROW_PROBES * PROBE_TEXELS

/**
 * The probes' atlas for a pool of `pool` probes and a table of `entries` entries: width, height and
 * layers, the pool's rows and the table's rows each within the height.
 */
export const probeAtlasExtent = (pool: number, entries: number): [number, number, number] => [
  ATLAS_WIDTH,
  Math.max(1, ceilDiv(pool, POOL_ROW_PROBES), ceilDiv(ceilDiv(entries, TABLE_LANES), ATLAS_WIDTH)),
  ATLAS_LAYERS,
]

/** Bytes of a bounce atlas of this extent. */
export const atlasBytes = (extent: readonly number[]) =>
  textureBytesOf({ size: extent, format: BOUNCE_ATLAS_FORMAT })!

/** The layout entry of a bounce atlas at `binding`, its two layers: read with `textureLoad`, or
 *  written as a storage texture when `out`. */
export const atlasEntry = (binding: number, out = false) =>
  out
    ? computeStorageTextureEntry(binding, BOUNCE_ATLAS_FORMAT, 'write-only', '2d-array')
    : computeTextureEntry(binding, 'unfilterable-float', '2d-array')

/** The texel of vector `k` of the probe whose first texel is `probe` — column, row, layer
 *  (`poolProbe`) —: `k` columns further on its row, with no division; the one address its
 *  reads (`probeAt`), the update's stores and the snapshot's copies take. `poolProbe`: the first
 *  texel of the pool's slot `slot`. `tableEntry`: the slot + 1 the table names for an entry, zero for
 *  none — the entry's texel, and its lane in it. */
export const PROBE_AT_WGSL = wgslBlock(
  'PROBE_AT_WGSL',
  [],
  `${wgslConsts({
    PROBE_TEXELS,
    POOL_ROW_SHIFT: Math.log2(POOL_ROW_PROBES),
    POOL_ROW_MASK: POOL_ROW_PROBES - 1,
    TABLE_WIDTH: ATLAS_WIDTH,
    POOL_LAYER,
    TABLE_LAYER,
    TABLE_LANES,
  })}
fn probeTexel(probe:vec3u,k:u32)->vec2u{return vec2u(probe.x+k,probe.y);}
fn probeAt(probe:vec3u,k:u32)->vec4f{
 return textureLoad(probes,probeTexel(probe,k),probe.z,0);
}
fn poolProbe(slot:u32)->vec3u{
 return vec3u((slot&POOL_ROW_MASK)*PROBE_TEXELS,slot>>POOL_ROW_SHIFT,POOL_LAYER);
}
fn tableEntry(entry:u32)->u32{
 let texel=entry/TABLE_LANES;
 let lanes=textureLoad(probes,vec2u(texel%TABLE_WIDTH,texel/TABLE_WIDTH),TABLE_LAYER,0);
 return u32(lanes[entry%TABLE_LANES]);
}`,
)
