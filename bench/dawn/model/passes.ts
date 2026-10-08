// The work of each GPU pass of a WebGPU frame, as a formula in what the frame holds: P pixels drawn
// (the render size), D display pixels, the covered share of P, T triangles and R clusters drawn,
// N placements the cut walks, L shadowed lights projected and the share of P they reach, the
// rough-reflective share of P. Each constant is the shipped code's (`source`, file:line under
// `packages/sdk-browser/src/`). Compulsory work only: a data-dependent walk (a shadow ray's
// march past its first sample, a reflection ray's steps) is counted at its least, so what a pass
// takes above its floor (`floor.ts`) holds those walks. Pure.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { hizLevelSizes } from '../../../packages/sdk-browser/src/gpu/hiz/levelSizes.ts'
import { PRIMITIVE_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/cameraRanges.ts'
import {
  VSM_TRACE_RAYS_SUN,
  VSM_TRACE_STEPS_SUN,
} from '../../../packages/sdk-browser/src/vsm/constants.ts'
import { countTaaFetches } from '../../runner/counts/taaFetchCount.ts'
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

/** A pass: its bench label (`../summary.ts`, `passKey`), its formula, its work, its constants. */
export type PassModel = {
  label: string
  formula: string
  work: (f: Frame) => Work
  source: string
}

/** Bytes of a covered pixel's material surfaces: three rgba16float, the r8uint flags, the
 *  rg32uint shadow receiver (`visibility/shader/receiverTargetWgsl.ts:13`). */
const SURFACE_BYTES = 3 * 8 + 1 + 8
/** The deferred resolve's reads of a covered pixel: flags, base, depth, normal, emission and
 *  occlusion (`lighting/deferred/surfaceWgsl.ts:43-51`), the receiver and the mask word and tile
 *  (`lighting/direct/shadowWgsl.ts:543-548`); its writes: the HDR and the unfogged source. */
const LIGHTING_READ = 1 + 8 + 4 + 8 + 8 + 8 + 4 + 4,
  LIGHTING_WRITE = 8 + 8
/** The shadow setup's footprint: eight neighbour depths a covered pixel (ENGINE.md, "Direct
 *  lighting"), the screen ray's start and four samples (`vsm/projectionWgsl.ts:275`). */
const FOOTPRINT = 8,
  SCREEN_RAY = 5
/** A shadow ray's sample: a page-table word, then the depth texel it names. */
const SAMPLE_FETCHES = 2
/** TAA: fetches a display pixel of a moving image drawn at half the display per axis (counted by
 *  running the shipped resolve, `bench/runner/counts/taaFetchCount.ts`, at the scales it counts:
 *  half the display per axis below it, else the display's); its four targets,
 *  rgba16float, rgba8unorm, rg32uint, r32uint (`taa/resolve.ts:59-62`), written and read back as
 *  history; its render inputs read once: colour, depth, identifier, flags. */
const TAA_TARGET_BYTES = 8 + 4 + 8 + 4,
  TAA_INPUT_BYTES = 8 + 4 + 4 + 1
/** The cut's dependent dispatches per frame besides one per DAG level (`gpu/dag/encode.ts:96-150`):
 *  arms, clear, prepare, root, wanted, mask, prefix, scatter, sort, eviction. */
const DAG_FIXED_DISPATCHES = 12

/** Texel reads and writes of the Hi-Z pyramid of a P-pixel square-ish image: level 0's copy, then
 *  four reads and one write a texel of every coarser level (`gpu/hiz/levelSizes.ts`). */
const hizTexels = (P: number) => {
  const w = Math.round(Math.sqrt(P * (16 / 9))),
    h = Math.round(P / w)
  return hizLevelSizes(w, h)
    .slice(1)
    .reduce((total, [a, b]) => total + 5 * a * b, 2 * w * h)
}

export const PASSES: PassModel[] = [
  {
    label: 'DAG selection',
    formula: 'N·64 B rows + R·64 B; ≈ 12 + levels dependent dispatches',
    work: (f) => ({
      bytes: (f.N + f.R) * PRIMITIVE_BYTES,
      passes: 1,
      dispatches: DAG_FIXED_DISPATCHES + 8,
    }),
    source: 'gpu/dag/encode.ts:115 (one root a placement), gpu/dag/cameraRanges.ts:6',
  },
  {
    label: 'partition',
    formula: 'R·(row 64 B + counts); 2 dispatches',
    work: (f) => ({ bytes: f.R * 80, passes: 2 }),
    source: 'webgpu/pages/render/encodeVis.ts:72-84',
  },
  {
    label: 'visibility primary',
    formula: 'T triangles; P·cover fragments; 8 B a pixel (r32uint id + depth32float)',
    work: (f) => ({ triangles: f.T, fragments: f.P * f.cover, bytes: 8 * f.P, passes: 1 }),
    source: 'webgpu/visibility/pipelines.ts:31-36, webgpu/pages/prepare/targets.ts:193',
  },
  {
    label: 'HiZ',
    formula: '2P + 5·Σ levels texels, 4 B each',
    work: (f) => ({ texels: hizTexels(f.P), bytes: 4 * hizTexels(f.P), passes: 1 }),
    source: 'gpu/hiz/levelSizes.ts:1, bench/runner/counts/frameBudgetRates.ts (hizAccesses)',
  },
  {
    label: 'material cache and tiles',
    formula: 'P identifiers read (4 B), 32×32 tiles listed',
    work: (f) => ({ texels: f.P, bytes: 4 * f.P, passes: 1 }),
    source: 'visibility/shader/materialTilesWgsl.ts:18',
  },
  {
    label: 'material surfaces v1',
    formula: 'P·cover·(4 B id + 33 B surfaces); 13 fetches (id, 3 indices, 3×3 attributes)',
    work: (f) => ({
      bytes: f.P * f.cover * (4 + SURFACE_BYTES),
      texels: 13 * f.P * f.cover,
      pixelsMrt4: f.P * f.cover,
      passes: 1,
    }),
    source: 'ENGINE.md "Material surfaces"; visibility/shader/receiverTargetWgsl.ts:13',
  },
  {
    label: 'vsm.marking',
    formula:
      'P/4 pixels (a stride of 2 each way) × (depth 4 + normal 8 + flags 1 B, a light-grid cell) + page marks',
    work: (f) => ({ bytes: (13 * f.P) / 4, texels: f.P, passes: 1 }),
    source: 'webgpu/pages/render/vsm/vsmEncode.ts:136-172, SHADOWS.md "One frame" step 4',
  },
  {
    label: 'vsm.projection',
    formula: `P·cover·(21 B + ${SCREEN_RAY} fetches) + P·cover·reach·L·(1 ray of ${VSM_TRACE_STEPS_SUN + 1} samples × 2 fetches) at least; up to ${VSM_TRACE_RAYS_SUN} rays; 4 B a pixel a layer of 4 lights`,
    work: (f) => {
      const lit = f.P * f.cover
      const samples = lit * f.reach * f.L * (VSM_TRACE_STEPS_SUN + 1) * SAMPLE_FETCHES
      return {
        texels: lit * SCREEN_RAY + samples,
        bytes: lit * 21 + 4 * f.P * ceilDiv(f.L, 4),
        passes: 1,
      }
    },
    source: 'vsm/constants.ts:236-239, vsm/projectionWgsl.ts:71-82,275',
  },
  {
    label: 'deferred lighting',
    formula: `P·cover·(${LIGHTING_READ} B read + ${LIGHTING_WRITE} B written + ${FOOTPRINT} footprint fetches)`,
    work: (f) => ({
      bytes: f.P * f.cover * (LIGHTING_READ + LIGHTING_WRITE),
      texels: f.P * f.cover * (7 + FOOTPRINT),
      fragments: f.P,
      passes: 1,
    }),
    source: 'lighting/deferred/surfaceWgsl.ts:43-58, lighting/direct/shadowWgsl.ts:543-548',
  },
  {
    label: 'rough reflection trace',
    formula: 'P·rough/4 rays (one a 2×2 block), each ≥ 6 fetches; its walk ≤ w + h steps',
    work: (f) => ({ texels: (f.P * f.rough * 6) / 4, fragments: f.P / 4, passes: 1 }),
    source: 'reflections/encode.ts:45-53, reflections/traceShader.ts:182',
  },
  {
    label: 'reflection filter',
    formula: 'P·rough/4 texels × 17 taps (16 + centre)',
    work: (f) => ({ texels: (f.P * f.rough * 17) / 4, fragments: f.P / 4, passes: 1 }),
    source: 'reflections/resolveWgsl.ts:21,223',
  },
  {
    label: 'reflection history resolve',
    formula: 'P·rough·(4 owners + 4 history) fetches, 16 B written',
    work: (f) => ({ texels: f.P * f.rough * 8, bytes: 16 * f.P * f.rough, passes: 1 }),
    source: 'reflections/historyRuntime.ts',
  },
  {
    label: 'temporal antialiasing',
    formula: `D·(30 fetches + ${2 * TAA_TARGET_BYTES} B targets written and read back) + P·${TAA_INPUT_BYTES} B`,
    work: (f) => ({
      texels: f.D * countTaaFetches(f.P < 0.9 * f.D ? 0.5 : 1, false).fetches,
      bytes: 2 * TAA_TARGET_BYTES * f.D + TAA_INPUT_BYTES * f.P,
      passes: 1,
    }),
    source: 'taa/resolve.ts:59-62, bench/runner/counts/taaFetchCount.ts',
  },
  {
    label: 'HDR composition + present',
    formula: 'D·(8 B read + 2 × 4 B written)',
    work: (f) => ({ bytes: 16 * f.D, texels: f.D, passes: 1 }),
    source: 'ENGINE.md "Material surfaces" (composition writes capture and canvas)',
  },
]
