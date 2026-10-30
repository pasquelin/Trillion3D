/**
 * THE MODES OF THE SCENE VIEW (`visualizeMode`, 0 to 24): what the image shows of the surface a camera ray meets. The numbers are the setting's; the surface cache's read
 * library (`sampleWgsl.ts`) takes the number of the mode a program draws (`scVisualMode`) and substitutes, for the final light of each card it reads, the layer the mode
 * names. No GPU here: the table of the modes, the labels written over the image, and the layout of the tiles of the overview.
 */

/** The modes by name; the same numbers the setting `visualizeMode` takes. */
export const VISUALIZE_MODE = {
  none: 0,
  overview: 1,
  performanceOverview: 2,
  scene: 3,
  reflectionView: 4,
  surfaceCache: 5,
  geometryNormals: 6,
  dedicatedReflectionRays: 7,
  albedo: 8,
  normals: 9,
  emissive: 10,
  cardWeights: 11,
  directLighting: 12,
  indirectLighting: 13,
  directLightingUpdates: 16,
  indirectLightingUpdates: 17,
  lastUsedPage: 18,
  lastUsedPageHighRes: 19,
  tileShadowDownsampleFactor: 20,
  cardSharingId: 21,
  screenProbeFastUpdate: 22,
  screenProbeFramesAccumulated: 23,
  radiosityNumFramesAccumulated: 24,
} as const

const M = VISUALIZE_MODE

/** The modes a card's layer is shown for, which the read library substitutes for the final light of each card. */
export const VISUALIZE_LAYER_MODES = [
  M.albedo,
  M.normals,
  M.emissive,
  M.cardWeights,
  M.directLighting,
  M.indirectLighting,
  M.directLightingUpdates,
  M.indirectLightingUpdates,
  M.lastUsedPage,
  M.lastUsedPageHighRes,
  M.tileShadowDownsampleFactor,
  M.cardSharingId,
  M.radiosityNumFramesAccumulated,
] as const

/** The modes that read the surface cache's last use of its pages (the feedback buffer). */
export const VISUALIZE_LAST_USED_MODES: readonly number[] = [M.lastUsedPage, M.lastUsedPageHighRes]

/** The modes that show a field the screen probes' history keeps (a byte: the amount of fast update in its high four bits, the frames held in its low four), not the scene. */
export const VISUALIZE_HISTORY_MODES: readonly number[] = [
  M.screenProbeFastUpdate,
  M.screenProbeFramesAccumulated,
]

/** The numbers of the local position and the velocity, by name: the reference shows them with hardware ray tracing only and gives them no pass of their own, so here they draw as the scene (`VISUALIZE_MODE.scene`) and stay out of `VISUALIZE_MODE`. */
export const VISUALIZE_SCENE_ALIAS = { localPosition: 14, velocity: 15 } as const

export const VISUALIZE_SCENE_ALIASES: readonly number[] = Object.values(VISUALIZE_SCENE_ALIAS)

/** Whether the mode `mode` traces the scene from the camera (the others read a surface of the cache only, or the probes' history). */
export const visualizeTracesScene = (mode: number) =>
  mode !== M.dedicatedReflectionRays && !VISUALIZE_HISTORY_MODES.includes(mode)

/**
 * How the colour a mode gives goes to the image: `radiance` a light seen through the composition's table, `colour` a debug colour of the unit range that takes the exposure of the
 * view first (a colour the table then shows as it shows the light), `srgb` the albedo through the display's transfer, `raw` a vector the image shows as it is.
 */
export type VisualizeOutput = 'radiance' | 'colour' | 'srgb' | 'raw'

/** How the colour of mode `mode` goes to the image. */
export function visualizeOutputOf(mode: number): VisualizeOutput {
  switch (mode) {
    case M.albedo:
      return 'srgb'
    case M.normals:
    case M.geometryNormals:
      return 'raw'
    case M.surfaceCache:
    case M.cardWeights:
    case M.directLightingUpdates:
    case M.indirectLightingUpdates:
    case M.lastUsedPage:
    case M.lastUsedPageHighRes:
    case M.tileShadowDownsampleFactor:
    case M.cardSharingId:
    case M.radiosityNumFramesAccumulated:
      return 'colour'
    default:
      return 'radiance'
  }
}

