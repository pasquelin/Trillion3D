import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { alignUp } from '../../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'

/**
 * Virtual shadow map constants: layout, page and kernel sizes, and the defaults of the tunables.
 * Each value is derived from another one where it can be; otherwise it is declared: what it
 * stands for, and what moving it does (its sensitivity). None is tuned on a scene.
 *
 * UNITS. The world unit is the metre, but the clipmap's level arithmetic is in centimetres. Every
 * distance below is converted explicitly (the centimetre value is in the comment). Clipmap levels
 * are log2 of a distance IN CENTIMETRES (`vsmClipmapLevelRadiusCm`, clipmap.ts): a level's radius
 * is 2^(level + 1) cm, a power of two of the centimetre, which no power of two of the metre gives
 * (100 is none), so the unit is part of the cascades' sizes. Unitless values (ratios, texels,
 * pages, frames, level biases) are kept as they are.
 */

/** Centimetres per world unit (metre). */
export const VSM_CM_PER_UNIT = 100
/** World units per centimetre. */
export const VSM_UNIT_PER_CM = 1 / VSM_CM_PER_UNIT

// ---- Page and table geometry -----------------------------------------------------------------
/** Declared: a page is 128 × 128 texels, 64 KiB of 32-bit depth, the unit the pool allocates, the
 *  raster draws and the cache keeps. Half of it quadruples the table entries and the per-page work
 *  for the same area; twice it quadruples what a page partly covered wastes. */
export const VSM_LOG2_PAGE = 7
export const VSM_PAGE_TEXELS = 1 << VSM_LOG2_PAGE // 128
const VSM_PAGE_TEXEL_MASK = VSM_PAGE_TEXELS - 1
/** Declared: level 0 of a map is 128 pages a side. Derived from it: the mips down to one page
 *  (log2 128 + 1 = 8) and the map's width in texels (128 pages of 128 texels = 16384). */
const VSM_LOG2_LEVEL0_PAGES = 7
export const VSM_LEVEL0_PAGES = 1 << VSM_LOG2_LEVEL0_PAGES // 128
export const VSM_MIPS = VSM_LOG2_LEVEL0_PAGES + 1 // 8
export const VSM_LEVEL0_TEXELS = VSM_LEVEL0_PAGES * VSM_PAGE_TEXELS // 16384
/** The raster marks: a word per physical page in each of six slices, the bits the raster marks a
 *  page with (`vsmRasterMarkBits`): dynamic drawn, static drawn, dynamic invalidated, static
 *  invalidated, an offset allowed, a level of detail behind; folded into the page's metadata after the
 *  raster. One word follows the slices: the frame's count of deferred invalidations carried out. */
export const VSM_DIRTY_SLICES = 6
/** The occlusion pyramid's levels (`occlusion/`): a page's halvings from half its side to one
 *  texel, 64 to 1 texels a page — log2 of the page side. */
export const VSM_PYRAMID_MIPS = Math.log2(VSM_PAGE_TEXELS)
/** Texels a row of the kept stale rects (`occlusion/occlusionResources.ts`, rgba32uint): 4096
 *  bytes, a whole number of the 256-byte rows a buffer-to-texture copy takes. */
export const VSM_KEPT_RECTS_WIDTH = 256
const VSM_LOG2_COVER_CELLS = 3
const VSM_COVER_CELL_MASK = 3
/** One full map's page table block: `VSM_LEVEL0_PAGES` wide, 128 + 64 tall (mip tail below level 0). */
export const VSM_PAGE_TABLE_BLOCK_HEIGHT = VSM_LEVEL0_PAGES + VSM_LEVEL0_PAGES / 2 // 192

// Flags of a projection record: one bit each, in a row.
export const VSM_MAP_UNCACHED = 1 << 0
export const VSM_MAP_UNSEEN = 1 << 1
export const VSM_MAP_COARSE = 1 << 2
export const VSM_MAP_COVERAGE = 1 << 3
/** A map's coarse pages keep their dynamic layer from frame to frame: neither the receiver cover
 *  nor a mover's box redraws it (`invalidationWgsl.ts`, `physicalPagesWgsl.ts`); a static change,
 *  which stales both layers, alone draws them again. */
