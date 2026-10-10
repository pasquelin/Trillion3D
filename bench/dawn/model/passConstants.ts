// What the cost model's passes (`passes.ts`) are written in: the frame they count, a pass's shape,
// and their constants, each the shipped code's, the source that holds it cited beside the pass
// that counts it.
import { RECEIVER_TARGET_BYTES } from '../../../packages/sdk-browser/src/visibility/shader/receiverTargetWgsl.ts'
import { countTaaFetches } from '../../runner/counts/taaFetchCount.ts'
import {
  hizCullAccesses,
  hizLevelTexels,
  hizNearestAccesses,
} from '../../runner/counts/frameBudgetRates.ts'
import { REFLECTION_SIDE } from '../../../packages/sdk-browser/src/reflections/constants.ts'
import type { Work } from './floor.ts'

export type Frame = {
  P: number
  D: number
  cover: number
  T: number
  R: number
  N: number
  L: number
  /** The share of covered pixels a shadowed light reaches, on average over the L. */
  reach: number
  /** The share of P that reflects: a surface with a specular lobe (`surfaceReflects`). */
  reflecting: number
}

/** Where a pass's constants come from: a file of the repository and a symbol it holds — a name
 *  of its code, a heading of its text. */
export type Source = { path: string; symbol: string }

/** A pass: its bench label (`../summary.ts`, `passKey`), its formula, its work, its sources. */
export type PassModel = {
  label: string
  formula: string
  work: (f: Frame) => Work
  sources: Source[]
}

/** A source under `packages/sdk-browser/src/`. */
export const engine = (path: string, symbol: string): Source => ({
  path: `packages/sdk-browser/src/${path}`,
  symbol,
})

/** Bytes of a covered pixel's material surfaces: three rgba16float, the r8uint flags, the shadow
 *  receiver (`RECEIVER_TARGET_BYTES`). */
export const SURFACE_BYTES = 3 * 8 + 1 + RECEIVER_TARGET_BYTES
/** The material surfaces' fetches a covered pixel: its identifier, its triangle's three indices,
 *  three attributes of each of its three vertices. */
export const SURFACE_FETCHES = 1 + 3 + 3 * 3
/** The deferred resolve's reads of a covered pixel: flags, base, depth, normal, emission and
 *  occlusion (`LIGHT_SURFACE_ENTRY`), the receiver and the mask word and tile
 *  (`directShadowWgsl`); its fetches, one a texture; its writes: the HDR and the unfogged source. */
export const LIGHTING_READ = 1 + 8 + 4 + 8 + 8 + 8 + 4 + 4,
  LIGHTING_FETCHES = 7,
  LIGHTING_WRITE = 8 + 8
/** The shadow setup's footprint: eight neighbour depths a covered pixel (ENGINE.md, "Direct
 *  lighting"), the screen ray's start and four samples (`vsmProjectionTiles`); the bytes a covered
 *  pixel's projection reads and writes. */
export const FOOTPRINT = 8,
  SCREEN_RAY = 5,
  PROJECTION_BYTES = 21
/** A shadow ray's sample: a page-table word, then the depth texel it names. */
export const SAMPLE_FETCHES = 2
/** Lights a mask layer holds, a 4-byte word a pixel each. */
export const LIGHTS_A_LAYER = 4
/** TAA: its four targets, rgba16float, rgba8unorm, rg32uint, r32uint (`resolveTargetUsage`),
 *  written and read back as history; its render inputs read once: colour, depth, identifier,
 *  flags. Its fetches a display pixel are counted by running the shipped resolve
 *  (`countTaaFetches`): half the display per axis below it, else the display's. */
export const TAA_TARGET_BYTES = 8 + 4 + 8 + 4,
  TAA_INPUT_BYTES = 8 + 4 + 4 + 1
export const taaFetches = (f: Pick<Frame, 'P' | 'D'>) =>
  countTaaFetches(f.P < 0.9 * f.D ? 0.5 : 1, false).fetches
