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
  /** A probe's normal and the speed of its surface, one word (`spProbeWord`): the normal's two octahedral coordinates on a byte each
   *  as an 8-bit normalised pair would hold them (`n · ½ + ½`, rounded to the nearest of 255 steps), then the speed (metres an image)
   *  as a half float in the high half, whose sign bit says the surface has backface diffuse light (a thin double-sided sheet or a subsurface
   *  material) and last bit of mantissa that it is hair. Core storage holds no two-channel 8-bit texel. */
  normal: 'r32uint',
  /** A ray's radiance, the three channels in one word (`packLight`, the 11-11-10 float): written by the screen
   *  stage, then by the scene's. */
  trace: 'r32uint',
  /** A ray's end: the distance it reached and whether what it met moves
   *  (`spHitWord`), written by the screen stage, then read and written in place by the scene's. */
  hit: 'r32uint',
  /** A ray's direction, the texel of the octahedron and its level (`spPackRay`). */
  ray: 'r32uint',
  /** A probe's filtered radiance by direction, as an 11-11-10 target holds it (`spQuantize`), and in `w` the 8-bit code of its nearest hit's
   *  distance, a whole number from 0 to 255 (`spHitCode`). */
  gather: 'rgba16float',
  /** A probe's spherical harmonics, a texel a coefficient, or its octahedral irradiance; with the extra ambient occlusion (`screenProbeExtraAmbientOcclusion`) its
   *  alpha holds the occlusion by normal in an octahedron with a border of one texel, the eight-bit code of an unsigned normalised number
   *  (`spExtraAoCode`, exact in a half float), the harmonics in the first nine texels of the probe's block (`spCoefficientTexel`). */
  irradiance: 'rgba16float',
  /** A probe's extra ambient occlusion by direction, a texel of the gather (`screenProbeExtraAmbientOcclusion`), an eight-bit unsigned normalised number
   *  (`spExtraAoStored`). */
  extraAo: 'r32float',
  /** A coarser level of the probes' filtered radiance (`screenProbeGatherNumMips`): the mean of two by two texels of the level before, in the octahedron with its
   *  border (`spMipSide`). */
  radianceMip: 'rgba16float',
  /** What the lighting reads of a pixel (`SCREEN_INDIRECT_WGSL`), four words accumulated over the images: its irradiance, its rough
   *  specular light and the irradiance of its backface (each `packLight`), and its short-range occlusion with the direction of the
   *  open sky, the bent normal times the amount (`spBentPack`). A pixel on no lit surface, or that read nothing and held nothing, is zero. */
  history: 'rgba32uint',
  /** What the temporal pass keeps of a pixel's surface, two words: its normal and kind in the 10-10-10-2 bits of a normalised texel
   *  (`spShadingPack`: the normal as `n · ½ + ½`, then whether the pixel has backface diffuse light) and the frames it holds with its amount of fast
   *  update, one byte (`spFramesOf`). Core storage holds no 10-10-10-2 nor single byte texel. */
  shading: 'rg32uint',
  /** The device depth the pixel was found at, as the depth buffer held it (zero for none): what a history texel is told from another surface's by, and
   *  what the screen trace's hits are kept by (`spDeviceGap`); beside the shading, which only a texel of the depth's surface reads. */
  keptDepth: 'r32float',
  /** What the integration of a pixel's probes leaves for the temporal pass, a texel a pixel each: the light in `rgb` and the share of it that moves in `a`
   *  (an eight-bit number), the rough specular light and the light at the back, each one word as an 11-11-10 target holds it (`packLight`). */
  light: 'rgba16float',
  rough: 'r32uint',
  back: 'r32uint',
  /** Where a pixel reads the integration's texels where it runs at a reduction (`screenProbeIntegrateDownsampleFactor`), a word a pixel: the stochastic offset in the
   *  four texels round the pixel (`x` in bit 0, `y` in bit 1) and, in bit 2, whether the four could stand for the pixel at all (`stochasticWgsl.ts`). */
  offsets: 'r32uint',
  /** A pixel's short-range occlusion: its amount, or, with the bent normal, the direction of the open sky times the amount (`spBentPack`). */
  occlusion: 'r32float',
  bentOcclusion: 'r32uint',
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

/** The workgroups of the adaptive placement, a thread a sample: the samples of the whole tiles of the image, tiles rounded down, in
 *  groups of 8 × 8 threads. The uniform probes cover the tiles rounded up, but a last partial row or column of tiles gets adaptive
 *  samples only where a workgroup the whole tiles fill reaches it. */
export function adaptiveWorkgroups(
  g: Pick<ScreenProbeGeometry, 'width' | 'height' | 'tile' | 'samplesX' | 'samplesY'>,
) {
  return [
    ceilDiv(Math.trunc(g.width / g.tile) * g.samplesX, 8),
    ceilDiv(Math.trunc(g.height / g.tile) * g.samplesY, 8),
  ] as const
}