export const VSM_MAP_COARSE_KEEPS_DYNAMIC = 1 << 4
/** A map of a sun's first-person clipmap: only the objects that stand for a first-person one are drawn
 *  into it, and the regular maps leave them out. */
export const VSM_MAP_FIRST_PERSON = 1 << 5
/** A local light's map of one page, its last mip alone: the light is distant (`vsmDistantOf`: the
 *  distant mode asks it, or asks it of the lights whose finest mip is the last). Bit 6 is the
 *  prefiltered distant shadow's (`VSM_MAP_PREFILTERED_DISTANT`). */
export const VSM_MAP_DISTANT = 1 << 7

// The page counters the engine reads back (`engineVsm.ts` readVsmStats), one word each, in a row.
export const VSM_COUNT_WANTED = 0
export const VSM_COUNT_STATIC_KEPT = 1
export const VSM_COUNT_DYNAMIC_KEPT = 2
export const VSM_COUNT_CLEARED = 3
export const VSM_COUNT_GRANTED = 4
/** Pool pages left with no word, free for the next grant. */
export const VSM_COUNT_EMPTY_PAGES = 5
/** Held pages that an offset is allowed on, cached whole: not drawn, but their dynamic layer is
 *  considered by the raster's cull. */
export const VSM_COUNT_WPO_CONSIDERED = 6
/** The counters of the stats buffer, which the word after them follows: the frame's overflow flags
 *  (`VSM_OVERFLOW_*`), written whatever the counters say and read back every frame. A shader names
 *  that word `VSM_OVERFLOW_FLAGS` (`overflowWgsl.ts`). */
export const VSM_COUNTERS = 7
/** Words of the stats buffer: the counters and the overflow flags. */
export const VSM_STATS_WORDS = VSM_COUNTERS + 1
/** The overflow flags, one bit each: the one-pass projection's lights past its mask, the page pool,
 *  the casters' list past its room and the raster's records list past its room. */
export const VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS = 1 << 0
export const VSM_OVERFLOW_PAGE_POOL = 1 << 1
export const VSM_OVERFLOW_VISIBLE_INSTANCES = 1 << 2
export const VSM_OVERFLOW_RECORDS = 1 << 3
/** Set by the host's plan, not a pass: lights refused for want of map slots. */
export const VSM_OVERFLOW_MAP_SLOTS = 1 << 4
/** The overflow kinds in the order of their bits. */
export const VSM_OVERFLOW_KINDS = 5
/** Bits of a map's id in the records the cull emits, so the map slots a set holds: at most `1 << VSM_RECORD_MAP_ID_BITS`. */
const VSM_RECORD_MAP_ID_BITS = 16
/** The map ids a record names: the most maps a frame holds. */
export const VSM_RECORD_MAP_COUNT = 1 << VSM_RECORD_MAP_ID_BITS
export const VSM_FEEDBACK_POOL = 0
/** Bytes of the status feedback message (`res.feedback`): the message id (`VSM_FEEDBACK_POOL`), the free
 *  pages (i32) and the pressure bias (f32 bits), a word each. */
export const FEEDBACK_MESSAGE_BYTES = 12

/**
 * Bytes of a map's projection record (`projection/projectionData.ts`, `VsmProjectionRecord`): its four 4×4
 * float matrices (the fourth the occlusion's previous clip matrix), five rows of 16 bytes (four of a
 * 3-vector and a word, the previous view's depth terms) and sixteen words (four scalars, the
 * two-word corner, the range, the table's origin, a sun's far-shadow distance, the threshold its
 * offsets are left out past, the previous id, table origin and finest mip, the view slot and the
 * two-word dynamic depth range), at the 16-byte alignment its matrices give the struct.
 */
