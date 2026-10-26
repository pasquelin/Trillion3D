import { scaledExtent, scaledRect } from '../plan.ts'
import { HORIZON_FORMAT, HORIZON_SPATIAL_FORMAT } from './layout.ts'
import type { HorizonSettings } from '../../../../../sdk-core/src/contracts/ambientOcclusionHorizon.ts'

/**
 * THE PASSES OF AN IMAGE'S HORIZON SEARCH, in the order they are drawn (`horizonPasses`): the search and its integral
 * (`combine`) at the image's size or its half, the spatial filter that blurs it and applies the power and the intensity
 * (`spatial`, a compute pass), the temporal filter that blends it into the last image's (`temporal`, which reads the history and
 * writes the next one) and the upsample, at the image's size, that writes the texture the lighting reads (`upsample`, which
 * applies the power and the intensity itself where the spatial filter is off); the filters the settings turn off are left out. The history's two textures take turns, `parity` naming the one this image reads.
 */
export type HorizonTarget = 'raw' | 'spatial' | 'history0' | 'history1' | 'ao'

/** A pass of the plan. */
export interface HorizonPass {
  kind: 'combine' | 'spatial' | 'temporal' | 'upsample'
  /** The texture it draws. */
  target: HorizonTarget
  /** The texture it reads of the pass before. */
  input?: HorizonTarget
  /** The history it reads (the temporal pass). */
  history?: HorizonTarget
}

/** The reduction a target is drawn at: the search's own, or the image's size. */
export const horizonScaleOf = (target: HorizonTarget, downscale: number) =>
  target === 'ao' ? 1 : downscale

/** The history of the image of parity `parity`: the one it reads, the one it writes. */
const historyOf = (parity: number): [HorizonTarget, HorizonTarget] =>
  parity ? ['history1', 'history0'] : ['history0', 'history1']

/** The passes of the settings, for each parity of the history: the same list for both where the temporal filter is off. */
export function horizonPasses(settings: HorizonSettings): readonly (readonly HorizonPass[])[] {
  return [0, 1].map((parity) => {
    const [read, write] = historyOf(parity)
    const passes: HorizonPass[] = [{ kind: 'combine', target: 'raw' }]
    if (settings.spatial)
      passes.push({ kind: 'spatial', target: 'spatial', input: passes.at(-1)!.target })
    if (settings.temporal)
      passes.push({ kind: 'temporal', target: write, input: passes.at(-1)!.target, history: read })
    passes.push({ kind: 'upsample', target: 'ao', input: passes.at(-1)!.target })
    return passes
  })
}

/** The textures a plan draws, each once: the raw result, the spatial filter's, the history's pair, the occlusion. */
export function horizonTargets(settings: HorizonSettings): HorizonTarget[] {
  const targets: HorizonTarget[] = ['raw']
  if (settings.spatial) targets.push('spatial')
  if (settings.temporal) targets.push('history0', 'history1')
  return [...targets, 'ao']
}

/** The texture of `target` over a scene of `extent` at the search's `downscale`: its size. */
export const horizonTargetExtent = (
  target: HorizonTarget,
  extent: readonly [number, number],
  downscale: number,
) => scaledExtent(horizonScaleOf(target, downscale), extent)

/** The rectangle `target` is drawn in when the image is `view` pixels, written into `into`. */
export const horizonTargetRect = (
  target: HorizonTarget,
  view: readonly [number, number],
  downscale: number,
  into: number[],
) => scaledRect(horizonScaleOf(target, downscale), view, into)

/** The format of `target`: the one-byte occlusion's, the spatial filter's, which a compute pass writes, a float. */
export const horizonFormatOf = (target: HorizonTarget): GPUTextureFormat =>
  target === 'spatial' ? HORIZON_SPATIAL_FORMAT : HORIZON_FORMAT
