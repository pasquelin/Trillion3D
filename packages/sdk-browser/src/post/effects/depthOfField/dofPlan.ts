import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ResolvedDepthOfField } from '../../../../../sdk-core/src/contracts/depthOfFieldOptions.ts'
import {
  DEPTH_OF_FIELD_POSTFILTERS,
  DEPTH_OF_FIELD_RECOMBINES,
  type DepthOfFieldValues,
} from '../../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { compileBokehModel, type BokehModel } from './bokehModel.ts'
import { cocRadiusAt, compileCocModel, maxBackgroundRadius, type CocModel } from './cocModel.ts'
import { convolutionsFor, type Convolution } from './dofConvolutions.ts'
import { COC_TILE, MAX_DILATE_RADIUS, SCATTER_GROUP_MARGIN } from './dofLayout.ts'

/**
 * WHAT ONE IMAGE DRAWS, decided on the processor from the settings, the lens and the image's size —
 * the reference's order of decisions: the rings and the post-filter, the scatter modes, the recombine
 * quality, the gather's size, the circle of confusion's largest radii, and from those the layers to
 * gather, the tiles' dilations, the mip levels of the setup and the budget of scattered sprites. A
 * plan with `idle` set draws nothing (the blur is smaller than a pixel). The settings are the
 * contract's, already within their ranges (`depthOfFieldRules.ts`): the plan clamps none of them.
 */

/** One dilation of the tiles' circle ranges. */
interface Dilation {
  readonly mode: 'standalone' | 'minMax' | 'minAbs'
  /** Tiles each side the pass reads, 1 to 3, and the step between them, in tiles. */
  readonly radius: number
  readonly multiplier: number
}

/** What an image draws. */
export interface DofPlan {
  readonly idle: boolean
  readonly coc: CocModel
  readonly bokeh: BokehModel
  /** The image, the gather (its size is the setup's too) and the textures the gather's are made at,
   *  in texels. */
  readonly full: readonly [number, number]
  readonly gather: readonly [number, number]
  readonly buffer: readonly [number, number]
  /** The size the setup is accumulated in time at, and the textures it is made at: the display's over
   *  the divisor where the image is accumulated in time (the history keeps its resolution whatever the
   *  image is drawn at), else the gather's. The reduction, the quarter-size copy and the gather's reads
   *  are at that size, and the circles of confusion they hold are in its texels. */
  readonly pre: readonly [number, number]
  readonly preBuffer: readonly [number, number]
  readonly divisor: 1 | 2
  /** The rings of the kernel, 3 to 5, and the post-filter: 0 none, 1 median, 2 maximum. */
  readonly rings: number
  readonly postfilter: 0 | 1 | 2
  /** Recombine quality, 0 to 2: none, 12 sample pairs of slight out of focus at full size, 16. */
  readonly recombine: number
  /** Whether the setup is accumulated in time before the gather (the image is, by the temporal
   *  pass after this one), and at the stable quality. */
  readonly temporal: boolean
  readonly temporalHigh: boolean
  /** The dilations of the tiles, in order. */
  readonly dilations: readonly Dilation[]
  /** The mip levels of the setup the gather reads, and the size of the first, a multiple of 8 and of
   *  the coarsest level's texel. */
  readonly mips: number
  readonly reduced: readonly [number, number]
  /** The scatter budget: sprite groups of 2 × 2 samples. */
  readonly scatterGroups: number
  /** The convolutions, in the order they are gathered. */
  readonly convolutions: readonly Convolution[]
  /** The bokeh tables the passes read, each built when its flag holds and the shape is not a circle. */
  readonly gatherLut: boolean
  readonly scatterLut: boolean
  readonly recombineLut: boolean
  /** What decides the images and buffers the plan is drawn on: two plans with the same key are drawn on
   *  the same resources. */
  readonly key: string
  /** What decides the bind groups of its passes: the key, and what else says which resources a group
   *  names — the dilations, the tables, which layers take the diaphragm's shape. Two plans with the same
   *  groups key keep their groups; a lens animated image by image changes neither. */
  readonly groups: string
}

/** What the plan reads of the frame. */
interface DofInput {
  readonly volume: ResolvedDepthOfField
  readonly settings: DepthOfFieldValues
  /** The image's size and the size of the textures it lies in, the top-left. */
  readonly image: readonly [number, number]
  readonly extent: readonly [number, number]
  /** The camera: the projection's cotangents and the nearest depth drawn. */
  readonly cotHorizontal: number
  readonly cotVertical: number
  readonly near: number
  /** The display's size, which the image is rebuilt to by the temporal pass after this one. */
  readonly display: readonly [number, number]
  /** Whether the image is accumulated in time after this pass. */
  readonly temporal: boolean
}

