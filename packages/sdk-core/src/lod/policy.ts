/** The detail a view is cut at when its host names none: one pixel, so a coarser level
 *  strays at most one pixel from the finer one and a building keeps its shape as the view moves.
 *  The source preset (0 px) keeps every leaf, a list no device holds on a large scene. Plain
 *  numbers the presets read, so a bundle that takes neither keeps no preset. */
export const DEFAULT_PIXEL_ERROR = 1
/** Runtime LOD presets. pixelError is the screen-space threshold consumed by exact-cluster selection; 0 keeps exact leaves. */
export const LOD_QUALITY = {
  /** Every triangle of the source. */
  source: {
    id: 'source',
    label: 'Maximum source detail',
    pixelError: 0,
    anisotropy: 'source',
  },
  /** Detail no one can tell from the source. */
  high: {
    id: 'high',
    label: 'High quality',
    pixelError: 1,
    anisotropy: 'maximum',
  },
  /** A little less detail, for speed. */
  balanced: {
    id: 'balanced',
    label: 'Balanced quality',
    pixelError: 4,
    anisotropy: 'source',
  },
} as const
/** The name of a detail preset. */
export type LodQualityId = keyof typeof LOD_QUALITY
/** The detail preset named `id`, or the balanced one. */
export function lodQuality(id: string) {
  const value = LOD_QUALITY[id as LodQualityId]
  if (!value) throw new Error(`Unknown LOD quality: ${id}`)
  return value
}
