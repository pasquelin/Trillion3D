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
/** A physical page's depth tiles (`tileDepths`): 8×8 texels each, 16×16 a page. Each
 *  tile holds the closest depth of its texels, which the sun's rays test before reading the pool. */
const VSM_LOG2_TILE_DEPTH_TEXELS = 3
export const VSM_TILE_DEPTHS_PER_PAGE = (VSM_PAGE_TEXELS >> VSM_LOG2_TILE_DEPTH_TEXELS) ** 2 // 256
/** Declared: level 0 of a map is 128 pages a side. Derived from it: the mips down to one page
 *  (log2 128 + 1 = 8) and the map's width in texels (128 pages of 128 texels = 16384). */
const VSM_LOG2_LEVEL0_PAGES = 7
export const VSM_LEVEL0_PAGES = 1 << VSM_LOG2_LEVEL0_PAGES // 128
export const VSM_MIPS = VSM_LOG2_LEVEL0_PAGES + 1 // 8
export const VSM_LEVEL0_TEXELS = VSM_LEVEL0_PAGES * VSM_PAGE_TEXELS // 16384
/** The raster marks: a word per physical page in each of four slices, the four bits the raster
 *  marks a page with (`vsmRasterMarkBits`): dynamic drawn, static drawn, dynamic
 *  invalidated, static invalidated; folded into the page's metadata after the raster. */
export const VSM_DIRTY_SLICES = 4
const VSM_LOG2_COVER_CELLS = 3
const VSM_COVER_CELL_MASK = 3
/** One full map's page table block: `VSM_LEVEL0_PAGES` wide, 128 + 64 tall (mip tail below level 0). */
export const VSM_PAGE_TABLE_BLOCK_HEIGHT = VSM_LEVEL0_PAGES + VSM_LEVEL0_PAGES / 2 // 192

// Flags of a projection record: one bit each, in a row.
export const VSM_MAP_UNCACHED = 1 << 0
export const VSM_MAP_UNSEEN = 1 << 1
export const VSM_MAP_COARSE = 1 << 2
export const VSM_MAP_COVERAGE = 1 << 3
/** Every map's coarse pages keep their dynamic layer through a dynamic stale bit: a moving caster
 *  does not redraw them every frame. */
export const VSM_MAP_COARSE_KEEPS_DYNAMIC = 1 << 4

/** Declared: the single-page (distant light) maps a frame holds, ids [0, 8192); full maps start at
 *  8192. A capacity, not a quantity: 64 rows of the first page-table block, which the full maps
 *  skip; a light past it is refused, and each slot is a projection record of the frame. */
export const VSM_SINGLE_PAGE_MAP_SLOTS = 1024 * 8

// The page counters the engine reads back (`engineVsm.ts` readVsmStats), one word each, in a row.
export const VSM_COUNT_WANTED = 0
export const VSM_COUNT_STATIC_KEPT = 1
export const VSM_COUNT_DYNAMIC_KEPT = 2
export const VSM_COUNT_CLEARED = 3
export const VSM_COUNT_GRANTED = 4
export const VSM_COUNTERS = 5
export const VSM_FEEDBACK_POOL = 0

/**
 * Bytes of a map's projection record (`projectionData.ts`, `VsmProjectionRecord`): its three 4×4
 * float matrices, four rows of a 3-vector and a word, and seven words (four scalars, the two-word
 * corner, the range), rounded up to the 16-byte alignment its matrices give the struct.
 */
export const VSM_PROJECTION_RECORD_BYTES = 3 * 64 + 4 * 16 + Math.ceil((7 * 4) / 16) * 16 // 288
/** Byte size of `VsmUniforms` (`uniforms.ts`, uniform address space). */
export const VSM_UNIFORMS_BYTES = 208

/** Bytes of one candidate of the raster's cull (`VsmRenderCandidate`, `renderCullWgsl.ts`), one
 *  command and one pair (vec4u). */
export const VSM_RENDER_CANDIDATE_BYTES = 48
export const VSM_RENDER_CMD_BYTES = 16
export const VSM_RENDER_PAIR_BYTES = 16
/** Pairs a chunk of the raster holds by default (`renderPass.ts`), the most its pair and command
 *  lists then grow to (16 B each): the memory budget's shadow share counts both at it
 *  (`residency/shadowBudgetBytes.ts`). */
