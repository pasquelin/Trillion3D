/**
 * THE NUMBERED DEBUG VIEWS OF THE SAMPLED LIGHTING and how a view picks one: a setting (`sampledLightsVisualize`) or a diagnostic mode. Pure choices, no GPU.
 */
import type { DiagnosticMode } from '../../../../../sdk-core/src/runtime/diagnostics.ts'
import type { SampledLightsSettings } from '../parameters.ts'

/** The numbered views, as the shader reads them. */
export const VISUALIZE = {
  overview: 1,
  shadowCasters: 2,
  shadowCasterQuality: 3,
  denoiserOverview: 4,
  denoiserOverview2: 5,
  shadingConfidence: 6,
  framesAccumulated: 7,
  upsampleMask: 8,
  diffuseDemodulate: 9,
  specularDemodulate: 10,
  diffuseStdDev: 11,
  specularStdDev: 12,
  diffuseHistorySpatialStdDev: 13,
  specularHistorySpatialStdDev: 14,
  diffuseHistoryClamp: 15,
  specularHistoryClamp: 16,
} as const

const MODE_VIEW: Partial<Record<DiagnosticMode, number>> = {
  'sampled-lights-overview': VISUALIZE.overview,
  'sampled-lights-shadow-casters': VISUALIZE.shadowCasters,
  'sampled-lights-shadow-caster-quality': VISUALIZE.shadowCasterQuality,
}

/** The numbered view to show: the setting when it names one, else the one the diagnostic mode names; 0 for none. */
export const visualizeViewOf = (
  settings: Pick<SampledLightsSettings, 'sampledLights' | 'sampledLightsVisualize'>,
  mode: DiagnosticMode,
) =>
  !settings.sampledLights
    ? 0
    : settings.sampledLightsVisualize > 0
      ? settings.sampledLightsVisualize
      : (MODE_VIEW[mode] ?? 0)

/** Whether the view is one of the overviews: the tiles of other views over the image. */
export const isOverview = (view: number) =>
  view === VISUALIZE.overview ||
  view === VISUALIZE.denoiserOverview ||
  view === VISUALIZE.denoiserOverview2

/** Whether the view reads what the spatial filter's debug output holds: every numbered view paints the surface from it. */
export const readsSpatialDebug = (view: number) => view > 0

/** The tiles of an overview in reading order (-1 an empty one) and the tiles of a row; one tile filling the image for a view that is no overview. */
export function overviewLayout(view: number): { tiles: readonly number[]; perRow: number } {
  const V = VISUALIZE
  if (view === V.overview) return { tiles: [V.shadowCasters, V.shadowCasterQuality], perRow: 3 }
  if (!isOverview(view)) return { tiles: [view], perRow: 1 }
  const tiles = [
    V.upsampleMask,
    V.diffuseDemodulate,
    V.specularDemodulate,
    V.diffuseHistoryClamp,
    V.shadingConfidence,
    -1,
    -1,
    V.specularHistoryClamp,
    V.framesAccumulated,
    -1,
    -1,
    V.diffuseStdDev,
    -1,
    -1,
    -1,
    V.specularStdDev,
  ]
  if (view === V.denoiserOverview2) {
    tiles[1] = V.diffuseHistorySpatialStdDev
    tiles[2] = V.specularHistorySpatialStdDev
  }
  return { tiles, perRow: 4 }
}

/** The margin, in pixels, around the tiles of an overview. */
export const OVERVIEW_MARGIN = 4

/** The rectangle (x, y, width, height) of tile `index` of a layout of `perRow` tiles a row over an image of `size`; the whole image for a lone view. */
export function tileRect(
  size: readonly [number, number],
  index: number,
  perRow: number,
  single: boolean,
): readonly [number, number, number, number] {
  if (single) return [0, 0, size[0], size[1]]
  const w = Math.floor((size[0] - OVERVIEW_MARGIN * (perRow + 1)) / perRow)
  const h = Math.floor((size[1] - OVERVIEW_MARGIN * (perRow + 1)) / perRow)
  const cx = index % perRow
  const cy = Math.floor(index / perRow)
  return [w * cx + OVERVIEW_MARGIN * (cx + 1), h * cy + OVERVIEW_MARGIN * (cy + 1), w, h]
}

/** The words written at the foot of a view; none for a view with no label. */
export function visualizeLabel(view: number): string {
  const V = VISUALIZE
  switch (view) {
    case V.shadowCasters:
      return 'Shadow Casters, Materials:0, FarField:0, HairVoxels:0'
    case V.shadowCasterQuality:
      return 'Shadow Caster Quality, Red - missing shadow caster, Blue - mismatching shadow caster'
    case V.shadingConfidence:
      return 'Shading Confidence'
    case V.framesAccumulated:
      return 'Num Frames Accumulated, Red - invalid history, Yellow - first frame'
    case V.upsampleMask:
      return 'Upsample Mask, Yellow - invalid pixels'
    case V.diffuseDemodulate:
      return 'Diffuse Demodulate'
    case V.specularDemodulate:
      return 'Specular Demodulate'
    case V.diffuseStdDev:
      return 'Diffuse Std Dev, Red - disocclusion, Blue - spatial filtering'
    case V.specularStdDev:
      return 'Specular Std Dev, Red - disocclusion, Blue - spatial filtering'
    case V.diffuseHistorySpatialStdDev:
      return 'Diffuse History Var, Blue - spatial filtering'
    case V.specularHistorySpatialStdDev:
      return 'Specular History Var, Blue - spatial filtering'
    case V.diffuseHistoryClamp:
      return 'Diffuse History Clamp'
    case V.specularHistoryClamp:
      return 'Specular History Clamp'
    default:
      return ''
  }
}