export const VSM_PROJECTION_RECORD_BYTES = 4 * 64 + 5 * 16 + alignUp(16 * 4, 16) // 400
/** Byte size of `VsmUniforms` (`uniforms.ts`, uniform address space). */
export const VSM_UNIFORMS_BYTES = 224

/** Bytes of one candidate of the raster's cull (`VsmRenderCandidate`, `render/renderParamsWgsl.ts`)
 *  and of one record it emits (vec4u, `render/renderCullWgsl.ts`). */
export const VSM_RENDER_CANDIDATE_BYTES = 208
export const VSM_RENDER_RECORD_BYTES = 16
/** Bytes of a light of the frame in the raster's table (`vsmWriteLights`): its first map's id, its map count and
 *  its lighting channels, padded to a `vec4u`. */
export const VSM_RENDER_LIGHT_BYTES = 16
/** Words of a light in that table, and in the shadow views' descent's `work`, which it is copied into
 *  (`traversal/traversalPass.ts`). */
export const VSM_LIGHT_WORDS = VSM_RENDER_LIGHT_BYTES / 4
/** The records one list of the raster holds: the cut's cap of visible clusters times the raster's
 *  indirection multiplier, never under 1 (`shadowRasterIndirectionMultiplier`, 1.5) - the
 *  reference's rule for its cluster indirections. */
export const vsmRecordCapacity = (visibleCap: number, indirectionMultiplier: number) =>
  Math.floor(visibleCap * Math.max(1, indirectionMultiplier))

// Flags of the next-frame data of a map.
export const VSM_NEXT_KEEPS_PAGES = 1 << 0
/** The previous id has a next id: the record names where its map went. */
export const VSM_NEXT_ID_VALID = 1 << 1

// ---- Page marks (hierarchical, OR-combined): what a page request or a mapped page says -------
const VSM_PAGE_WANTED = 1 << 0
const VSM_PAGE_DYNAMIC_STALE = 1 << 1
const VSM_PAGE_STATIC_STALE = 1 << 2
export const VSM_PAGE_FINE = 1 << 3
/** The page marks' bits: the four above. */
const VSM_PAGE_MARK_BITS = 4
const VSM_PAGE_MARK_MASK = (1 << VSM_PAGE_MARK_BITS) - 1
const VSM_PAGE_ANY_STALE = VSM_PAGE_DYNAMIC_STALE | VSM_PAGE_STATIC_STALE
const VSM_PAGE_TEST_ANY = VSM_PAGE_ANY_STALE | VSM_PAGE_WANTED

// The pool page info's own bits (never in the page-mark pyramid), above the page marks.
const VSM_META_DYNAMIC_CLEARED = 1 << (VSM_PAGE_MARK_BITS + 0)
const VSM_META_STATIC_CLEARED = 1 << (VSM_PAGE_MARK_BITS + 1)
const VSM_META_DYNAMIC_DRAWN = 1 << (VSM_PAGE_MARK_BITS + 2)
const VSM_META_STATIC_DRAWN = 1 << (VSM_PAGE_MARK_BITS + 3)
const VSM_META_DYNAMIC_STALE = 1 << (VSM_PAGE_MARK_BITS + 4)
const VSM_META_STATIC_STALE = 1 << (VSM_PAGE_MARK_BITS + 5)
const VSM_META_VIEW_UNCACHED = 1 << (VSM_PAGE_MARK_BITS + 6)
const VSM_META_UNSEEN = 1 << (VSM_PAGE_MARK_BITS + 7)
/** A page an offset is allowed on, considered by the raster's cull though cached whole (the next frame
 *  only), and a page whose invalidation waits for its budget. */
const VSM_META_FORCE_CACHED = 1 << (VSM_PAGE_MARK_BITS + 8)
const VSM_META_DEFERRED = 1 << (VSM_PAGE_MARK_BITS + 9)
const VSM_META_ANY_CLEARED = VSM_META_DYNAMIC_CLEARED | VSM_META_STATIC_CLEARED
const VSM_META_ANY_STALE = VSM_META_DYNAMIC_STALE | VSM_META_STATIC_STALE