export const VSM_RENDER_PAIR_CAPACITY = 1 << 21

// Flags of the next-frame data of a map.
export const VSM_NEXT_KEEPS_PAGES = 1 << 0

// ---- Page marks (hierarchical, OR-combined): what a page request or a mapped page says -------
const VSM_PAGE_WANTED = 1 << 0
const VSM_PAGE_DYNAMIC_STALE = 1 << 1
const VSM_PAGE_STATIC_STALE = 1 << 2
const VSM_PAGE_FINE = 1 << 3
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
const VSM_META_ANY_CLEARED = VSM_META_DYNAMIC_CLEARED | VSM_META_STATIC_CLEARED
const VSM_META_ANY_DRAWN = VSM_META_DYNAMIC_DRAWN | VSM_META_STATIC_DRAWN
const VSM_META_ANY_STALE = VSM_META_DYNAMIC_STALE | VSM_META_STATIC_STALE

// Page table entry bits ([0:9] phys X, [10:19] phys Y, [20:25] coarser levels).
const VSM_ENTRY_DRAWABLE_BIT = 0x40000000
const VSM_ENTRY_MAPPED_BIT = 0x80000000

// Physical page lists, each VSM_POOL_PAGES + 1 long (the last word is the counter).
const VSM_PAGES_BY_AGE = 0
const VSM_PAGES_FREE = 1
const VSM_PAGES_EMPTY = 2
const VSM_PAGES_REQUESTED = 3
export const VSM_PAGE_LIST_COUNT = 4

/** The light kinds (a map's `VsmProjectionData.lightKind`, a projected light's
 *  `VsmProjectionLight.kind`; a rect light is projected only). */
export const VSM_LIGHT_KIND_DIRECTIONAL = 0
export const VSM_LIGHT_KIND_POINT = 1
export const VSM_LIGHT_KIND_SPOT = 2
export const VSM_LIGHT_KIND_RECT = 3

/** Kernel group sizes. */
export const VSM_GROUP_WIDTH = 256

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
/**
 * The greatest f32 below 1: 1 − 2^-24, an f32 significand having 24 bits, written as the decimal a
 * shader reads back to it exactly. A sun level's caster in front of its near plane is flattened onto
 * that depth (`renderRasterWgsl.ts`, `transmissionWgsl.ts`); the square-to-disk map centres the
 * unit square on it (`traceWgsl.ts`).
 */
export const VSM_F32_BELOW_ONE = 0.99999994

/** The mip level of a local light's footprint. `extraBias` must be >= 0. */
export function vsmLocalMipLevel(
  footprint: number,
  mapBias: number,
  pressureBias: number,
  extraBias = 0,
) {
  const mipLevelFloat = Math.log2(footprint) + mapBias + pressureBias + extraBias
  let mipLevel = Math.max(Math.floor(mipLevelFloat), 0) >>> 0
  mipLevel = Math.min(mipLevel, VSM_MIPS - 1)
  return mipLevel
}

// ---- Defaults of the tunables ----------------------------------------------------------------
/** Declared: the pool's physical pages, 2048 of 64 KiB per slice. The global shadow memory budget
 *  derives from it (`SHADOW_POOL_BYTES`), not the reverse: more pages, more memory and fewer
 *  coarser fallbacks under load; fewer, the global resolution bias rises sooner. */
export const VSM_POOL_PAGES = 2048
/** Declared: how far past its page a marked point also marks the neighbouring page, directional /
 *  local, a fraction of a page (0.05 = 6.4 texels): a filter or a ray reaching across the page
 *  edge finds the page mapped. Larger marks more pages; 0 marks the point's page alone. */
export const VSM_SUN_PAGE_MARGIN = 0.05
export const VSM_LOCAL_PAGE_MARGIN = 0.05
/** Declared: a caster whose radius covers fewer of the map's pixels than this is fine: it draws into
 *  the pages marked from pixels and not into coarse ones; dynamic / static casters. Larger keeps
 *  more small casters out of coarse pages (fewer redraws, their far shadow gone), smaller draws
 *  them there. */
