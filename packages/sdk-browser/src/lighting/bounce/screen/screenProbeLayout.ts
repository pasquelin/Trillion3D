import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type {
  ScreenProbeSettings,
  ScreenProbeValues,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { IRRADIANCE_PROBE_SIDE } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'

/**
 * THE SCREEN PROBES' SHAPES: the formats of what a view keeps (`SCREEN_PROBE_FORMATS`), how many probes a
 * view of `width × height` pixels holds and the size of every probe texture and buffer
 * (`screenProbeGeometry`), the uniform every kernel reads (`SCREEN_PROBE_PARAMS`) and how a kernel names its
 * bindings (`bindingTable`). The probes are an atlas: the uniform ones, a row of `tilesX` for each row of
 * tiles, then the adaptive ones in the rows below, so that a probe's index is its atlas row times the width
 * plus its column. A probe's rays and its filtered radiance are `tracing` texels a side in the textures of the
 * same atlas, each probe a square of them.
 */

/** The largest tile, in pixels, the atlas is cut at. */
const MAX_TILE = 64

/** The formats of the textures the screen probes keep, each the smallest core WebGPU stores that holds what it carries. */
export const SCREEN_PROBE_FORMATS = {
  /** A probe: its world point and its signed depth, the depth negative where it stands on no lit surface. */
  info: 'rgba32float',
  /** A probe's normal, and the speed of its surface in `w` (metres an image). */
  normal: 'rgba16float',
  /** A ray's radiance, the three channels in one word (`packLight`, the 11-11-10 float): written by the screen
   *  stage, then added to by the field's and the scene's, read and written in place. */
  trace: 'r32uint',
  /** A ray's end: the distance it reached, whether it met a surface and whether that surface moves
   *  (`spHitWord`), read and written in place by the stages. */
  hit: 'r32uint',
  /** A ray's direction, the texel of the octahedron and its level (`spPackRay`). */
  ray: 'r32uint',
  /** A probe's filtered radiance by direction, its nearest hit's distance in `w`. */
  gather: 'rgba16float',
  /** A probe's spherical harmonics, a texel a coefficient, or its octahedral irradiance. */
  irradiance: 'rgba16float',
  /** A pixel's accumulated irradiance (`packLight`) and its meta word (`spMetaOf`: the depth it was measured at, its
   *  amount of fast update, the frames it holds, its occlusion): what the lighting reads. */
  history: 'rg32uint',
  /** A pixel's short-range occlusion. */
  occlusion: 'r32float',
} as const satisfies Record<string, GPUTextureFormat>

/** What a kernel binds and how: a uniform, a read-only or writable storage buffer, a sampled float or
 *  unsigned texture, a texture written as storage in a format. */
type BindingKind =
  | 'uniform'
  | 'buffer-read'
  | 'buffer'
  | 'float'
  | 'uint'
  | { readonly store: GPUTextureFormat; readonly access?: GPUStorageTextureAccess }

/** The layout entry of a binding of `kind`, seen by the compute stage. */
function entryOf(binding: number, kind: BindingKind): GPUBindGroupLayoutEntry {
  if (kind === 'uniform') return computeUniformEntry(binding)
  if (kind === 'buffer-read') return computeBufferEntry(binding, 'read-only-storage')
  if (kind === 'buffer') return computeBufferEntry(binding, 'storage')
  if (kind === 'float') return computeTextureEntry(binding, 'unfilterable-float')
  if (kind === 'uint') return computeTextureEntry(binding, 'uint')
  return computeStorageTextureEntry(binding, kind.store, kind.access)
}

/**
 * A kernel's bindings in one table, name → binding number and kind: `at` the number of each name — the
 * WGSL's declarations and the bind group's entries read it —, `entries` the layout of group 0.
 */
export function bindingTable<
  const T extends Readonly<Record<string, readonly [number, BindingKind]>>,
>(table: T) {
  const at = {} as { [K in keyof T]: number }
  const entries: GPUBindGroupLayoutEntry[] = []
  for (const name of Object.keys(table) as (keyof T & string)[]) {
    at[name] = table[name][0]
    entries.push(entryOf(table[name][0], table[name][1]))
  }
  return { at, entries }
}

/** The shapes of a view's probes. */
export interface ScreenProbeGeometry {
  /** The image's size in pixels. */
  width: number
  height: number
  /** Pixels along a probe's tile. */
  tile: number
  /** Uniform probes along a row, and rows of them. */
  tilesX: number
  tilesY: number
  /** Rows of the atlas: the uniform ones and the adaptive ones' below. */
  rows: number
  /** The uniform probes, and the most adaptive ones the atlas holds. */
  uniform: number
  maxAdaptive: number
  /** Samples of a tile an adaptive probe may stand on, along x and y. */
  samplesX: number
  samplesY: number
  /** Rays a side of a probe's octahedron, traced, and texels a side of the octahedron they are gathered into. */
  tracing: number
  gather: number
}

/** The samples of a tile along each axis for `count` of them: four by four from sixteen, four by two
 *  from eight, two by two below. */
export const adaptiveSamples = (count: number): readonly [number, number] =>
  count >= 16 ? [4, 4] : count >= 8 ? [4, 2] : [2, 2]

/** The widest a probe's texels run along an atlas row: its rays, its octahedral irradiance with the border, its nine
 *  coefficients. */
const probeTexels = (tracing: number) => Math.max(tracing, IRRADIANCE_PROBE_SIDE + 2, 9)

/** What the shape of the probes depends on in the settings. */
type ShapeSettings = Pick<
  ScreenProbeSettings,
  'casts' | 'downsampleFactor' | 'adaptiveProbes' | 'tracingResolution' | 'gatherResolution'
> & { values: Pick<ScreenProbeValues, 'screenProbeAdaptiveFraction'> }

/**
 * The shapes of the probes of an image of `width × height` pixels cut in tiles of `tile` pixels at `settings`: a probe a tile,
 * the atlas a row of adaptive probes below it for each `adaptiveFraction` of the rows (at most the fraction of the uniform
 * probes, and what the atlas holds). An image drawn in the targets of a larger one takes the larger one's tile
 * (`screenProbeGeometry`), so that its probes lie in the atlas the targets were made for.
 */
export function geometryOfTile(
  width: number,
  height: number,
  tile: number,
  settings: ShapeSettings,
): ScreenProbeGeometry {
  const tilesX = Math.max(1, ceilDiv(width, tile)),
    tilesY = Math.max(1, ceilDiv(height, tile))
  const fraction = settings.values.screenProbeAdaptiveFraction
  const adaptive = settings.casts && settings.adaptiveProbes > 0 && fraction > 0
  const rows = tilesY + (adaptive ? Math.trunc(tilesY * fraction) : 0)
  const uniform = tilesX * tilesY
  const maxAdaptive = adaptive
    ? Math.min(Math.trunc(uniform * fraction), rows * tilesX - uniform)
    : 0
  const [samplesX, samplesY] = adaptiveSamples(settings.adaptiveProbes)
  return {
    width,
    height,
    tile,
    tilesX,
    tilesY,
    rows,
    uniform,
    maxAdaptive,
    samplesX,
    samplesY,
    tracing: settings.tracingResolution,
    gather: settings.gatherResolution,
  }
}

/**
 * The shapes of the probes of a view of `width × height` pixels at `settings` (`geometryOfTile`): the tile the settings name,
 * doubled, up to sixty-four pixels, until the atlas's textures fit the `side` a device's texture may measure (its
 * `maxTextureDimension2D`). A level that casts no probe holds one tile the size of the image: a single probe no kernel reads.
 */
export function screenProbeGeometry(
  width: number,
  height: number,
  settings: ShapeSettings,
  side = Infinity,
): ScreenProbeGeometry {
  const texels = probeTexels(settings.tracingResolution)
  let tile = settings.casts ? settings.downsampleFactor : Math.max(width, height)
  let found = geometryOfTile(width, height, tile, settings)
  while (tile < MAX_TILE && Math.max(found.tilesX, found.rows) * texels > side) {
    tile *= 2
    found = geometryOfTile(width, height, tile, settings)
  }
  return found
}

/** The flags of the parameters' mode word (`SCREEN_PROBE_PARAMS`, `mode.z`), one bit each. */
export const SCREEN_PROBE_FLAGS = {
  screenTraces: 1 << 0,
  importance: 1 << 1,
  importanceLighting: 1 << 2,
  radianceHistory: 1 << 3,
  temporal: 1 << 4,
  stochastic: 1 << 5,
  cache: 1 << 6,
  octahedral: 1 << 7,
  occlusion: 1 << 8,
  sceneTraces: 1 << 9,
  meshTraces: 1 << 10,
  velocity: 1 << 11,
  fastUpdateClamp: 1 << 12,
  disocclusion: 1 << 13,
  occlusionTemporal: 1 << 14,
  fullResDepth: 1 << 15,
  skipFoliageHits: 1 << 16,
} as const

/**
 * The uniform every screen-probe kernel reads (`sp`), one table the writer's words and the shaders' struct
 * are drawn from: `size`, the image's size in pixels, the tile's side and the image's rank; `grid`, the uniform
 * probes along and across, the atlas's rows, the most adaptive probes; `mode`, the tile's jitter this
 * image and the last, the flags (`SCREEN_PROBE_FLAGS`) and the ray directions' turn; `counts`, the frames the
 * history keeps at most, the uniform probes and the screen trace's iterations; `weights`, the depth weights of the interpolation (the plane's,
 * then the fallback's, as exponents), the probability under which a ray is not traced and the intensity a ray is
 * held to; `spatial`, the spatial filter's position scale and its angle, the width the probes a pixel reads are
 * jittered and the furthest a ray looks; `occlusion`, the horizon search's slices, steps and foreground fraction and the scale of
 * the neighbourhood the history's occlusion is held to; `scene`, the detail trace's distance, the distance from the eye it is
 * made within, the bias off a surface and the history's relative depth threshold; `cache`, the radiance cache's radius scale (the
 * multiple of a probe's nearest ray start the direction a ray reads it by is moved onto a sphere of) and the texels a side of its maps; `motion`, the relative speed
 * difference from which a ray's end moves, the inverse of the share of moving light from which the history gives
 * way, and the most it gives way by; `tuning`, the frames and the share of a probe's pixels that make it
 * disoccluded, the history's depth thickness and the relative thickness of the screen trace times the projection's
 * depth scale (`screenRelativeThickness`); `trace`, the scale of a surface's thickness where it has no distance field and
 * the linear steps that look for a thin feature past a hit; `previous`, the inverse of
 * the view-projection the last lit image was drawn with.
 */
export const SCREEN_PROBE_PARAMS = fieldLayout('ScreenProbeParams', [
  ['size', 'vec4u'],
  ['grid', 'vec4u'],
  ['mode', 'vec4u'],
  ['counts', 'vec4u'],
  ['weights', 'vec4f'],
  ['spatial', 'vec4f'],
  ['occlusion', 'vec4f'],
  ['scene', 'vec4f'],
  ['cache', 'vec4f'],
  ['motion', 'vec4f'],
  ['tuning', 'vec4f'],
  ['trace', 'vec4f'],
  ['previous', 'mat4x4f'],
] as const)
/** Bytes of the parameters. */
export const SCREEN_PROBE_PARAMS_BYTES = SCREEN_PROBE_PARAMS.words * 4

/** The indirect arguments the placement writes for the kernels over the probes in use (`probeArgs`): the workgroups
 *  of a kernel a probe a group at word `probes`, of one over the trace texels in groups of 8 × 8 at word `texels`. */
export const SCREEN_PROBE_ARGS = { probes: 0, texels: 3, words: 6 } as const
/** Words an entry of the scene rays' list holds: the ray's texel (`x | y << 16`). */
export const SCENE_RAY_WORDS = 1