/** The texels a side of a probe's map in the level `level` of the filtered radiance's levels of detail (`screenProbeGatherNumMips`, `mips` of them), border
 *  included: the gather's side plus a border of one texel at the coarsest level, two at the next and so on (`2 ** (mips - 1)` at the finest), halved at each level. */
export const gatherMipSide = (gather: number, mips: number, level: number) =>
  (gather + 2 ** mips) >> level

/** The widest a probe's texels run along an atlas row: its rays, its octahedral irradiance with the border, its nine
 *  coefficients, its gathered radiance with the border of its finest level. */
const probeTexels = (tracing: number, gather: number, mips: number) =>
  Math.max(tracing, IRRADIANCE_PROBE_SIDE + 2, 9, gatherMipSide(gather, mips, 0))

/** What the shape of the probes depends on in the settings. */
type ShapeSettings = Pick<
  ScreenProbeSettings,
  | 'casts'
  | 'downsampleFactor'
  | 'adaptiveProbes'
  | 'tracingResolution'
  | 'gatherResolution'
  | 'gatherMips'
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
  let tile = settings.casts ? settings.downsampleFactor : Math.max(width, height)
  let found = geometryOfTile(width, height, tile, settings)
  while (tile < MAX_TILE && !atlasFits(found, settings, side)) {
    tile *= 2
    found = geometryOfTile(width, height, tile, settings)
  }
  return found
}

/** Whether the atlas of `geometry`, the widest of its textures along a row of probes, measures at most `side` texels (a device's `maxTextureDimension2D`). */
export const atlasFits = (geometry: ScreenProbeGeometry, settings: ShapeSettings, side: number) =>
  Math.max(geometry.tilesX, geometry.rows) *
    probeTexels(settings.tracingResolution, settings.gatherResolution, settings.gatherMips) <=
  side

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
  skipHairHits: 1 << 10,
  velocity: 1 << 11,
  fastUpdateClamp: 1 << 12,
  disocclusion: 1 << 13,
  occlusionTemporal: 1 << 14,
  fullResDepth: 1 << 15,
  skipFoliageHits: 1 << 16,
  cacheSky: 1 << 17,
  backfaceDiffuse: 1 << 18,
  rejectNormal: 1 << 19,
  skipUnlitHits: 1 << 20,
  occlusionInIntegration: 1 << 21,
  probeTemporal: 1 << 22,
  materialAo: 1 << 23,
  posesMoving: 1 << 24,
} as const

/**
 * The uniform every screen-probe kernel reads (`sp`), one table the writer's words and the shaders' struct
 * are drawn from: `size`, the image's size in pixels, the tile's side and the view's frame index (the noise of the passes the view's own frame
 * draws); `grid`, the uniform
 * probes along and across, the atlas's rows, the most adaptive probes; `mode`, the tile's jitter this
 * image and the last, the flags (`SCREEN_PROBE_FLAGS`) and the ray directions' turn; `counts`, the frames the
 * history keeps at most, the uniform probes and the screen trace's iterations; `weights`, the depth weights of the interpolation (the plane's,
 * then the fallback's, as exponents), the probability under which a ray is not traced and the intensity a ray is
 * held to; `spatial`, the spatial filter's position scale and its angle, the width the probes a pixel reads are
 * jittered and the furthest a ray looks; `occlusion`, the horizon search's slices, steps and foreground fraction and the scale of
 * the neighbourhood the history's occlusion is held to; `scene`, the bias off a surface a ray starts at, the history's relative
 * depth threshold, the cosine of the angle past which a history texel's normal is another surface's and the history's relative depth
 * threshold on the pixels that light their backface; `cache`, the radiance cache's radius scale (the
 * multiple of a probe's nearest ray start the direction a ray reads it by is moved onto a sphere of), the texels a side of its maps and
 * the levels of detail they hold, and the inverse of the distance the sky light leaks whole at, per metre (`w`); `motion`, the relative speed
 * difference from which a ray's end moves, the inverse of the share of moving light from which the history gives
 * way, and the most it gives way by; `tuning`, the frames and the share of a probe's pixels that make it
 * disoccluded, the history's depth thickness and the relative thickness of the screen trace times the projection's
 * depth scale (`screenRelativeThickness`); `trace`, the scale of a surface's thickness where it has no distance field, the
 * linear steps that look for a thin feature past a hit, and the roughness past which a pixel's rough specular is its diffuse's
 * (`screenProbeMaxRoughnessToEvaluateRoughSpecular`, then the thin double-sided sheets'); `foliage`, the most the short-range
 * occlusion applies on a thin double-sided sheet's pixels (`screenProbeOcclusionFoliageStrength`, `x`) and the occlusion's intensity
 * (`screenProbeOcclusionIntensity`, `y`), which the rough specular's directions are weighed by, the plane's depth weight of the pixels that
 * have backface diffuse light (`z`, in the exponent like `weights.x`) and the albedo the occlusions' multiple bounces are capped at (`screenProbeOcclusionMaxAlbedo`, `w`); `screen`, the screen trace's start off a hair pixel along its ray, metres
 * (`screenProbeScreenTracesHairBias`, `x`), the share of the last image's probe radiance the temporal filter of the probes keeps (`y`), and the extra ambient
 * occlusion's furthest hit, metres, and exponent (`z`, `w`); `leak`, the sky light's share that leaks onto the surfaces the rays find, by channel (`xyz`), and the
 * roughness it is read at (`w`); `frames`, the frame indices the noise of three families of passes is drawn at, which a fixed index may move apart: the screen probes'
 * gather state (`x`: the probes' screen trace, the short-range occlusion and the light's last blend), the probes' jitter (`y`: the pixels' jitter and the probe they pick) and the stochastic
 * lighting's (`z`: the pixels' history test and the occlusion texel each reads; `w` unused); `traced`, the numbers of the rays cast through the scene's triangles in
 * metres (`screenProbeHardwareRayTracingBias`, `…NormalBias`, `…HairBias`, then the pull-back bias); `tracedHit`, what a hit of
 * theirs is read with (the cards' depth bias and the nearest hit that lights anything, centimetres) and the way a ray
 * avoids the geometry it starts on; `previous`, the inverse of
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
  ['foliage', 'vec4f'],
  ['screen', 'vec4f'],
  ['leak', 'vec4f'],
  ['frames', 'vec4u'],
  ['traced', 'vec4f'],
  ['tracedHit', 'vec4f'],
  ['previous', 'mat4x4f'],
] as const)
/** Bytes of the parameters. */
export const SCREEN_PROBE_PARAMS_BYTES = SCREEN_PROBE_PARAMS.words * 4