export const VSM_DETAIL_PIXELS_DYNAMIC = 16
export const VSM_DETAIL_PIXELS_STATIC = 1
/** Declared: the marking reads one pixel of each 2 × 2 (X / Y). 1 reads every pixel, four times the
 *  marking's reads; more may miss a page that only a few pixels see (the page margins catch most). */
export const VSM_MARK_STRIDE_X = 2
export const VSM_MARK_STRIDE_Y = 2
/** Declared: whether a map's pages carry a receiver cover (which of a page's 8 × 8 cells hold a
 *  receiver), local / sun: a cached page is then redrawn for a moving caster only where it covers a
 *  receiver. On for the suns, whose pages span many receivers; off for the local maps. */
export const VSM_COVER_LOCAL = false
export const VSM_COVER_SUN = true

// The traces. Declared, every one: they shape the contact and the penumbra and set its noise against
// its cost. Moving any of them changes the image.
/** The screen-space ray a pixel casts toward the light before the map's, as a share of the view's
 *  height at the pixel's depth: it catches contact shadows finer than a texel. Longer catches more,
 *  and may take a near surface for an occluder. */
export const VSM_SCREEN_RAY_SHARE = 0.015
/** A receiver moves along its normal by 0.5 thousandths of its distance to the eye (over the view's
 *  half-field tangent) before it reads the maps: a texel grows with distance, so does the offset.
 *  More lifts self-shadowing; it also detaches the contact shadows. */
export const VSM_NORMAL_BIAS = 0.5 / 1000
/** The least of that offset, 0.02 cm, near the eye. */
const VSM_NORMAL_OFFSET_FLOOR = 0.02 * VSM_UNIT_PER_CM
/** The rays after which a group whose lanes all hit (an umbra) stops. */
export const VSM_TRACE_VOTE_AFTER = 1
/** The rays a pixel traces and the samples each ray takes, local / sun: 7 × 8 at most a light. More
 *  rays smooth the penumbra (its noise falls as one over their root), more samples catch thinner
 *  occluders; each costs in proportion. */
export const VSM_TRACE_RAYS_LOCAL = 7
export const VSM_TRACE_STEPS_LOCAL = 8
export const VSM_TRACE_RAYS_SUN = 7
export const VSM_TRACE_STEPS_SUN = 8
/** The rays a lane counts at most: its high nibble (`vsmMaskCode`). The ray count settings stop
 *  there (`world/core/worldSettings.ts`). */
export const VSM_MASK_MAX_RAYS = (1 << 4) - 1
/** The angle (radians) a local ray leans off its light at which its reach toward the light starts
 *  to shorten (`vsmLocalRayReach`); shaders get 1/tan of it. Smaller shortens off-axis rays sooner. */
export const VSM_TRACE_CONE_LIMIT = 0.03
/** The steepest slope the march extends an occluder's surface with behind a sample, local (in the
 *  map's depth per unit of ray time) / sun (a depth per unit of ray time in the level's centimetre
 *  arithmetic, converted by `vsmSunRayBegin`).
 *  Steeper reaches further behind thin occluders, and over gaps. */
export const VSM_TRACE_SLOPE_CAP_LOCAL = 0.05
export const VSM_TRACE_SLOPE_CAP_SUN = 5
/** The rays' start dither, in texels, local / sun: it hides the texel grid in the penumbra. More
 *  blurs it, 0 shows the texels. */
export const VSM_TRACE_DITHER_LOCAL = 2
export const VSM_TRACE_DITHER_SUN = 2
/** The largest receiver-plane bias of a local ray, in texels of the dither: it keeps a grazing
 *  receiver off its own texels. */
export const VSM_TRACE_PLANE_BIAS_CAP_LOCAL = 50
/** A sun ray's length, in units of the receiver's distance to the eye. */
export const VSM_TRACE_REACH_SUN = 1.5

// Clipmap (levels are log2 centimetres). Declared: the finest level's radius is 2^7 cm = 1.28 m,
// the coarsest's 2^23 cm = 83.9 km, the sun's shadow reach; the coarse pages are marked on the
// levels of radius 655 m to 5.2 km (15 to 18). A finer first level sharpens the nearest shadows
// for more pages; a coarser last one shortens the reach.
export const VSM_SUN_FINEST_LEVEL = 6
export const VSM_SUN_COARSEST_LEVEL = 22
export const VSM_SUN_COARSE_FROM = 15
export const VSM_SUN_COARSE_TO = 18
/** Declared: a level's depth range, 1000 times its radius (unitless): casters that far above the
 *  receivers still cast. Larger, the depth precision of a texel drops in proportion. */
