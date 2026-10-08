// The work of each GPU pass of a WebGPU frame, as a formula in what the frame holds: P pixels drawn
// (the render size), D display pixels, the covered share of P, T triangles and R clusters drawn,
// N placements the cut walks, L shadowed lights projected and the share of P they reach, the
// rough-reflective share of P. Each constant is the shipped code's, cited by the symbol that holds
// it (`sources`), and each formula is written from the constants its work counts. Compulsory work
// only: a data-dependent walk (a shadow ray's march past its first sample, a reflection ray's
// steps) is counted at its least, so what a pass takes above its floor (`floor.ts`) holds those
// walks. Pure.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { RECEIVER_TARGET_BYTES } from '../../../packages/sdk-browser/src/visibility/shader/receiverTargetWgsl.ts'
import { PRIMITIVE_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/cameraRanges.ts'
import {
  VSM_TRACE_RAYS_SUN,
  VSM_TRACE_STEPS_SUN,
} from '../../../packages/sdk-browser/src/vsm/constants.ts'
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
const engine = (path: string, symbol: string): Source => ({
  path: `packages/sdk-browser/src/${path}`,
  symbol,
})

/** Bytes of a covered pixel's material surfaces: three rgba16float, the r8uint flags, the shadow
 *  receiver (`RECEIVER_TARGET_BYTES`). */
const SURFACE_BYTES = 3 * 8 + 1 + RECEIVER_TARGET_BYTES
/** The material surfaces' fetches a covered pixel: its identifier, its triangle's three indices,
 *  three attributes of each of its three vertices. */
const SURFACE_FETCHES = 1 + 3 + 3 * 3
/** The deferred resolve's reads of a covered pixel: flags, base, depth, normal, emission and
 *  occlusion (`LIGHT_SURFACE_ENTRY`), the receiver and the mask word and tile
 *  (`directShadowWgsl`); its fetches, one a texture; its writes: the HDR and the unfogged source. */
const LIGHTING_READ = 1 + 8 + 4 + 8 + 8 + 8 + 4 + 4,
  LIGHTING_FETCHES = 7,
  LIGHTING_WRITE = 8 + 8
/** The shadow setup's footprint: eight neighbour depths a covered pixel (ENGINE.md, "Direct
 *  lighting"), the screen ray's start and four samples (`vsmProjectionTiles`); the bytes a covered
 *  pixel's projection reads and writes. */
const FOOTPRINT = 8,
  SCREEN_RAY = 5,
  PROJECTION_BYTES = 21
/** A shadow ray's sample: a page-table word, then the depth texel it names. */
const SAMPLE_FETCHES = 2
/** Lights a mask layer holds, a 4-byte word a pixel each. */
const LIGHTS_A_LAYER = 4
/** TAA: its four targets, rgba16float, rgba8unorm, rg32uint, r32uint (`resolveTargetUsage`),
 *  written and read back as history; its render inputs read once: colour, depth, identifier,
 *  flags. Its fetches a display pixel are counted by running the shipped resolve
 *  (`countTaaFetches`): half the display per axis below it, else the display's. */
const TAA_TARGET_BYTES = 8 + 4 + 8 + 4,
  TAA_INPUT_BYTES = 8 + 4 + 4 + 1
const taaFetches = (f: Pick<Frame, 'P' | 'D'>) =>
  countTaaFetches(f.P < 0.9 * f.D ? 0.5 : 1, false).fetches
/** The cut's dependent dispatches per frame besides one per DAG level (`encodeDagKernels`): arms,
 *  clear, prepare, root, wanted, mask, prefix, scatter, sort, eviction; the levels the model
 *  counts. */
const DAG_FIXED_DISPATCHES = 12,
  DAG_LEVELS = 8
/** The partition's bytes a cluster: its row, then its counts (`encodeVis`). */
const PARTITION_ROW = 64,
  PARTITION_COUNTS = 16
/** The visibility target's bytes a pixel: the r32uint identifier and the depth32float depth. */
const VISIBILITY_BYTES = 4 + 4
/** The material tiles' read: one 4-byte identifier a pixel, listed by 32×32 tiles. */
const TILE_ID_BYTES = 4
/** The marking pass: a pixel of four (a stride of 2 each way), its depth, normal and flags read. */
const MARK_STRIDE = 4,
  MARK_BYTES = 4 + 8 + 1
/** The rough reflections: a ray a 2×2 block, at least six fetches each; the filter's sixteen taps
 *  and its centre; the history's four owners and four history texels, 16 bytes written. */
const REFLECTION_BLOCK = 4,
  TRACE_FETCHES = 6,
  FILTER_TAPS = 16 + 1,
  HISTORY_FETCHES = 4 + 4,
  HISTORY_BYTES = 16
/** The composition: the HDR read, the capture and the canvas written. */
const COMPOSE_READ = 8,
  COMPOSE_WRITE = 2 * 4

/** Texel reads and writes of the Hi-Z pyramid of a P-pixel 16:9 image (`hizAccesses`). */
const hizTexels = (P: number) => {
  const w = Math.round(Math.sqrt(P * (16 / 9)))
  return hizAccesses(w, Math.round(P / w))
}

export const PASSES: PassModel[] = [
  {
    label: 'DAG selection',
    formula: `(N + R)·${PRIMITIVE_BYTES} B rows; ${DAG_FIXED_DISPATCHES} + ${DAG_LEVELS} levels dependent dispatches`,
    work: (f) => ({
      bytes: (f.N + f.R) * PRIMITIVE_BYTES,
      passes: 1,
      dispatches: DAG_FIXED_DISPATCHES + DAG_LEVELS,
    }),
    sources: [
      engine('gpu/dag/encode.ts', 'encodeDagKernels'),
      engine('gpu/dag/cameraRanges.ts', 'PRIMITIVE_BYTES'),
    ],
  },
  {
    label: 'partition',
    formula: `R·(${PARTITION_ROW} B row + ${PARTITION_COUNTS} B counts); 2 dispatches`,
    work: (f) => ({ bytes: f.R * (PARTITION_ROW + PARTITION_COUNTS), passes: 2 }),
    sources: [engine('webgpu/pages/render/encodeVis.ts', 'encodeVis')],
  },
  {
    label: 'visibility primary',
    formula: `T triangles; P·cover fragments; ${VISIBILITY_BYTES} B a pixel (r32uint id + depth32float)`,
    work: (f) => ({
      triangles: f.T,
      fragments: f.P * f.cover,
      bytes: VISIBILITY_BYTES * f.P,
      passes: 1,
    }),
    sources: [
      engine('webgpu/visibility/pipelines.ts', 'VIS_TARGETS'),
      engine('webgpu/visibility/pipelines.ts', 'VIS_DEPTH'),
    ],
  },
  {
    label: 'HiZ',
    formula: '2P + 5·Σ levels texels, 4 B each',
    work: (f) => ({ texels: hizTexels(f.P), bytes: 4 * hizTexels(f.P), passes: 1 }),
    sources: [
      engine('gpu/hiz/levelSizes.ts', 'hizLevelSizes'),
      { path: 'bench/runner/counts/frameBudgetRates.ts', symbol: 'hizAccesses' },
    ],
  },
  {
    label: 'material cache and tiles',
    formula: `P identifiers read (${TILE_ID_BYTES} B), 32×32 tiles listed`,
    work: (f) => ({ texels: f.P, bytes: TILE_ID_BYTES * f.P, passes: 1 }),
    sources: [engine('visibility/shader/materialTilesWgsl.ts', 'MATERIAL_TILES_SHADER')],
  },
  {
    label: 'material surfaces v1',
    formula: `P·cover·(4 B id + ${SURFACE_BYTES} B surfaces); ${SURFACE_FETCHES} fetches (id, 3 indices, 3×3 attributes)`,
    work: (f) => ({
      bytes: f.P * f.cover * (4 + SURFACE_BYTES),
      texels: SURFACE_FETCHES * f.P * f.cover,
      pixelsMrt4: f.P * f.cover,
      passes: 1,
    }),
    sources: [
      { path: 'docs/ENGINE.md', symbol: 'Material surfaces' },
      engine('visibility/shader/receiverTargetWgsl.ts', 'RECEIVER_TARGET_BYTES'),
    ],
  },
  {
    label: 'vsm.marking',
    formula: `P/${MARK_STRIDE} pixels (a stride of 2 each way) × (depth 4 + normal 8 + flags 1 B, a light-grid cell) + page marks`,
    work: (f) => ({ bytes: (MARK_BYTES * f.P) / MARK_STRIDE, texels: f.P, passes: 1 }),
    sources: [
      engine('webgpu/pages/render/vsm/vsmEncode.ts', 'encodeVsmFrame'),
      { path: 'docs/SHADOWS.md', symbol: 'One frame' },
    ],
  },
  {
    label: 'vsm.projection',
    formula: `P·cover·(${PROJECTION_BYTES} B + ${SCREEN_RAY} fetches) + P·cover·reach·L·(1 ray of ${VSM_TRACE_STEPS_SUN + 1} samples × ${SAMPLE_FETCHES} fetches) at least; up to ${VSM_TRACE_RAYS_SUN} rays; 4 B a pixel a layer of ${LIGHTS_A_LAYER} lights`,
    work: (f) => {
      const lit = f.P * f.cover
      const samples = lit * f.reach * f.L * (VSM_TRACE_STEPS_SUN + 1) * SAMPLE_FETCHES
      return {
        texels: lit * SCREEN_RAY + samples,
        bytes: lit * PROJECTION_BYTES + 4 * f.P * ceilDiv(f.L, LIGHTS_A_LAYER),
        passes: 1,
      }
    },
    sources: [
      engine('vsm/constants.ts', 'VSM_TRACE_STEPS_SUN'),
      engine('vsm/constants.ts', 'VSM_TRACE_RAYS_SUN'),
      engine('vsm/projectionWgsl.ts', 'vsmProjectionTiles'),
    ],
  },
  {
    label: 'deferred lighting',
    formula: `P·cover·(${LIGHTING_READ} B read + ${LIGHTING_WRITE} B written + ${LIGHTING_FETCHES} + ${FOOTPRINT} footprint fetches)`,
    work: (f) => ({
      bytes: f.P * f.cover * (LIGHTING_READ + LIGHTING_WRITE),
      texels: f.P * f.cover * (LIGHTING_FETCHES + FOOTPRINT),
      fragments: f.P,
      passes: 1,
    }),
    sources: [
      engine('lighting/deferred/surfaceWgsl.ts', 'LIGHT_SURFACE_ENTRY'),
      engine('lighting/direct/shadowWgsl.ts', 'directShadowWgsl'),
    ],
  },
  {
    label: 'rough reflection trace',
    formula: `P·rough/${REFLECTION_BLOCK} rays (one a 2×2 block), each ≥ ${TRACE_FETCHES} fetches; its walk ≤ w + h steps`,
    work: (f) => ({
      texels: (f.P * f.rough * TRACE_FETCHES) / REFLECTION_BLOCK,
      fragments: f.P / REFLECTION_BLOCK,
      passes: 1,
    }),
    sources: [
      engine('reflections/encode.ts', 'encodeReflectionSource'),
      engine('reflections/traceShader.ts', 'screenTraceWgsl'),
    ],
  },
  {
    label: 'reflection filter',
    formula: `P·rough/${REFLECTION_BLOCK} texels × ${FILTER_TAPS} taps (16 + centre)`,
    work: (f) => ({
      texels: (f.P * f.rough * FILTER_TAPS) / REFLECTION_BLOCK,
      fragments: f.P / REFLECTION_BLOCK,
      passes: 1,
    }),
    sources: [engine('reflections/resolveWgsl.ts', 'REFLECTION_RESOLVE_WGSL')],
  },
  {
    label: 'reflection history resolve',
    formula: `P·rough·(${HISTORY_FETCHES} fetches: 4 owners + 4 history), ${HISTORY_BYTES} B written`,
    work: (f) => ({
      texels: f.P * f.rough * HISTORY_FETCHES,
      bytes: HISTORY_BYTES * f.P * f.rough,
      passes: 1,
    }),
    sources: [engine('reflections/historyRuntime.ts', 'createReflectionHistory')],
  },
  {
    label: 'temporal antialiasing',
    formula: `D·(${taaFetches({ P: 0, D: 1 })} fetches at half the display per axis + ${2 * TAA_TARGET_BYTES} B targets written and read back) + P·${TAA_INPUT_BYTES} B`,
    work: (f) => ({
      texels: f.D * taaFetches(f),
      bytes: 2 * TAA_TARGET_BYTES * f.D + TAA_INPUT_BYTES * f.P,
      passes: 1,
    }),
    sources: [
      engine('taa/resolve.ts', 'resolveTargetUsage'),
      { path: 'bench/runner/counts/taaFetchCount.ts', symbol: 'countTaaFetches' },
    ],
  },
  {
    label: 'HDR composition + present',
    formula: `D·(${COMPOSE_READ} B read + ${COMPOSE_WRITE} B written)`,
    work: (f) => ({ bytes: (COMPOSE_READ + COMPOSE_WRITE) * f.D, texels: f.D, passes: 1 }),
    sources: [{ path: 'docs/ENGINE.md', symbol: 'Material surfaces' }],
  },
]