// Page table entry bits ([0:9] phys X, [10:19] phys Y, [20:25] coarser levels).
export const VSM_ENTRY_DRAWABLE_BIT = 0x40000000
export const VSM_ENTRY_MAPPED_BIT = 0x80000000
/** Where an entry's coarser-level count lies: six bits from bit 20. */
export const VSM_ENTRY_COARSER_SHIFT = 20,
  VSM_ENTRY_COARSER_MASK = 0x3f

/** Kernel group sizes. */
export const VSM_GROUP_WIDTH = 256
/** Pixels a side of a projection group: 8, a power of two. */
export const VSM_PROJECTION_GROUP_SIZE = 8

/** Pool array slices: 0 dynamic, 1 static (with caching). */
export const VSM_POOL_SLICES = 2

/**
 * Declared: the width, in texels, of a row of the physical pool and of the page tables. The tables
 * are storage buffers with no 2D limit, so it only sets the layout: 16384 / 128 = 128 pool pages and
 * 16384 / 2 / 128 = 64 page tables a row; the pool is rounded up to whole rows (`vsmLayout`), the
 * one place it costs memory.
 */
export const VSM_TABLE_ROW_WIDTH = 16384

/** Declared: the depth term given to a projection without one (M[3][2] = 0), so that the
 *  perspective depth's 1 / M[3][2] stays finite. */
const VSM_ZERO_DEPTH_TERM = 0.00000001
/**
 * The guard taken off the w term of a perspective depth (`vsmWriteDepthFromDeviceZ`): the infinitely
 * far (device depth 0 of an infinite far plane) gets the finite depth near · 10^13. Below half a unit
 * in the last place of 1/depth for every depth up to 2^19 m (524 km), it changes no f32 depth there;
 * the shadows reach 83.9 km (the last clipmap level).
 */
const VSM_FAR_DEPTH_GUARD = 1e-13
/**
 * Writes at `out[at]` the four words a shader turns a reverse-Z device depth into a view depth with
 * (`vsmViewDepthOfDeviceZ`), from the view-to-clip `m` of a view looking down +z, column-major:
 * M[2][2] = `m[10]`, M[3][2] = `m[14]`. A perspective's words are 1 / M[3][2] and M[2][2] / M[3][2]
 * less the far guard; an orthographic one's 1 / M[2][2] and 1 − M[3][2] / M[2][2]. A depth term of 0
 * is `VSM_ZERO_DEPTH_TERM` where a perspective divides by it; an orthographic view never divides by it,
 * so one whose far plane is at the eye keeps its exact 0.
 */
export function vsmWriteDepthFromDeviceZ(
  out: Float32Array,
  at: number,
  m: ArrayLike<number>,
  perspective: boolean,
) {
  const depthMul = m[10]
  const depthAdd = m[14] === 0 ? VSM_ZERO_DEPTH_TERM : m[14]
  if (perspective) {
    out[at] = 0
    out[at + 1] = 0
    out[at + 2] = 1 / depthAdd
    out[at + 3] = depthMul / depthAdd - VSM_FAR_DEPTH_GUARD
  } else {
    out[at] = 1 / depthMul
    out[at + 1] = -m[14] / depthMul + 1
    out[at + 2] = 0
    out[at + 3] = 1
  }
}
/** The mip level of a local light's footprint. `extraBias` must be >= 0. `mipMode` limits the
 *  mips: 0 all eight, 1 the even ones, 2 the odd ones (`shadowMarkPixelPagesMipModeLocal`), applied
 *  after the clamp to the last mip, as the marking's WGSL does. */