/** The tile grid of a plan, in tiles of the gather's texels. */
export const tilesOf = (plan: Pick<DofPlan, 'gather'>) =>
  [ceilDiv(plan.gather[0], COC_TILE), ceilDiv(plan.gather[1], COC_TILE)] as const

/** The error the kernel's centre's random offset adds to a radius, as a ratio, of `rings` rings. */
export const errorMultiplierOf = (rings: number) => 1 + 1 / (rings + 0.5)

/** The tiles' dilations: one stand-alone pass where the largest circle's tiles fit the radius a
 *  pass reads, else the minimum foreground and maximum background spread by as many passes as needed,
 *  then everything else by the same. */
function dilationsFor(maxBlur: number, rings: number): Dilation[] {
  const tileSpread = ceilDiv(maxBlur * errorMultiplierOf(rings), COC_TILE)
  let reach = Math.min(tileSpread, MAX_DILATE_RADIUS)
  const radii = [reach],
    steps = [1]
  for (let at = 1; at < 3 && tileSpread > reach; at++) {
    const highest = reach + 1
    radii[at] = Math.min(Math.floor(tileSpread / highest), MAX_DILATE_RADIUS)
    steps[at] = Math.min(ceilDiv(tileSpread - reach, radii[1]), highest)
    reach += radii[at] * steps[at]
  }
  if (radii.length === 1) return [{ mode: 'standalone', radius: radii[0], multiplier: 1 }]
  const pass = (mode: Dilation['mode']) =>
    radii.map((radius, at) => ({ mode, radius, multiplier: steps[at] }))
  return [...pass('minMax'), ...pass('minAbs')]
}

/** The largest circle radii of an image, in gather texels. */
function radiiOf(coc: CocModel, gatherWidth: number, near: number) {
  const maxBackground = maxBackgroundRadius(coc, gatherWidth)
  const maxForeground = Math.abs(cocRadiusAt(coc, near, gatherWidth))
  return { maxBackground, maxForeground, maxBlur: Math.max(maxBackground, maxForeground) }
}

/** The layers that scatter sprites. */
function scatterOf(settings: DepthOfFieldValues, radii: ReturnType<typeof radiiOf>) {
  const ratio = settings.depthOfFieldScatterMaxRatio
  const least = settings.depthOfFieldScatterMinRadius
  const wanted = (mode: string, radius: number) => mode !== 'off' && radius > least && ratio > 0
  return {
    foreground: wanted(settings.depthOfFieldForegroundScatter, radii.maxForeground),
    background: wanted(settings.depthOfFieldBackgroundScatter, radii.maxBackground),
  }
}

/** The mip levels of the setup the gather reads, and the size of the first: a multiple of 8 and of
 *  the coarsest level's texel. */
function mipsOf(
  settings: DepthOfFieldValues,
  maxBlur: number,
  rings: number,
  buffer: readonly number[],
) {
  const wanted =
    Math.ceil(Math.log2((maxBlur * 0.5) / rings)) +
    (settings.depthOfFieldAccumulator === 'low' ? 1 : 0)
  const mips = clamp(wanted, 1, settings.depthOfFieldMaxMips)
  const multiple = Math.max(1 << (mips - 1), COC_TILE)
  const reduced = [
    multiple * ceilDiv(buffer[0], multiple),
    multiple * ceilDiv(buffer[1], multiple),
  ] as const
  return { mips, reduced }
}

/** The sprite groups of 2 × 2 samples the scatter may draw, at least the margin the groups need. */
const scatterBudget = (settings: DepthOfFieldValues, buffer: readonly number[]) =>
  Math.max(
    settings.depthOfFieldScatterMaxRatio * 0.25 * buffer[0] * buffer[1] - SCATTER_GROUP_MARGIN,
    SCATTER_GROUP_MARGIN,
  )

/** Which passes take the diaphragm's shape — the gather, the slight out of focus part, the sprites —:
 *  none where the shape is a circle. */
function bokehOf(settings: DepthOfFieldValues, bokeh: BokehModel, recombine: number) {
  const shaped = bokeh.shape !== 'circle'
  const slight = shaped && recombine > 0 && settings.depthOfFieldRecombineBokeh
  return {
    gather: shaped && settings.depthOfFieldGatherBokeh,
    slight,
    scatter: shaped && (settings.depthOfFieldScatterBokeh || slight),
  }
}

/** The key of the images and buffers of a plan made but for it: the sizes, the layers gathered and what
 *  scatters, the setup's accumulation, the sprites' budget. */
