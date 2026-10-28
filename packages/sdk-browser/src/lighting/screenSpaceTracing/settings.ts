import {
  screenReflectionQualityOf,
  type ScreenSpaceTracingValues,
} from '../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'
import type { ScreenReflectionPlan } from './frame.ts'

/** How the view's settings run the reflections: the level they reach, and whether they run over the tiles, behind the stencil or as a compute
 *  pass (`encodeScreenReflections` takes the tiles first, then the stencil). */
export const screenReflectionPlan = (values: ScreenSpaceTracingValues): ScreenReflectionPlan => ({
  quality: screenReflectionQualityOf(
    values.screenReflectionQuality,
    values.screenReflectionLevel,
    values.visualizeScreenReflections,
  ),
  tiles: values.screenReflectionTiles,
  show: values.screenReflectionTilesShow,
  stencil: values.screenReflectionStencil,
  compute: values.screenReflectionCompute,
  denoise: values.screenReflectionDenoiser,
})

/** The roughness a tile pixel traces up to: the setting where it is 0 or more, else the view's maximum roughness held within 0.01 and 1. */
export const screenReflectionTileMaxRoughness = (values: ScreenSpaceTracingValues) =>
  values.screenReflectionTilesMaxRoughness >= 0
    ? values.screenReflectionTilesMaxRoughness
    : Math.min(Math.max(values.screenReflectionMaxRoughness, 0.01), 1)

/** Whether the reflections go through the temporal filter of the reflections: where the view's anti-aliasing is not itself temporal
 *  (`temporalAccumulation` false), or the setting asks — never with the denoiser, which replaces that filter. */
export const screenReflectionTemporalRequired = (
  values: ScreenSpaceTracingValues,
  temporalAccumulation: boolean,
) => !values.screenReflectionDenoiser && (!temporalAccumulation || values.screenReflectionTemporal)

/** The frame's turn the reflections' parameters carry (`screenReflectionParams`): the temporal sample's index where the anti-aliasing
 *  accumulates, else the frame index modulo 8. */
export const screenReflectionTurn = (
  temporalAccumulation: boolean,
  temporalSampleIndex: number,
  frameIndex: number,
) => (temporalAccumulation ? temporalSampleIndex : frameIndex % 8)
