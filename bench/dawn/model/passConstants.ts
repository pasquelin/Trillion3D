// What the cost model's passes (`passes.ts`) are written in: the frame they count, a pass's shape,
// and their constants, each the shipped code's, the source that holds it cited beside the pass
// that counts it.
import { countTaaFetches, type TaaPass } from '../../runner/counts/taaFetchCount.ts'
import { hizCullAccesses, hizNearestAccesses } from '../../runner/counts/frameBudgetRates.ts'
import {
  DEFAULT_REFLECTION_LEVEL,
  REFLECTION_LEVEL_KNOBS,
} from '../../../packages/sdk-core/src/contracts/reflectionLevels.ts'
import { REFLECTION_RULES } from '../../../packages/sdk-core/src/contracts/reflectionOptions.ts'
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

/** A pass: its bench label (`../report/summary.ts`, `passKey`), its formula, its work, its sources. */
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
/** A source of the core package's tree, `packages/sdk-core/src/`. */
export const core = (path: string, symbol: string): Source => ({
  path: `packages/sdk-core/src/${path}`,
  symbol,
})

/** Bytes of a covered pixel's material surfaces, and of a pixel the material pass's clear writes:
 *  three rgba16float, the r32uint flags. */
export const SURFACE_BYTES = 3 * 8 + 4
/** The material surfaces' fetches a covered pixel: its identifier, its triangle's three indices,
 *  three attributes of each of its three vertices. */
export const SURFACE_FETCHES = 1 + 3 + 3 * 3
/** What the lighting's passes read of a covered pixel, in bytes: the r32uint flags (4), the base colour
 *  and metalness (8), the normal and roughness (8), the emission and occlusion (8), the depth (4); the
 *  surface colour pass reads no normal nor depth, the fog pass the flags and the depth alone. */
export const PIXEL_FLAGS = 4,
  PIXEL_BASE = 8,
  PIXEL_NORMAL = 8,
  PIXEL_EMISSION = 8,
  PIXEL_DEPTH = 4
/** The lit image's texel, rgba16float: a pass that adds to it reads it and writes it again. */
export const HDR_TEXEL = 8
/** A covered pixel's shadow mask: the tile word and the layer's word (`vsmMaskWgsl`), and the reflection
 *  target's texel and the ambient occlusion's byte the indirect pass reads. */
export const MASK_BYTES = 4 + 4,
  REFLECTION_BYTES = 8,
  OCCLUSION_BYTES = 1
/** The shadow ray's depth reads: the start and its four samples (`vsmScreenRayCast`); the bytes a covered
 *  pixel's projection reads and writes. */
export const SCREEN_RAY = 1 + 4,
  PROJECTION_BYTES = 21
/** A shadow ray's sample: a page-table word, then the depth texel it names. */
export const SAMPLE_FETCHES = 2
/** The fetches a display pixel of pass `pass`: an analysis pass's a render texel times the render
 *  texels a display pixel holds (half the display per axis below it, else the display's), the
 *  update's and the resolves' their own. */
export const taaPassFetches = (f: Pick<Frame, 'P' | 'D'>, pass: TaaPass) => {
  const scale = f.P < 0.9 * f.D ? 0.5 : 1
  const fetches = countTaaFetches(scale).passes[pass]
  const display = pass === 'updateHistory' || pass.startsWith('resolve')
  return display ? fetches : fetches * scale * scale
}
/** The cut's dependent dispatches per frame (`encodeDagKernels`), a cut in one pass, counted on its
 *  encoder by the model's test: five whatever the levels — prepare, the wanted behind its arming,
 *  the finish, the drawn list behind its arming; pass 0 runs flat, unarmed, one less —, and two a
 *  level — its kernel and its arming —; the levels the model counts. */
export const DAG_FIXED_DISPATCHES = 5,
  DAG_LEVEL_DISPATCHES = 2,
  DAG_LEVELS = 8
/** The binning's dependent dispatches a raster pass (`createGpuDecode`, `createGpuBins`): the plan,
 *  the decode, the deformation's plan, the count, the reservation, the scatter and the finalizing. */
export const BINNING_DISPATCHES = 7
/** The visibility work buffer's bytes a pixel: the depth key and the identifier, two u32 words
 *  each phase of the hardware and software rasters writes by atomic maximum. */
export const VISIBILITY_BYTES = 4 + 4
/** The export's shading mask a pixel (`visibility/raster/exportWgsl.ts`): one r32uint word, the pixel's
 *  bin, which the bins' kernels read in place of the identifier. */
export const SHADING_MASK_BYTES = 4
/** The shading bins' words: a pixel's 4-byte identifier, read by the count and by the scatter, and
 *  a covered pixel's 4-byte word, written by the scatter and read by its class. */
export const BIN_WORD_BYTES = 4
/** The marking pass: a pixel of four (a stride of 2 each way), its depth, normal and r32uint flags
 *  read. */
export const MARK_STRIDE = 4,
  MARK_BYTES = 4 + 8 + 4
/** The reflection's march of a reflecting pixel's lobe ray (`screenMarch`): its iterations, 16 on average
 *  and 35 at the 99th percentile over the proof scenes, each reading a cell of the depth pyramid —
 *  the finished depth's farthest and the nearest (two texels), or at level 0 the depth, the
 *  transparent surface's depth and the slopes (`hizPlane`, three). The model counts the dearer
 *  iteration, three; what a pass takes above the mean iterations holds the tail. */
export const MARCH_ITERATIONS = 16,
  MARCH_FETCHES = 3
/** What a reflecting pixel's screen stage reads besides its march (`traceScreen`): its flags, depth,
 *  normal and lobes; at the hit, two texels for whether the surface is a transparent one
 *  (`hizFrontOver`) and the one texel of the last lit image it lands in (`reflectionSeenAnswer`); it
 *  writes its 16-byte fresh texel and its 4-byte direction. A ray the screen left reads, in the scene
 *  stage (`traceScene`), its 16-byte entry, its partial texel, its pixel's flags, depth, normal and
 *  lobes, and writes its fresh texel; its march of the field and its read of the cache are the scene's, unmodelled here. The
 *  spatial reuse reads the fresh texel and the pixel's depth and normal, and each neighbour's texel,
 *  depth, normal and direction (the default level's `reconstructionSamples`, `REFLECTION_LEVEL_KNOBS`;
 *  the widening reads `reflectionBilateralSamples`); the temporal accumulation the scratch
 *  texel, depth and normal, four history texels and 21 fresh ones; the last pass the pixel's flags,
 *  depth, normal, lobes and base colour and its neighbours' history texels where its history is short;
 *  each writes 16 bytes, the last 8 (`HDR_FORMAT`). */
export const TRACE_SHARE = REFLECTION_LEVEL_KNOBS[DEFAULT_REFLECTION_LEVEL].downsample ** 2,
  TRACE_LOADS = 4,
  HIT_LOADS = 2 + 1,
  SCENE_LOADS = 2 + 4,
  GRID_BYTES = 16,
  RAY_BYTES = 4,
  SPATIAL_LOADS = 3 + REFLECTION_LEVEL_KNOBS[DEFAULT_REFLECTION_LEVEL].reconstructionSamples * 4,
  TEMPORAL_LOADS = 3 + 4 + 21,
  BILATERAL_LOADS = 5 + REFLECTION_RULES.reflectionBilateralSamples.default,
  TARGET_BYTES = 8
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

/** The composition: the HDR read, the capture and the canvas written. */
export const COMPOSE_READ = 8,
  COMPOSE_WRITE = 2 * 4