export const VSM_SUN_DEPTH_SPAN = 1000
/**
 * The sun's level bias, at rest and while the light moves. Each unit below 0 halves the
 * clipmap texel; the clipmap still clamps the total, screen term included, to at least 0
 * (`createVsmClipmap`).
 */
export const VSM_SUN_LEVEL_BIAS = -1.5
export const VSM_SUN_LEVEL_BIAS_MOVING = -1.5
/** Declared: a cached level stays valid while |ΔcentreZ| + radius <= 0.9 · cached depth radius: the
 *  tenth left is the margin before a caster leaves the depth range. */
export const VSM_SUN_DEPTH_KEEP = 0.9

// Local lights.
export const VSM_LOCAL_LEVEL_BIAS = 0
export const VSM_LOCAL_LEVEL_BIAS_MOVING = 1
/** Point/spot face near plane: a reversed-Z perspective of half field π/4, width and height 1, near 1 cm, far the light's radius. */
export const VSM_LOCAL_NEAR_PLANE = 1 * VSM_UNIT_PER_CM

// Cache and budget. Declared, as a cache policy: a page unrequested for 1000 frames is freed, a
// light unseen for 10 frames loses its maps, a placement still for 100 frames turns static; the
// global resolution bias rises (coarser) fast past 85 % of the pool (half the gap a frame) and
// falls slowly (a tenth) after 10 calm frames, by at most 2 levels.
export const VSM_CACHE_ON = 1
export const VSM_PAGE_KEEP_FRAMES = 1000
export const VSM_LIGHT_KEEP_FRAMES = 10
export const VSM_STILL_FRAMES = 100
export const VSM_PRESSURE_BIAS_MAX = 2
/**
 * The global resolution bias under which it is 0: its decay toward 0 in f32 would otherwise stop
 * on a subnormal for good. A bias under 2^-54 moves no level: added to a level in f64
 * (`vsmLocalMipLevel` on the CPU) it rounds back to it, 2^-54 being half the step of the doubles
 * below 1; in f32 (the GPU's marking) a level keeps its floor up to 2^-25, and a sum lifted across
 * 0 is clamped there or lies below the first clipmap level (`resolutionLodBiasZero.test.ts`). The
 * floor is a quarter of that bound, for the feedback a few frames old the decay reads.
 */
export const VSM_PRESSURE_BIAS_FLOOR = 2 ** -56
export const VSM_PRESSURE_LOAD = 0.85
export const VSM_PRESSURE_RISE = 0.5
export const VSM_PRESSURE_FALL = 0.1
export const VSM_PRESSURE_CALM_FRAMES = 10

/** Interpolates the resolution bias between the resting and moving values by the mobility factor. */
export function vsmMovingBias(stillBias: number, movingBias: number, movingShare: number) {
  const b = Math.max(stillBias, movingBias)
  return stillBias + (b - stillBias) * movingShare
}

