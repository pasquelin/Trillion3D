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
import { COC_TILE, MAX_DILATE_RADIUS, MIN_SCATTER_COC, SCATTER_GROUP_MARGIN } from './dofLayout.ts'

/**
 * WHAT ONE IMAGE DRAWS, decided on the processor from the settings, the lens and the image's size —
 * the reference's order of decisions: the rings and the post-filter, the scatter modes, the recombine
 * quality, the gather's size, the circle of confusion's largest radii, and from those the layers to
 * gather, the tiles' dilations, the mip levels of the setup and the budget of scattered sprites. A
 * plan with `idle` set draws nothing (the blur is smaller than a pixel).
 */

/** A layer a convolution gathers. */
export type Layer = 'foreground' | 'hole' | 'slight' | 'background'
/** The accumulators' qualities, as the gather's shader reads them (`gatherWgsl.ts`): the cheaper
 *  accumulator, the sorting one, the one that outputs the occlusion the scattered sprites read, the
 *  one that also gathers in layers. */
export const GATHER_QUALITY = { low: 0, high: 1, occlusion: 2, cinematic: 3 } as const
/** One convolution: a layer's gather, and the post-filter and the scatter that follow it. */
export interface Convolution {
  readonly layer: Layer
  readonly quality: number
  /** The rings of the kernel, the layer's. */
  readonly rings: number
  /** Whether the kernel takes the diaphragm's shape. */
  readonly bokeh: boolean
  /** Whether the output is filtered, and whether sprites are scattered over it. */
  readonly postfilter: boolean
  readonly scatter: boolean
}
/** One dilation of the tiles' circle ranges. */
export interface Dilation {
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
  /** The image, the gather (its size is the setup's too), the textures the gather's are made at, the
   *  tile grid, in texels. */
  readonly full: readonly [number, number]
  readonly gather: readonly [number, number]
  readonly buffer: readonly [number, number]
  readonly tiles: readonly [number, number]
  readonly divisor: 1 | 2
  /** The rings of the kernel, 3 to 5, and the post-filter: 0 none, 1 median, 2 maximum. */
  readonly rings: number
  readonly postfilter: 0 | 1 | 2
  /** Recombine quality, 0 to 2: none, 12 sample pairs of slight out of focus at full size, 16. */
  readonly recombine: number
  /** The largest circle radii, in gather texels: foreground (absolute) and background. */
  readonly maxForeground: number
  readonly maxBackground: number
  readonly maxBlur: number
  readonly gatherForeground: boolean
  readonly gatherBackground: boolean
  /** The dilations of the tiles, in order. */
  readonly dilations: readonly Dilation[]
  /** The mip levels of the setup the gather reads, and the size of the first, a multiple of 8 and of
   *  the coarsest level's texel. */
  readonly mips: number
  readonly reduced: readonly [number, number]
  /** The scatter budget: sprite groups of 2 × 2 samples, and whether each layer scatters. */
  readonly scatterGroups: number
  readonly foregroundScatter: boolean
  readonly backgroundScatter: boolean
  /** The convolutions, in the order they are gathered. */
  readonly convolutions: readonly Convolution[]
  /** The bokeh tables the passes read, each built when its flag holds and the shape is not a circle. */
  readonly gatherLut: boolean
  readonly scatterLut: boolean
  readonly recombineLut: boolean
  /** The error the kernel's centre's random offset adds to a radius. */
  readonly errorMultiplier: number
}

/** What the plan reads of the frame. */
export interface DofInput {
  readonly volume: ResolvedDepthOfField
  readonly settings: DepthOfFieldValues
  /** The image's size and the size of the textures it lies in, the top-left. */
  readonly image: readonly [number, number]
  readonly extent: readonly [number, number]
  /** The camera: the projection's cotangents and the nearest depth drawn. */
  readonly cotHorizontal: number
  readonly cotVertical: number
  readonly near: number
}

/** The index of `value` among `names`. */
const indexOf = (names: readonly string[], value: string) => names.indexOf(value)

/** The tiles' dilations: one stand-alone pass where the largest circle's tiles fit the radius a
 *  pass reads, else the minimum foreground and maximum background spread by as many passes as needed,
 *  then everything else by the same. */