function resourceKey(plan: Omit<DofPlan, 'key' | 'groups'>) {
  const layers = plan.convolutions.map(
    (c) => `${c.layer}${c.quality}${c.postfilter ? 'f' : ''}${c.scatter ? 's' : ''}`,
  )
  return [
    plan.buffer,
    plan.preBuffer,
    plan.reduced,
    plan.divisor,
    plan.mips,
    plan.temporal,
    layers,
    Math.floor(plan.scatterGroups),
  ].join('|')
}

/** The sizes of a plan: the gather's and its textures', then the setup accumulation's and its textures'. */
function sizesOf(input: DofInput, divisor: number) {
  const over = (size: readonly number[]) =>
    [ceilDiv(size[0], divisor), ceilDiv(size[1], divisor)] as const
  const gather = over(input.image)
  const buffer = over(input.extent)
  const pre = input.temporal ? over(input.display) : gather
  const preBuffer = [Math.max(buffer[0], pre[0]), Math.max(buffer[1], pre[1])] as const
  return { gather, buffer, pre, preBuffer }
}

/** The ratio of the gather's width to the setup accumulation's: what a circle of confusion held in the
 *  setup's texels is multiplied by to be in the gather's. 1 where the two are the same size. */
export const circleRatio = (plan: Pick<DofPlan, 'gather' | 'pre'>) => plan.gather[0] / plan.pre[0]

/** The plan of an image; `idle` where the largest blur is smaller than the least the recombine draws. */
export function planDepthOfField(input: DofInput): DofPlan {
  const { volume, settings, image } = input
  const rings = settings.depthOfFieldRingCount
  const recombine = DEPTH_OF_FIELD_RECOMBINES.indexOf(settings.depthOfFieldRecombine)
  const divisor = settings.depthOfFieldGatherDivisor as 1 | 2
  const { gather, buffer, pre, preBuffer } = sizesOf(input, divisor)
  const view = {
    width: image[0],
    height: image[1],
    cotHorizontal: input.cotHorizontal,
    cotVertical: input.cotVertical,
  }
  const coc = compileCocModel(volume, view, {
    maxForeground: settings.depthOfFieldMaxForegroundRadius,
    maxBackground: settings.depthOfFieldMaxBackgroundRadius,
  })
  const bokeh = compileBokehModel(volume, coc.squeeze)
  const radii = radiiOf(coc, gather[0], input.near)
  const scatter = scatterOf(settings, radii)
  const gathers = { foreground: radii.maxForeground > 1, background: radii.maxBackground > 1 }
  const taking = bokehOf(settings, bokeh, recombine)
  const minRequired = recombine > 0 ? settings.depthOfFieldRecombineMinBlur * 0.5 : 1
  const plan = {
    idle: !(radii.maxBlur >= minRequired),
    coc,
    bokeh,
    full: image,
    gather,
    buffer,
    pre,
    preBuffer,
    divisor,
    rings,
    postfilter: DEPTH_OF_FIELD_POSTFILTERS.indexOf(settings.depthOfFieldPostfilter) as 0 | 1 | 2,
    recombine,
    temporal: input.temporal,
    temporalHigh: settings.depthOfFieldTemporalQuality === 'high',
    dilations: dilationsFor(radii.maxBlur, rings),
    ...mipsOf(settings, radii.maxBlur, rings, preBuffer),
    scatterGroups: scatterBudget(settings, preBuffer),
    convolutions: convolutionsFor(settings, {
      rings,
      recombine,
      scatter,
      gathers,
      bokeh: taking,
    }),
    gatherLut: taking.gather,
    scatterLut: taking.scatter,
    recombineLut: taking.slight,
  }
  const key = resourceKey(plan)
  const shapes = plan.convolutions.map((c) => (c.bokeh ? 1 : 0))
  const tables = [plan.gatherLut, plan.scatterLut, plan.recombineLut].map(Number)
  const groups = [key, plan.dilations.map((d) => d.mode), shapes, tables].join('|')
  return { ...plan, key, groups }
}

/** One pass of the reduction of the setup: the first one writes the setup's own level and the next; each
 *  after it reads the last level written and writes the next one or two (`from`, `to`, `count`). */
interface ReducePass {
  readonly first: boolean
  readonly from: number
  readonly to: number
  readonly count: number
}

/** The reduction's passes for `mips` levels: two a pass — the most a pass holds in four storage textures. */
export function reducePasses(mips: number): ReducePass[] {
  const first = Math.min(mips, 2)
  const passes: ReducePass[] = [{ first: true, from: 0, to: 0, count: first }]
  for (let done = first; done < mips; done += 2)
    passes.push({ first: false, from: done - 1, to: done, count: Math.min(mips - done, 2) })
  return passes
}
