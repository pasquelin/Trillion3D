import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { HairStrandsGroup } from '../../../../sdk-core/src/hair/hairStrandsFile.ts'
import { HAIR_STRANDS_POINT_BYTES } from '../../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import { fromHalf, halfCeilBits, toHalf } from '../../../../math/src/float/half.ts'
import {
  RENDER_CURVE_CLUSTER_HEADER_BYTES,
  RENDER_CURVE_CLUSTER_POINT_BYTES,
  RENDER_CURVE_CURVES_PER_CLUSTER,
  RENDER_CURVE_MAX_POINTS_PER_CURVE,
  renderCurveClusterStride,
} from './renderCurveMath.ts'

/** The points a curve of a cluster holds for `groups`: the most points a strand has, held to `RENDER_CURVE_MAX_POINTS_PER_CURVE`. */
export function renderCurvePointsPerCurve(groups: readonly HairStrandsGroup[]) {
  let most = 2
  for (const group of groups) {
    const words = new Uint32Array(group.curves.buffer, group.curves.byteOffset, group.curveCount)
    for (const word of words) most = Math.max(most, word >>> 24)
  }
  return Math.min(most, RENDER_CURVE_MAX_POINTS_PER_CURVE)
}

/** The strand points the curves of `group` are cut into: runs of at most `pointsPerCurve` points, each sharing its first point with the end of the run before, so a strand of any length is a few curves. */
function curveRuns(group: HairStrandsGroup, pointsPerCurve: number) {
  const words = new Uint32Array(group.curves.buffer, group.curves.byteOffset, group.curveCount)
  const first: number[] = []
  const count: number[] = []
  for (const word of words) {
    const start = word & 0xffffff
    const end = start + (word >>> 24)
    for (let at = start; end - at >= 2; at += pointsPerCurve - 1) {
      first.push(at)
      count.push(Math.min(pointsPerCurve, end - at))
    }
  }
  return { first, count }
}

/** The bits of `x` spread two apart, for a Morton code. */
const spread = (x: number) => {
  x &= 0x3ff
  x = (x | (x << 16)) & 0x030000ff
  x = (x | (x << 8)) & 0x0300f00f
  x = (x | (x << 4)) & 0x030c30c3
  return (x | (x << 2)) & 0x09249249
}

/**
 * THE CLUSTERS OF A GROUP: its strands cut into curves of at most `pointsPerCurve` points (`curveRuns`), the curves ordered along a
 * Morton curve by their first point so that a cluster holds curves that lie together, and every `RENDER_CURVE_CURVES_PER_CLUSTER`
 * of them written as a cluster of `renderCurveClusterStride(pointsPerCurve)` bytes: a header (the centre of the cluster, which the
 * points are relative to, the counts, the greatest length and radius as halves, then the box of the cluster, its centre relative to
 * the cluster's and its extent, as halves) and the points, point after point, a point of each curve (the position as halves, the
 * distance along the strand, the radius over the greatest, and whether the point exists). The positions are those of the group's space:
 * relative to the centre of its box.
 */
export function buildRenderCurveClusters(group: HairStrandsGroup, pointsPerCurve: number) {
  const { first, count } = curveRuns(group, pointsPerCurve)
  const { points } = group
  const pointView = new DataView(points.buffer, points.byteOffset, points.byteLength)
  const position = (rank: number, out: Float64Array) => {
    const at = rank * HAIR_STRANDS_POINT_BYTES
    for (let axis = 0; axis < 3; axis++)
      out[axis] = fromHalf(pointView.getUint16(at + axis * 2, true))
  }
  const lower = group.boundsMin
  const size = [0, 1, 2].map((axis) => Math.max(group.boundsMax[axis]! - lower[axis]!, 1e-9))
  const centre = [0, 1, 2].map((axis) => (lower[axis]! + group.boundsMax[axis]!) * 0.5)
  const keys = new Uint32Array(first.length)
  const at = new Float64Array(3)
  for (let run = 0; run < first.length; run++) {
    position(first[run]!, at)
    const code = [0, 1, 2].map((axis) =>
      clamp(Math.floor(((at[axis]! + centre[axis]! - lower[axis]!) / size[axis]!) * 1024), 0, 1023),
    )
    keys[run] = spread(code[0]!) | (spread(code[1]!) << 1) | (spread(code[2]!) << 2)
  }
  const order = Uint32Array.from(keys.keys()).sort((a, b) => keys[a]! - keys[b]!)
  const stride = renderCurveClusterStride(pointsPerCurve)
  const clusterCount = ceilDiv(order.length, RENDER_CURVE_CURVES_PER_CLUSTER)
  const data = new Uint8Array(clusterCount * stride)
  const view = new DataView(data.buffer)
  const low = new Float64Array(3)
  const high = new Float64Array(3)
  const radiusStep = group.maxRadius / 63
  for (let cluster = 0; cluster < clusterCount; cluster++) {
    const base = cluster * stride
    const members = order.subarray(
      cluster * RENDER_CURVE_CURVES_PER_CLUSTER,
      (cluster + 1) * RENDER_CURVE_CURVES_PER_CLUSTER,
    )
    low.fill(Infinity)
    high.fill(-Infinity)
    for (const run of members)
      for (let k = 0; k < count[run]!; k++) {
        position(first[run]! + k, at)
        const reach = (points[(first[run]! + k) * HAIR_STRANDS_POINT_BYTES + 7]! & 63) * radiusStep
        for (let axis = 0; axis < 3; axis++) {
          low[axis] = Math.min(low[axis]!, at[axis]! - reach)
          high[axis] = Math.max(high[axis]!, at[axis]! + reach)
        }
      }
    const origin = [0, 1, 2].map((axis) => Math.fround((low[axis]! + high[axis]!) * 0.5))
    for (let axis = 0; axis < 3; axis++) view.setFloat32(base + axis * 4, origin[axis]!, true)
    view.setUint32(
      base + 12,
      RENDER_CURVE_CURVES_PER_CLUSTER | (pointsPerCurve << 8) | (members.length << 16),
      true,
    )
    view.setUint32(base + 16, toHalf(group.maxLength) | (toHalf(group.maxRadius) << 16), true)
    const extent = [0, 1, 2].map((axis) => halfCeilBits((high[axis]! - low[axis]!) * 0.5 + 1e-6))
    view.setUint32(base + 20, 0, true)
    view.setUint32(base + 24, extent[0]! << 16, true)
    view.setUint32(base + 28, extent[1]! | (extent[2]! << 16), true)
    members.forEach((run, curve) => {
      for (let k = 0; k < count[run]!; k++) {
        const source = (first[run]! + k) * HAIR_STRANDS_POINT_BYTES
        position(first[run]! + k, at)
        const word =
          base +
          RENDER_CURVE_CLUSTER_HEADER_BYTES +
          (RENDER_CURVE_CURVES_PER_CLUSTER * k + curve) * RENDER_CURVE_CLUSTER_POINT_BYTES
        view.setUint32(
          word,
          toHalf(at[0]! - origin[0]!) | (toHalf(at[1]! - origin[1]!) << 16),
          true,
        )
        view.setUint32(
          word + 4,
          (toHalf(at[2]! - origin[2]!) |
            (points[source + 6]! << 16) |
            ((points[source + 7]! & 63) << 24) |
            (1 << 30)) >>>
            0,
          true,
        )
      }
    })
  }
  return { data, clusterCount }
}