function dilationsFor(maxBlur: number, errorMultiplier: number): Dilation[] {
  const tileSpread = ceilDiv(maxBlur * errorMultiplier, COC_TILE)
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

/** The convolutions an image gathers, in the reference's order. */
function convolutionsFor(
  input: DofInput,
  rings: number,
  recombine: number,
  scatter: { foreground: boolean; background: boolean },
  gathers: { foreground: boolean; background: boolean },
  bokeh: { gather: boolean; slight: boolean },
): Convolution[] {
  const { settings } = input
  const low = settings.depthOfFieldAccumulator === 'low'
  const cinematic = settings.depthOfFieldAccumulator === 'cinematic'
  const postfilter = settings.depthOfFieldPostfilter !== 'none'
  const list: Convolution[] = []
  if (gathers.foreground)
    list.push({
      layer: 'foreground',
      quality: low ? GATHER_QUALITY.low : GATHER_QUALITY.high,
      rings,
      bokeh: bokeh.gather,
      postfilter,
      scatter: scatter.foreground,
    })
  if (recombine > 0)
    list.push({
      layer: 'hole',
      quality: GATHER_QUALITY.high,
      rings,
      bokeh: false,
      postfilter: false,
      scatter: false,
    })
  if (recombine > 0)
    list.push({
      layer: 'slight',
      quality: GATHER_QUALITY.high,
      rings: 3,
      bokeh: bokeh.slight,
      postfilter: false,
      scatter: false,
    })
  if (gathers.background) {
    const occluded = scatter.background && settings.depthOfFieldBackgroundScatter === 'occlusion'
    list.push({
      layer: 'background',
      quality: occluded
        ? cinematic
          ? GATHER_QUALITY.cinematic
          : GATHER_QUALITY.occlusion
        : GATHER_QUALITY.low,
      rings,
      bokeh: bokeh.gather,
      postfilter,
      scatter: scatter.background,
    })
  }
  return list
}

/** The largest circle radii of an image, in gather texels. */
function radiiOf(coc: CocModel, gatherWidth: number, near: number) {
  const maxBackground = maxBackgroundRadius(coc, gatherWidth)
  const maxForeground = Math.abs(cocRadiusAt(coc, near, gatherWidth))
  return { maxBackground, maxForeground, maxBlur: Math.max(maxBackground, maxForeground) }
}

/** The layers that scatter sprites, and the share of the image's quads the budget holds. */
function scatterOf(settings: DepthOfFieldValues, radii: ReturnType<typeof radiiOf>) {
  const ratio = clamp(settings.depthOfFieldScatterMaxRatio, 0, 1)
  const least = Math.max(settings.depthOfFieldScatterMinRadius, MIN_SCATTER_COC)
  const wanted = (mode: string, radius: number) => mode !== 'off' && radius > least && ratio > 0
  return {
    ratio,
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

/** The plan of an image; `idle` where the largest blur is smaller than the least the recombine draws. */
export function planDepthOfField(input: DofInput): DofPlan {
  const { volume, settings, image, extent } = input
  const rings = clamp(settings.depthOfFieldRingCount, 3, 5)
  const recombine = indexOf(DEPTH_OF_FIELD_RECOMBINES, settings.depthOfFieldRecombine)
  const divisor = settings.depthOfFieldGatherDivisor >= 2 ? 2 : 1
  const gather = [ceilDiv(image[0], divisor), ceilDiv(image[1], divisor)] as const
  const buffer = [ceilDiv(extent[0], divisor), ceilDiv(extent[1], divisor)] as const
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
  const shaped = bokeh.shape !== 'circle'
  const bokehSettings = {
    gather: shaped && settings.depthOfFieldGatherBokeh,
    slight: shaped && recombine > 0 && settings.depthOfFieldRecombineBokeh,
  }
  const errorMultiplier = 1 + 1 / (rings + 0.5)
  const minRequired = recombine > 0 ? settings.depthOfFieldRecombineMinBlur * 0.5 : 1
  return {
    idle: !(radii.maxBlur >= minRequired),
    coc,
    bokeh,
    full: image,
    gather,
    buffer,
    tiles: [ceilDiv(gather[0], COC_TILE), ceilDiv(gather[1], COC_TILE)],
    divisor,
    rings,
    postfilter: indexOf(DEPTH_OF_FIELD_POSTFILTERS, settings.depthOfFieldPostfilter) as 0 | 1 | 2,
    recombine,
    ...radii,
    gatherForeground: gathers.foreground,
    gatherBackground: gathers.background,
    dilations: dilationsFor(radii.maxBlur, errorMultiplier),
    ...mipsOf(settings, radii.maxBlur, rings, buffer),
    scatterGroups: Math.max(
      scatter.ratio * 0.25 * buffer[0] * buffer[1] - SCATTER_GROUP_MARGIN,
      SCATTER_GROUP_MARGIN,
    ),
    foregroundScatter: scatter.foreground,
    backgroundScatter: scatter.background,
    convolutions: convolutionsFor(input, rings, recombine, scatter, gathers, bokehSettings),
    gatherLut: bokehSettings.gather,
    scatterLut: shaped && (settings.depthOfFieldScatterBokeh || bokehSettings.slight),
    recombineLut: bokehSettings.slight,
    errorMultiplier,
  }
}

/** One pass of the reduction of the setup: the first one writes the setup's own level and the next; each
 *  after it reads the last level written and writes the next one or two (`from`, `to`, `count`). */
export interface ReducePass {
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