/** The indirect arguments the placement writes for the kernels over the probes in use (`probeArgs`): the workgroups
 *  of a kernel a probe a group at word `probes`, of one over the trace texels in groups of 8 × 8 at word `texels`. */
export const SCREEN_PROBE_ARGS = { probes: 0, texels: 3, words: 6 } as const
/** Words a probe's nine coefficients of the directions its pixels face hold, each a half float, two to a word (`spPdfLobes`): the tenth
 *  half is empty, so that no word is shared by the groups of two probes. */
export const PDF_LOBE_WORDS = 5
/** Words an entry of the scene rays' list holds: the ray's texel (`x | y << 16`). */
export const SCENE_RAY_WORDS = 1

/** The side of the tiles of pixels the integration is classified and dispatched in. */
export const INTEGRATE_TILE_SIDE = 8
/** The tiles of a view of the geometry's size whose integration runs at the reduction `downsample`: a list of the integration holds that many for each of its three modes. */
export const integrateTiles = (g: Pick<ScreenProbeGeometry, 'width' | 'height'>, downsample = 1) =>
  ceilDiv(ceilDiv(g.width, downsample), INTEGRATE_TILE_SIDE) *
  ceilDiv(ceilDiv(g.height, downsample), INTEGRATE_TILE_SIDE)
/** The most workgroups a dispatch holds along an axis on every device (WebGPU's default `maxComputeWorkgroupsPerDimension`): a mode with more tiles is dispatched
 *  in rows of this many. */
export const INTEGRATE_TILE_ROW = 65535
/** The modes the tiles of the integration are classified in, by their index in the order of their lists and their arguments: the simple one (the rough specular is the diffuse light over pi),
 *  the sampled one (the rough specular samples the lobe, and the diffuse light samples the pixel's BRDF where the integral method asks it) and the complete one (a tile with a hair
 *  pixel, which samples the whole sphere). */
export const INTEGRATE_TILE_MODE = { simple: 0, sampled: 1, complete: 2 } as const
/** The modes there are. */
export const INTEGRATE_TILE_MODE_COUNT = 3
/** Words of the integration's tile buffer: the indirect arguments of the integration of each mode (`x, y, z`, in the order of `INTEGRATE_TILE_MODE`), then the count of tiles each mode holds. */
export const INTEGRATE_TILE_ARGS_WORDS = INTEGRATE_TILE_MODE_COUNT * 4
/** The word at which the counts of the tiles of each mode start in the integration's tile buffer: after the arguments of every mode. */
export const INTEGRATE_TILE_COUNTS_AT = INTEGRATE_TILE_MODE_COUNT * 3
/** Bytes at which the indirect arguments of the integration of the mode `mode` (a value of `INTEGRATE_TILE_MODE`) start. */
export const integrateArgsAt = (mode: number) => mode * 3 * 4