export function vsmLocalMipLevel(
  footprint: number,
  mapBias: number,
  pressureBias: number,
  extraBias = 0,
  mipMode = 0,
) {
  const mipLevelFloat = Math.log2(footprint) + mapBias + pressureBias + extraBias
  let mipLevel = Math.max(Math.floor(mipLevelFloat), 0) >>> 0
  mipLevel = Math.min(mipLevel, VSM_MIPS - 1)
  if (mipMode === 1) mipLevel &= ~1
  else if (mipMode === 2) mipLevel |= 1
  return mipLevel
}

// ---- Defaults of the tunables ----------------------------------------------------------------
/** Declared: the pool's physical pages by default, 4096 of 64 KiB per slice (the default quality
 *  level's): the pool the setting's default asks. The global shadow memory
 *  budget derives from it (`SHADOW_POOL_BYTES`), not the reverse: more pages, more memory and fewer
 *  coarser fallbacks under load; fewer, the global resolution bias rises sooner. */
export const VSM_POOL_PAGES = 4096
// The traces. The reference's settings are the view's (`shadowMapOptions.ts`); these are its literals.
/** The depth samples the screen ray takes (`vsmScreenRayFrom`): more catch thinner occluders on
 *  screen, each a texel read a light and pixel; four are one batch of independent reads. */
export const VSM_SCREEN_RAY_SAMPLES = 4
/** The least normal offset of a receiver, 0.02 cm, near the eye. */
const VSM_NORMAL_OFFSET_FLOOR = 0.02 * VSM_UNIT_PER_CM
/** The steepest slope of the receiver's plane (map depth over map UV, a sun level's depth range
 *  being what it is) that a sun ray's start dither follows: past it a grazing receiver would lift
 *  its rays off the surface. */
const VSM_TRACE_PLANE_SLOPE_SUN = 0.05
/** The largest receiver-plane bias of a one-tap read (a light with no rays), in the depth of that
 *  many centimetres of a sun level (an orthographic depth is linear in the distance), and that
 *  many times a local map's depth scale (`lightViewToClip[2][2]`). */
const VSM_TRACE_ONE_TAP_BIAS_CAP = 100

// Clipmap (levels are log2 centimetres): the levels, their depth range, the coarse pages and the
// resolution biases are the view's shadow settings (`shadowMapOptions.ts`, `mapSettings.ts`).
/** Declared: a cached level stays valid while |ΔcentreZ| + radius <= 0.9 · cached depth radius: the
 *  tenth left is the margin before a caster leaves the depth range. */
export const VSM_SUN_DEPTH_KEEP = 0.9

// Local lights.
/** Point/spot face near plane: a reversed-Z perspective of half field π/4, width and height 1, near 1 cm, far the light's radius. */
export const VSM_LOCAL_NEAR_PLANE = 1 * VSM_UNIT_PER_CM

// Cache and budget. The ages and the dynamic resolution's limits are the view's shadow settings
// (`shadowMapOptions.ts`); the global resolution bias, past the pool's load, rises (coarser) by half
// the gap to its target a frame and falls by a tenth of it after 10 calm frames.
/** The views whose instance cache state a map reads: a word holds a bit each, the cached-as-dynamic
 *  ones then the transitioned ones (`casters/castDiffWgsl.ts`). */
export const VSM_VIEW_SLOTS = 16
export const VSM_PRESSURE_RISE = 0.5
/** A float constant: the f32 nearest a tenth. */
export const VSM_PRESSURE_FALL = Math.fround(0.1)
/** The global resolution bias under which it is none: its fall stalls on a subnormal above 0
 *  (`resolutionLodBiasStall.test.ts`), and under this bound a bias leaves every level where it was. */
export const VSM_PRESSURE_BIAS_NONE = 2 ** -54
export const VSM_PRESSURE_CALM_FRAMES = 10

