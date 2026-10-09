// What the cost model's passes (`passes.ts`) are written in: the frame they count, a pass's shape,
// and their constants, each the shipped code's, the source that holds it cited beside the pass
// that counts it.
import { RECEIVER_TARGET_BYTES } from '../../../packages/sdk-browser/src/visibility/shader/receiverTargetWgsl.ts'
import { countTaaFetches } from '../../runner/counts/taaFetchCount.ts'
import { hizAccesses } from '../../runner/counts/frameBudgetRates.ts'
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
  rough: number
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
 *  model's test: nine whatever the levels — the first arming, clear, prepare, wanted, mask,
 *  prefix, scatter, sort, eviction —, and two a level — its kernel and its arming —; the levels
 *  the model counts. */
export const DAG_FIXED_DISPATCHES = 9,
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
/** The rough reflections: a ray a 2×2 block, at least six fetches each; the filter's sixteen taps
 *  and its centre; the history's four owners and four history texels, 16 bytes written. */
export const REFLECTION_BLOCK = 4,
  TRACE_FETCHES = 6,
  FILTER_TAPS = 16 + 1,
  HISTORY_FETCHES = 4 + 4,
  HISTORY_BYTES = 16
/** The composition: the HDR read, the capture and the canvas written. */
export const COMPOSE_READ = 8,
  COMPOSE_WRITE = 2 * 4

/** Texel reads and writes of the Hi-Z pyramid of a P-pixel 16:9 image (`hizAccesses`). */
export const hizTexels = (P: number) => {
  const w = Math.round(Math.sqrt(P * (16 / 9)))
  return hizAccesses(w, Math.round(P / w))
}