/** The cut's dependent dispatches per frame (`encodeDagKernels`), counted on its encoder by the
 *  model's test: ten whatever the levels — the first arming, clear, prepare, wanted, mask,
 *  prefix, scatter, commit, sort, eviction —, and two a level — its kernel and its arming —; the levels
 *  the model counts. */
export const DAG_FIXED_DISPATCHES = 10,
  DAG_LEVEL_DISPATCHES = 2,
  DAG_LEVELS = 8
/** The partition's bytes a cluster: its row, then its counts (`encodeVis`). */
export const PARTITION_ROW = 64,
  PARTITION_COUNTS = 16
/** The visibility target's bytes a pixel: the r32uint identifier and the depth32float depth. */
export const VISIBILITY_BYTES = 4 + 4
/** The material tiles' read: one 4-byte identifier a pixel, listed by 32×32 tiles. */
export const TILE_ID_BYTES = 4
/** The marking pass: a pixel of four (a stride of 2 each way), its depth, normal and flags read. */
export const MARK_STRIDE = 4,
  MARK_BYTES = 4 + 8 + 1
/** The reflection's march of a reflecting pixel (`reflectionMarch`): its iterations, 16 on average
 *  and 35 at the 99th percentile over the proof scenes, each reading a cell of the depth pyramid —
 *  the finished depth's farthest and the nearest, or at level 0 the depth and the slopes —, two
 *  texels. The model counts the mean; what a pass takes above it holds the tail. */
export const MARCH_ITERATIONS = 16,
  MARCH_FETCHES = 2
/** What a reflecting pixel's trace reads besides its march: its flags, base colour, depth and
 *  normal (`TRACE_SHADER`); at the hit, three depths for its normal (`reflectionHitNormal`) and one
 *  for the depth weight of the footprint (`reflectionDepthWeight`), then the radiance pyramid's four
 *  bilinear taps of a coarse level (`reflectionLevelColor`, at least one tap of the footprint); its
 *  8 bytes written (`REFLECTION_FORMAT`). */
export const TRACE_LOADS = 4,
  HIT_LOADS = 3 + 1,
  HIT_TAPS = 4,
  TRACE_BYTES = 8
/** The radiance pyramid (`RADIANCE_SHADER`): the lit image's 8 bytes a pixel read once and written
 *  as level 0, the coarser levels written beside; the odd levels filled by four bilinear taps a
 *  texel over a tile with a texel of halo each side (`radianceFill`), the even ones summed in
 *  workgroup memory. */
export const RADIANCE_BYTES = 8,
  RADIANCE_TAPS = 4,
  RADIANCE_HALO = ((2 * REFLECTION_SIDE + 2) / (2 * REFLECTION_SIDE)) ** 2

/** The size of a P-pixel 16:9 image. */
const sizeOf = (P: number) => {
  const w = Math.round(Math.sqrt(P * (16 / 9)))
  return [w, Math.round(P / w)] as const
}
/** Texel reads and writes, for a P-pixel image, of the Hi-Z pyramid's culling layer build
 *  (`hizCullAccesses`) and of its nearest layer and the finished depth's farthest
 *  (`hizNearestAccesses`). */
export const hizCullTexels = (P: number) => hizCullAccesses(...sizeOf(P))
export const hizNearestTexels = (P: number) => hizNearestAccesses(...sizeOf(P))
/** Texels of the coarser levels of a P-pixel image's pyramid, and of the radiance pyramid's odd
 *  levels (a quarter of the image, and a sixteenth of that again, and so on). */
export const coarserTexels = (P: number) => hizLevelTexels(...sizeOf(P)).upper
export const oddLevelTexels = (P: number) => (P / 4) * (16 / 15)

/** The composition: the HDR read, the capture and the canvas written. */
export const COMPOSE_READ = 8,
  COMPOSE_WRITE = 2 * 4