/** WGSL mirror of the constants every VSM shader needs. */
export const VSM_CONSTANTS_WGSL = wgslBlock(
  'VSM_CONSTANTS_WGSL',
  [],
  `
${wgslConsts({
  VSM_LOG2_PAGE,
  VSM_PAGE_TEXELS,
  VSM_PAGE_TEXEL_MASK,
  VSM_LOG2_LEVEL0_PAGES,
  VSM_LEVEL0_PAGES,
  VSM_MIPS,
  VSM_LEVEL0_TEXELS,
  VSM_DIRTY_SLICES,
  VSM_LOG2_COVER_CELLS,
  VSM_COVER_CELL_MASK,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_MAP_UNCACHED,
  VSM_MAP_UNSEEN,
  VSM_MAP_COARSE,
  VSM_MAP_COVERAGE,
  VSM_MAP_COARSE_KEEPS_DYNAMIC,
  VSM_MAP_FIRST_PERSON,
  VSM_MAP_DISTANT,
  VSM_NEXT_KEEPS_PAGES,
  VSM_NEXT_ID_VALID,
  VSM_PAGE_WANTED,
  VSM_PAGE_DYNAMIC_STALE,
  VSM_PAGE_STATIC_STALE,
  VSM_PAGE_FINE,
  VSM_PAGE_MARK_MASK,
  VSM_PAGE_ANY_STALE,
  VSM_PAGE_TEST_ANY,
  VSM_META_DYNAMIC_CLEARED,
  VSM_META_STATIC_CLEARED,
  VSM_META_DYNAMIC_DRAWN,
  VSM_META_STATIC_DRAWN,
  VSM_META_DYNAMIC_STALE,
  VSM_META_STATIC_STALE,
  VSM_META_VIEW_UNCACHED,
  VSM_META_UNSEEN,
  VSM_META_FORCE_CACHED,
  VSM_META_DEFERRED,
  VSM_META_ANY_CLEARED,
  VSM_META_ANY_STALE,
  VSM_ENTRY_DRAWABLE_BIT,
  VSM_ENTRY_MAPPED_BIT,
  VSM_ENTRY_COARSER_SHIFT,
  VSM_ENTRY_COARSER_MASK,
  // The lights' one kind numbering (`LIGHT_KIND`), the lighting's and the maps' alike.
  LIGHT_KIND_DIRECTIONAL: LIGHT_KIND.directional,
  LIGHT_KIND_SPOT: LIGHT_KIND.spot,
  LIGHT_KIND_RECT: LIGHT_KIND.rect,
  VSM_GROUP_WIDTH,
})}
const VSM_CM_PER_UNIT:f32=${wgslF32(VSM_CM_PER_UNIT)};
const VSM_NORMAL_OFFSET_FLOOR:f32=${wgslF32(VSM_NORMAL_OFFSET_FLOOR)};
const VSM_TRACE_PLANE_SLOPE_SUN:f32=${wgslF32(VSM_TRACE_PLANE_SLOPE_SUN)};
const VSM_TRACE_ONE_TAP_BIAS_CAP:f32=${wgslF32(VSM_TRACE_ONE_TAP_BIAS_CAP)};
/** The normal bias length of a receiver \`distance\` from the eye (along the view axis under an
 *  orthographic camera): \`normalBias\` times the distance over the inverse tangent of the half
 *  field of view (1 under an orthographic camera), held to the floor (0.02 cm). The one rule of the
 *  projection and of the lighting that reads a shadow map. */
fn vsmNormalOffsetLength(normalBias:f32,distance:f32,inverseTangent:f32)->f32{
 return max(VSM_NORMAL_OFFSET_FLOOR,normalBias*distance/inverseTangent);
}
`,
)

/** The stale rect of map `id`'s mip `mip`, of its static layer's pages or of its dynamic layer's:
 *  two a (map, mip), each layer's pages bounding its own casters' commands (`vsmStaleRects`). */
export const VSM_STALE_RECT_INDEX_WGSL = wgslBlock(
  'VSM_STALE_RECT_INDEX_WGSL',
  [VSM_CONSTANTS_WGSL],
  `fn vsmStaleRectIndex(id:u32,mip:u32,staticLayer:bool)->u32{return 2u*(id*VSM_MIPS+mip)+select(0u,1u,staticLayer);}`,
)