/** Whether `mode` is a layer mode: a card gives the layer the mode names in place of its final light. */
export const isLayerMode = (mode: number | undefined): mode is number =>
  mode !== undefined && (VISUALIZE_LAYER_MODES as readonly number[]).includes(mode)

/** The layers of the atlas, beside the depth, a layer mode reads (`SURFACE_CACHE_LAYER_AT`); the card's own state (page records) is read by every mode. */
export type VisualizeLayer =
  'albedo' | 'normal' | 'emissive' | 'direct' | 'indirect' | 'frames' | 'factors'

/** The layers the layer mode `mode` reads; the final light is read by no layer mode. */
export function visualizeLayersOf(mode: number): readonly VisualizeLayer[] {
  switch (mode) {
    case M.albedo:
    case M.cardSharingId:
      return ['albedo']
    case M.normals:
      return ['normal']
    case M.emissive:
      return ['emissive']
    case M.directLighting:
      return ['direct']
    case M.indirectLighting:
      return ['indirect']
    case M.tileShadowDownsampleFactor:
      return ['factors']
    case M.radiosityNumFramesAccumulated:
      return ['frames']
    default:
      return []
  }
}

/** Whether the value a hit of mode `mode` gives is a debug colour, not a light: the image shows it in the exposure of the view (`visualizeOutputOf`). */
export const visualizeHitIsColour = (mode: number) =>
  mode === M.geometryNormals || (isLayerMode(mode) && visualizeOutputOf(mode) !== 'radiance')

/** The label written at the foot of a tile, none for the modes that carry none (`reflectionRays` is the performance overview's: the caller fills the roughness). */
export function visualizeLabelOf(mode: number, reflectionRays = ''): string {
  switch (mode) {
    case M.geometryNormals:
      return 'Geometry Normals'
    case M.reflectionView:
      return 'Reflection View, SWRT'
    case M.surfaceCache:
      return 'Scene, Pink - missing Surface Cache coverage, Yellow - culled Surface Cache'
    case M.albedo:
      return 'Scene Albedo'
    case M.normals:
      return 'Scene Normals'
    case M.radiosityNumFramesAccumulated:
      return 'Radiosity Num Frames Accumulated'
    case M.dedicatedReflectionRays:
      return `Pixels tracing dedicated reflection rays.\nGreen - foliage (subsurface or two sided foliage shading model). Red - other.\n${reflectionRays}`
    default:
      return ''
  }
}

/** The pixels between the tiles of an overview and the display's edge. */
export const OVERVIEW_TILE_MARGIN = 4

/** The tiles the overview modes draw, in order, and how many fit a row. */
export const OVERVIEW_TILES: Readonly<
  Record<number, { modes: readonly number[]; perRow: number }>
> = {
  [M.overview]: {
    modes: [M.geometryNormals, M.reflectionView, M.surfaceCache],
    perRow: 3,
  },
  [M.performanceOverview]: { modes: [M.dedicatedReflectionRays], perRow: 3 },
}

/** A rectangle of the display, in pixels. */
export interface TileRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The rectangle of tile `index` of `perRow` to a row, or, for a negative index, of the whole display of `size` pixels. */
export function tileRectOf(
  size: readonly [number, number],
  index: number,
  perRow: number,
): TileRect {
  if (index < 0) return { x: 0, y: 0, width: size[0], height: size[1] }
  const width = Math.floor((size[0] - OVERVIEW_TILE_MARGIN * (perRow + 1)) / perRow)
  const height = Math.floor((size[1] - OVERVIEW_TILE_MARGIN * (perRow + 1)) / perRow)
  const column = index % perRow
  const row = Math.floor(index / perRow)
  return {
    x: width * column + OVERVIEW_TILE_MARGIN * (column + 1),
    y: height * row + OVERVIEW_TILE_MARGIN * (row + 1),
    width,
    height,
  }
}

/** The border of the rounded corners of a tile, pixels; a full-screen view has none. */
export const TILE_CORNER = 12

/** The modes a draw makes for the setting `visualizeMode`: the tiles of the overview modes, else the one mode on the whole display. */
export function visualizeDrawsOf(
  mode: number,
): readonly { mode: number; tile: number; perRow: number }[] {
  const overview = OVERVIEW_TILES[mode]
  return overview
    ? overview.modes.map((each, tile) => ({ mode: each, tile, perRow: overview.perRow }))
    : [{ mode, tile: -1, perRow: 1 }]
}
