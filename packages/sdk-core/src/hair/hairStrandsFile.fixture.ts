import {
  HAIR_STRANDS_ATTRIBUTE_COLOR,
  HAIR_STRANDS_ATTRIBUTE_ROOT_UV,
  HAIR_STRANDS_ATTRIBUTE_ROUGHNESS,
  HAIR_STRANDS_CONTROL_POINT_END,
  HAIR_STRANDS_CONTROL_POINT_INSIDE,
  HAIR_STRANDS_CONTROL_POINT_START,
  HAIR_STRANDS_FLAG_SHUFFLED_CURVE,
  HAIR_STRANDS_GROUP_AT,
  HAIR_STRANDS_GROUP_BYTES,
  HAIR_STRANDS_HEAD_BYTES,
  HAIR_STRANDS_MAGIC,
  HAIR_STRANDS_VERSION,
} from '../contracts/hairStrandsAbi.ts'
import { alignUp } from '../../../math/src/scalar/integers.ts'
import { toHalf } from '../../../math/src/float/half.ts'

/** A group of strands as a test writes it: the points of each curve, in metres, flat `x, y, z`, and
 *  the optional attributes — a word for each curve's root coordinates, a word for each point's colour,
 *  a byte for each point's roughness. */
export interface FixtureGroup {
  readonly id: number
  readonly curves: readonly (readonly number[])[]
  readonly radius?: number
  readonly rootUvs?: readonly number[]
  readonly colors?: readonly number[]
  readonly roughness?: readonly number[]
}

/** The file `groups` make, laid out as `encode.rs` lays it out (`hairStrandsAbi.ts`): one record per
 *  group, then the tables of every group one after the other. A point's `u` is 0 and its radius the
 *  greatest, so a test reads what it put in the positions and the tables. */
export function hairStrandsFixture(groups: readonly FixtureGroup[]): Uint8Array<ArrayBuffer> {
  const built = groups.map((group) => {
    const counts = group.curves.map((curve) => curve.length / 3)
    const all = group.curves.flat()
    const low = [0, 1, 2].map((axis) =>
      Math.fround(Math.min(...all.filter((_, at) => at % 3 === axis))),
    )
    const high = [0, 1, 2].map((axis) =>
      Math.fround(Math.max(...all.filter((_, at) => at % 3 === axis))),
    )
    const centre = low.map((value, axis) => Math.fround((value + high[axis]!) * 0.5))
    const points = new DataView(new ArrayBuffer((all.length / 3) * 8))
    let point = 0
    for (const curve of group.curves)
      for (let k = 0; k < curve.length / 3; k++, point++) {
        for (let axis = 0; axis < 3; axis++)
          points.setUint16(point * 8 + axis * 2, toHalf(curve[k * 3 + axis]! - centre[axis]!), true)
        const kind =
          k === 0
            ? HAIR_STRANDS_CONTROL_POINT_START
            : k + 1 === curve.length / 3
              ? HAIR_STRANDS_CONTROL_POINT_END
              : HAIR_STRANDS_CONTROL_POINT_INSIDE
        points.setUint8(point * 8 + 7, 63 | (kind << 6))
      }
    const attributes =
      (group.rootUvs ? HAIR_STRANDS_ATTRIBUTE_ROOT_UV : 0) |
      (group.colors ? HAIR_STRANDS_ATTRIBUTE_COLOR : 0) |
      (group.roughness ? HAIR_STRANDS_ATTRIBUTE_ROUGHNESS : 0)
    return { group, counts, low, high, points, attributes, pointCount: all.length / 3 }
  })
  const words = (rows: number[][]) => new Uint8Array(new Uint32Array(rows.flat()).buffer)
  const curveWords = built.map(({ counts }) => {
    let first = 0
    return counts.map((count) => {
      const word = first | (count << 24)
      first += count
      return word >>> 0
    })
  })
  const tables = {
    curves: words(curveWords),
    points: Uint8Array.from(built.flatMap(({ points }) => [...new Uint8Array(points.buffer)])),
    seeds: Uint8Array.from(built.flatMap(({ counts }) => counts.map((_, at) => at & 255))),
    lengths: new Uint8Array(
      new Uint16Array(built.flatMap(({ counts }) => counts.map(() => 0x3c00))).buffer,
    ),
    rootUvs: words(built.map(({ group }) => [...(group.rootUvs ?? [])])),
    colors: words(built.map(({ group }) => [...(group.colors ?? [])])),
    roughness: Uint8Array.from(built.flatMap(({ group }) => [...(group.roughness ?? [])])),
  }
  const lengthsPadded = alignUp(tables.lengths.length, 4)
  const recordsEnd = HAIR_STRANDS_HEAD_BYTES + built.length * HAIR_STRANDS_GROUP_BYTES
  const pointsAt = alignUp(recordsEnd + tables.curves.length, 8)
  const seedsAt = pointsAt + tables.points.length
  const lengthsAt = alignUp(seedsAt + tables.seeds.length, 4)
  const rootUvsAt = lengthsAt + lengthsPadded
  const colorsAt = rootUvsAt + tables.rootUvs.length
  const roughnessAt = colorsAt + tables.colors.length
  const bytes = new Uint8Array(alignUp(roughnessAt + tables.roughness.length, 4))
  const view = new DataView(bytes.buffer)
  view.setUint32(0, HAIR_STRANDS_MAGIC, true)
  view.setUint32(4, HAIR_STRANDS_VERSION, true)
  view.setUint32(8, built.length, true)
  view.setUint32(12, tables.points.length / 8, true)
  const first = { curve: 0, point: 0, rootUv: 0, color: 0, roughness: 0 }
  built.forEach(({ group, counts, low, high, attributes, pointCount }, k) => {
    const at = HAIR_STRANDS_HEAD_BYTES + k * HAIR_STRANDS_GROUP_BYTES
    const put = (rank: number, value: number) => view.setUint32(at + rank * 4, value, true)
    const putFloat = (rank: number, value: number) => view.setFloat32(at + rank * 4, value, true)
    const rank = HAIR_STRANDS_GROUP_AT
    view.setInt32(at + rank.groupId * 4, group.id, true)
    put(rank.flags, HAIR_STRANDS_FLAG_SHUFFLED_CURVE)
    put(rank.attributes, attributes)
    put(rank.curveCount, counts.length)
    put(rank.pointCount, pointCount)
    put(rank.firstCurve, first.curve)
    put(rank.firstPoint, first.point)
    put(rank.firstRootUv, group.rootUvs ? first.rootUv : 0)
    put(rank.firstColor, group.colors ? first.color : 0)
    put(rank.firstRoughness, group.roughness ? first.roughness : 0)
    putFloat(rank.maxLength, 1)
    putFloat(rank.maxRadius, group.radius ?? 0.001)
    low.forEach((value, axis) => putFloat(rank.boundsMin + axis, value))
    high.forEach((value, axis) => putFloat(rank.boundsMax + axis, value))
    put(rank.sourceCurves, counts.length)
    put(rank.sourcePoints, pointCount)
    first.curve += counts.length
    first.point += pointCount
    first.rootUv += group.rootUvs ? counts.length : 0
    first.color += group.colors ? pointCount : 0
    first.roughness += group.roughness ? pointCount : 0
  })
  bytes.set(tables.curves, recordsEnd)
  bytes.set(tables.points, pointsAt)
  bytes.set(tables.seeds, seedsAt)
  bytes.set(tables.lengths, lengthsAt)
  bytes.set(tables.rootUvs, rootUvsAt)
  bytes.set(tables.colors, colorsAt)
  bytes.set(tables.roughness, roughnessAt)
  return bytes
}
