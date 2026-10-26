import { PLAN_PIPELINE_MASK } from './planEntry.ts'
import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { ranksOf } from '../../../../math/src/sequence/ranks.ts'
import { BLEND_MODES, modulatesScene } from '../../materials/surface/materialBlending.ts'
import { BLEND_LIGHTINGS, type LightingProgram } from '../../materials/surface/blendLightSource.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'

/** THE CULL TABLE of a blend mode's pipelines, in rank order: one pipeline per cull mode
 *  (`../stagePipelines.ts`), and per lighting program (`BLEND_LIGHTINGS`), a pipeline rank its VARIANT's
 *  rank times their count plus its cull's (`plan.ts`) — a variant a blend mode and a lighting, the mode's
 *  rank times the lightings' plus the lighting's; the vertex stage culls by the same ranks (`../facing.ts`). */
export const CULL_MODES = ['none', 'front', 'back'] as const satisfies readonly GPUCullMode[]
/** Each cull mode's rank in `CULL_MODES`, and their count. */
export const CULL_RANK = ranksOf(CULL_MODES)
const CULL_RANKS = CULL_MODES.length
const LIGHTINGS = BLEND_LIGHTINGS.length
/** The cull rank of pipeline rank `rank`, its variant's rank (`variantOf`, the blend mode's times the lightings plus the lighting's),
 *  and the first pipeline rank of variant `variant`. */
export const cullOf = (rank: number) => rank % CULL_RANKS
const variantBase = (variant: number) => variant * CULL_RANKS
/** The variant of the pipeline rank `rank`, a blend mode's and a lighting's: none for a rank past the blend modes'. */
export const variantOf = (rank: number) => Math.floor(rank / CULL_RANKS)
/** The variants a blend pass compiles: every blend mode in every lighting. */
const BLEND_VARIANTS = BLEND_MODES.length * LIGHTINGS
/** The variant of blend mode `blending` in `lighting`, and the mode and the lighting a variant is. */
export const variantOfBlend = (blending: Blending, lighting: LightingProgram) =>
  BLEND_MODES.indexOf(blending) * LIGHTINGS + BLEND_LIGHTINGS.indexOf(lighting)
export const variantBlending = (variant: number): Blending | undefined =>
  BLEND_MODES[Math.floor(variant / LIGHTINGS)]
export const variantLighting = (variant: number): LightingProgram =>
  BLEND_LIGHTINGS[variant % LIGHTINGS]
/** The blend mode of pipeline rank `rank` (none for a transmissive rank), its lighting, and the first pipeline
 *  rank of blend mode `blending` in `lighting`. */
export const blendingOf = (rank: number): Blending | undefined => variantBlending(variantOf(rank))
export const lightingOf = (rank: number): LightingProgram => variantLighting(variantOf(rank))
export const pipelineBase = (blending: Blending, lighting: LightingProgram) =>
  variantBase(variantOfBlend(blending, lighting))
/** Whether `rank` draws a mode that multiplies the scene (`modulatesScene`): on the modulation
 *  target, where the others draw on the translucency target. A transmissive rank is neither. */
export const modulatesRank = (rank: number) => modulatesScene(blendingOf(rank))
/** The first pipeline rank past the blend modes': a transmissive item's culls, its layer lit and composed
 *  as a thin translucent layer (`../transmission/transmitWgsl.ts`), three culls for each of four
 *  kinds — one that bends nothing and transmits all channels alike (`TRANSMIT_BASE`), one that refracts,
 *  then those two again for a transmittance that differs by channel (`chromaRank`), which the dual blend
 *  alone keeps — and whether `rank` is one of them. The refracting kinds are the plan's choice, so a
 *  layer that bends nothing never enters the distortion's accumulation, which draws only the
 *  surfaces that refract. */
const TRANSMIT_BASE = variantBase(BLEND_VARIANTS)
export const transmitsRank = (rank: number) => rank >= TRANSMIT_BASE && rank < WATER_BASE
/** The first rank of the transmissive kind that `refracts` and is `chromatic`. */
export const transmitBase = (refracts: boolean, chromatic: boolean) =>
  TRANSMIT_BASE + CULL_RANKS * (+refracts + 2 * +chromatic)
/** Whether `rank` is of a transmissive kind that refracts, and whether it is one whose transmittance
 *  differs by channel. */
export const refractsRank = (rank: number) =>
  transmitsRank(rank) && Math.floor((rank - TRANSMIT_BASE) / CULL_RANKS) % 2 === 1
export const chromaRank = (rank: number) => rank >= transmitBase(false, true) && rank < WATER_BASE
/** A single-layer water item's three culls, past the transmissive kinds' (`../water/`): the water pass
 *  draws them alone, over the scene without them, and no other pass draws them. */
export const WATER_BASE = transmitBase(false, true) + 2 * CULL_RANKS
export const waterRank = (rank: number) => rank >= WATER_BASE

/** Whether a transmissive `surface` may transmit some channels more than others: a base colour that is
 *  not grey, or one that a map, the vertex colours or a graph give per pixel. Any other transmits all
 *  channels alike, and the layer is then one blend on the translucency target. */
export const chromaticSurface = (surface: {
  baseColor: readonly number[]
  map?: unknown
  vertexColors?: boolean
  graph?: unknown
}) =>
  !!surface.map ||
  !!surface.vertexColors ||
  !!surface.graph ||
  surface.baseColor[0] !== surface.baseColor[1] ||
  surface.baseColor[1] !== surface.baseColor[2]

/** Cull mode of the entry, whoever applies it: its rank among the pipelines of its mode. */
export const planCull = (entry: number) => cullOf(entry & PLAN_PIPELINE_MASK)

/** `planCull` as the expansion kernel reads it (`../expand/expandWgsl.ts`). */
export const PLAN_CULL_WGSL = wgslFn(
  'planCull',
  [],
  `fn planCull(entry:u32)->u32{return (entry&${PLAN_PIPELINE_MASK}u)%${CULL_RANKS}u;}`,
)
