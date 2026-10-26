/**
 * THE MAP AS THE OCCLUSION PYRAMID LAST SAW IT, CPU SIDE: each map's cache entry (`VsmMapCache`) keeps the
 * view the pyramid was last built with — its id, where its table lay, its clip matrix and origin
 * shift — and the one before. The previous one opens every update of the entry, drawn or not
 * (`moveOcclusionView`); a map drawn while the culling is
 * on hands it to its record (`recordOcclusionView`: its previous id, table and matrix, which the
 * first cull tests against the previous frame's pyramid) and takes this frame's view as the current
 * one.
 */
import type { VsmProjectionDataValues } from '../projection/projectionData.ts'

/** A map's view as the pyramid saw it: no map (`mapId` −1) until drawn with the culling on. */
export interface VsmOcclusionView {
  mapId: number
  tableOrigin: number
  finestMip: number
  /** Shifted space to clip, in that frame's shifted space (`originShift`). */
  shiftedToClip: Float64Array
  originShift: [number, number, number]
  /** What the box cull reads of its view-to-clip: [2][2], [3][2], [3][3]. */
  clipDepth: [number, number, number]
}

export const occlusionViewOf = (): VsmOcclusionView => ({
  mapId: -1,
  tableOrigin: 0,
  finestMip: 0,
  shiftedToClip: new Float64Array(16),
  originShift: [0, 0, 0],
  clipDepth: [0, 0, 0],
})

/** `from` copied into `to`. */
function copyView(to: VsmOcclusionView, from: VsmOcclusionView) {
  to.mapId = from.mapId
  to.tableOrigin = from.tableOrigin
  to.finestMip = from.finestMip
  to.shiftedToClip.set(from.shiftedToClip)
  for (let k = 0; k < 3; k++) {
    to.originShift[k] = from.originShift[k]
    to.clipDepth[k] = from.clipDepth[k]
  }
}

/** The previous view becomes the current one: what every update of a map's entry opens with. */
export const moveOcclusionView = (views: { current: VsmOcclusionView; prev: VsmOcclusionView }) =>
  copyView(views.prev, views.current)

/**
 * A map drawn this frame with the culling on, as id `mapId`: its record takes the previous view —
 * the id, table and matrix the previous frame's pyramid and kept tables hold it by, the matrix
 * moved to this frame's shifted space —, and this frame's view becomes the current one.
 */
export function recordOcclusionView(
  views: { current: VsmOcclusionView; prev: VsmOcclusionView },
  d: VsmProjectionDataValues,
  mapId: number,
) {
  const { prev, current } = views
  d.prevMapId = prev.mapId
  d.prevTableOrigin = prev.tableOrigin
  d.prevFinestMip = prev.finestMip
  // The previous clip matrix of a point of this frame's shifted space y: M (y − s + s').
  const m = prev.shiftedToClip,
    out = d.prevShiftedToClip
  const dx = prev.originShift[0] - d.originShift[0],
    dy = prev.originShift[1] - d.originShift[1],
    dz = prev.originShift[2] - d.originShift[2]
  for (let r = 0; r < 4; r++) {
    out[r] = m[r]
    out[4 + r] = m[4 + r]
    out[8 + r] = m[8 + r]
    out[12 + r] = m[r] * dx + m[4 + r] * dy + m[8 + r] * dz + m[12 + r]
  }
  for (let k = 0; k < 3; k++) d.prevClipDepth[k] = prev.clipDepth[k]
  current.mapId = mapId
  current.tableOrigin = d.tableOrigin
  current.finestMip = d.finestMip
  current.shiftedToClip.set(d.shiftedToClip)
  for (let k = 0; k < 3; k++) current.originShift[k] = d.originShift[k]
  const v = d.lightViewToClip
  current.clipDepth[0] = v[10]
  current.clipDepth[1] = v[14]
  current.clipDepth[2] = v[15]
}
