import type { DepthOfFieldValues } from '../../../../../sdk-core/src/contracts/depthOfFieldRules.ts'

/**
 * THE CONVOLUTIONS AN IMAGE GATHERS: which layers, with which accumulator, how many rings and whether
 * each takes the diaphragm's shape, filtered or scattered over (`dofPlan.ts` decides what they read).
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

/** What decides the convolutions: the rings, the recombine's quality and, by layer, which scatter,
 *  which are gathered and which take the diaphragm's shape. */
export interface Layers {
  readonly rings: number
  readonly recombine: number
  readonly scatter: { foreground: boolean; background: boolean }
  readonly gathers: { foreground: boolean; background: boolean }
  readonly bokeh: { gather: boolean; slight: boolean }
}

/** The quality the background's gather takes: the cheap one, but where its scatter occludes it. */
function backgroundQuality(settings: DepthOfFieldValues, occluded: boolean) {
  if (!occluded) return GATHER_QUALITY.low
  return settings.depthOfFieldAccumulator === 'cinematic'
    ? GATHER_QUALITY.cinematic
    : GATHER_QUALITY.occlusion
}

/** Whether `plan` gathers `layer`. */
export const gathersLayer = (
  plan: { readonly convolutions: readonly Convolution[] },
  layer: Layer,
) => plan.convolutions.some((c) => c.layer === layer)

/** Whether `plan` scatters sprites over `layer`, or — with none named — over any. */
export const scattersOver = (
  plan: { readonly convolutions: readonly Convolution[] },
  layer?: Layer,
) => plan.convolutions.some((c) => c.scatter && (!layer || c.layer === layer))

/** The convolutions an image gathers, in the reference's order. */
export function convolutionsFor(settings: DepthOfFieldValues, layers: Layers): Convolution[] {
  const { rings, recombine, scatter, gathers, bokeh } = layers
  const postfilter = settings.depthOfFieldPostfilter !== 'none'
  const foregroundQuality =
    settings.depthOfFieldAccumulator === 'low' ? GATHER_QUALITY.low : GATHER_QUALITY.high
  const list: Convolution[] = []
  if (gathers.foreground)
    list.push({
      layer: 'foreground',
      quality: foregroundQuality,
      rings,
      bokeh: bokeh.gather,
      postfilter,
      scatter: scatter.foreground,
    })
  if (recombine > 0)
    list.push(
      {
        layer: 'hole',
        quality: GATHER_QUALITY.high,
        rings,
        bokeh: false,
        postfilter: false,
        scatter: false,
      },
      {
        layer: 'slight',
        quality: GATHER_QUALITY.high,
        rings: 3,
        bokeh: bokeh.slight,
        postfilter: false,
        scatter: false,
      },
    )
  if (gathers.background)
    list.push({
      layer: 'background',
      quality: backgroundQuality(
        settings,
        scatter.background && settings.depthOfFieldBackgroundScatter === 'occlusion',
      ),
      rings,
      bokeh: bokeh.gather,
      postfilter,
      scatter: scatter.background,
    })
  return list
}