/** WGSL mirror of the constants every VSM shader needs. */
export const VSM_CONSTANTS_WGSL = /* wgsl */ `
const VSM_LOG2_PAGE:u32=${VSM_LOG2_PAGE}u;
const VSM_PAGE_TEXELS:u32=${VSM_PAGE_TEXELS}u;
const VSM_PAGE_TEXEL_MASK:u32=${VSM_PAGE_TEXEL_MASK}u;
const VSM_LOG2_TILE_DEPTH_TEXELS:u32=${VSM_LOG2_TILE_DEPTH_TEXELS}u;
const VSM_LOG2_LEVEL0_PAGES:u32=${VSM_LOG2_LEVEL0_PAGES}u;
const VSM_LEVEL0_PAGES:u32=${VSM_LEVEL0_PAGES}u;
const VSM_MIPS:u32=${VSM_MIPS}u;
const VSM_LEVEL0_TEXELS:u32=${VSM_LEVEL0_TEXELS}u;
const VSM_DIRTY_SLICES:u32=${VSM_DIRTY_SLICES}u;
const VSM_LOG2_COVER_CELLS:u32=${VSM_LOG2_COVER_CELLS}u;
const VSM_COVER_CELL_MASK:u32=${VSM_COVER_CELL_MASK}u;
const VSM_PAGE_TABLE_BLOCK_HEIGHT:u32=${VSM_PAGE_TABLE_BLOCK_HEIGHT}u;
const VSM_MAP_UNCACHED:u32=${VSM_MAP_UNCACHED}u;
const VSM_MAP_UNSEEN:u32=${VSM_MAP_UNSEEN}u;
const VSM_MAP_COARSE:u32=${VSM_MAP_COARSE}u;
const VSM_MAP_COVERAGE:u32=${VSM_MAP_COVERAGE}u;
const VSM_MAP_COARSE_KEEPS_DYNAMIC:u32=${VSM_MAP_COARSE_KEEPS_DYNAMIC}u;
const VSM_SINGLE_PAGE_MAP_SLOTS:u32=${VSM_SINGLE_PAGE_MAP_SLOTS}u;
const VSM_NEXT_KEEPS_PAGES:u32=${VSM_NEXT_KEEPS_PAGES}u;
const VSM_PAGE_WANTED:u32=${VSM_PAGE_WANTED}u;
const VSM_PAGE_DYNAMIC_STALE:u32=${VSM_PAGE_DYNAMIC_STALE}u;
const VSM_PAGE_STATIC_STALE:u32=${VSM_PAGE_STATIC_STALE}u;
const VSM_PAGE_FINE:u32=${VSM_PAGE_FINE}u;
const VSM_PAGE_MARK_MASK:u32=${VSM_PAGE_MARK_MASK}u;
const VSM_PAGE_ANY_STALE:u32=${VSM_PAGE_ANY_STALE}u;
const VSM_PAGE_TEST_ANY:u32=${VSM_PAGE_TEST_ANY}u;
const VSM_META_DYNAMIC_CLEARED:u32=${VSM_META_DYNAMIC_CLEARED}u;
const VSM_META_STATIC_CLEARED:u32=${VSM_META_STATIC_CLEARED}u;
const VSM_META_DYNAMIC_DRAWN:u32=${VSM_META_DYNAMIC_DRAWN}u;
const VSM_META_STATIC_DRAWN:u32=${VSM_META_STATIC_DRAWN}u;
const VSM_META_DYNAMIC_STALE:u32=${VSM_META_DYNAMIC_STALE}u;
const VSM_META_STATIC_STALE:u32=${VSM_META_STATIC_STALE}u;
const VSM_META_VIEW_UNCACHED:u32=${VSM_META_VIEW_UNCACHED}u;
const VSM_META_UNSEEN:u32=${VSM_META_UNSEEN}u;
const VSM_META_ANY_CLEARED:u32=${VSM_META_ANY_CLEARED}u;
const VSM_META_ANY_DRAWN:u32=${VSM_META_ANY_DRAWN}u;
const VSM_META_ANY_STALE:u32=${VSM_META_ANY_STALE}u;
const VSM_ENTRY_DRAWABLE_BIT:u32=${VSM_ENTRY_DRAWABLE_BIT}u;
const VSM_ENTRY_MAPPED_BIT:u32=${VSM_ENTRY_MAPPED_BIT}u;
const VSM_PAGES_BY_AGE:u32=${VSM_PAGES_BY_AGE}u;
const VSM_PAGES_FREE:u32=${VSM_PAGES_FREE}u;
const VSM_PAGES_EMPTY:u32=${VSM_PAGES_EMPTY}u;
const VSM_PAGES_REQUESTED:u32=${VSM_PAGES_REQUESTED}u;
const VSM_PAGE_LIST_COUNT:u32=${VSM_PAGE_LIST_COUNT}u;
const LIGHT_KIND_DIRECTIONAL:u32=${VSM_LIGHT_KIND_DIRECTIONAL}u;
const LIGHT_KIND_SPOT:u32=${VSM_LIGHT_KIND_SPOT}u;
const VSM_GROUP_WIDTH:u32=${VSM_GROUP_WIDTH}u;
const VSM_CM_PER_UNIT:f32=${VSM_CM_PER_UNIT}.0;
const VSM_NORMAL_OFFSET_FLOOR:f32=${VSM_NORMAL_OFFSET_FLOOR};
`
