import {
  assertSidecarSection,
  checkSidecarHead,
  sidecarRefusal,
  type SidecarRefusal,
} from '../contracts/sidecarSection.ts'
import {
  HAIR_STRANDS_ATTRIBUTE_COLOR,
  HAIR_STRANDS_ATTRIBUTE_ROOT_UV,
  HAIR_STRANDS_ATTRIBUTE_ROUGHNESS,
  HAIR_STRANDS_COLOR_BYTES,
  HAIR_STRANDS_CURVE_BYTES,
  HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT,
  HAIR_STRANDS_FLAG_INVALID_POINT,
  HAIR_STRANDS_FLAG_ROOT_TILE,
  HAIR_STRANDS_FLAG_SCATTER,
  HAIR_STRANDS_FLAG_SCATTER_SET,
  HAIR_STRANDS_FLAG_SHUFFLED_CURVE,
  HAIR_STRANDS_FLAG_STABLE,
  HAIR_STRANDS_FLAG_STABLE_SET,
  HAIR_STRANDS_FLAG_TRIMMED_CURVE,
  HAIR_STRANDS_FLAG_TRIMMED_POINT,
  HAIR_STRANDS_GROUP_AT,
  HAIR_STRANDS_GROUP_BYTES,
  HAIR_STRANDS_HEAD_BYTES,
  HAIR_STRANDS_LENGTH_BYTES,
  HAIR_STRANDS_MAGIC,
  HAIR_STRANDS_MAX_CURVES_PER_GROUP,
  HAIR_STRANDS_MAX_POINTS_PER_CURVE,
  HAIR_STRANDS_MAX_POINTS_PER_GROUP,
  HAIR_STRANDS_POINT_BYTES,
  HAIR_STRANDS_POINTS_ALIGNMENT,
  HAIR_STRANDS_ROOT_UV_BYTES,
  HAIR_STRANDS_ROUGHNESS_BYTES,
  HAIR_STRANDS_SEED_BYTES,
  HAIR_STRANDS_TABLE_ALIGNMENT,
  HAIR_STRANDS_VERSION,
} from '../contracts/hairStrandsAbi.ts'
import { alignUp } from '../../../math/src/scalar/integers.ts'

/**
 * The hair strands' file, as the compiler writes it
 * (`packages/asset-compiler-rust/src/hair_strands/encode.rs`, `hairStrands.bin`): for each group of
 * strands of the scene its record and, from the tables the groups share, its curves, its points
 * and the attributes it carries — `../contracts/hairStrandsAbi.ts` lays it out. The tables of a
 * group are views into the file's bytes, nothing is copied.
 */

type Vec3 = readonly [number, number, number]

/** One group of strands, its lengths and radii in metres, in the space of the scene. */
export interface HairStrandsGroup {
  /** The group number the strands were cut by (`HAIR_STRANDS_GROUP_AT.groupId`). */
  readonly groupId: number
  /** The bits of `HAIR_STRANDS_FLAG_*` it was built with. */
  readonly flags: number
  /** The bits of `HAIR_STRANDS_ATTRIBUTE_*` it carries. */
  readonly attributes: number
  readonly curveCount: number
  readonly pointCount: number
  /** The longest of its curves and the greatest radius of its points. */
  readonly maxLength: number
  readonly maxRadius: number
  /** The box of its points; the centre of it is the origin its points' positions are relative to. */
  readonly boundsMin: Vec3
  readonly boundsMax: Vec3
  /** The curves and points its source declared, kept or not. */
  readonly sourceCurves: number
  readonly sourcePoints: number
  /** `curveCount` words: the rank of a curve's first point in the group in the low 24 bits, its point
   *  count in the high eight. */
  readonly curves: Uint8Array<ArrayBuffer>
  /** `pointCount` points of `HAIR_STRANDS_POINT_BYTES` bytes. */
  readonly points: Uint8Array<ArrayBuffer>
  /** The curves' seeds (a byte each) and lengths (a half float each). */
  readonly seeds: Uint8Array<ArrayBuffer>
  readonly lengths: Uint8Array<ArrayBuffer>
  /** The curves' root coordinates (a word each), the points' colours (a word each) and roughness
   *  (a byte each): none for a group that does not carry the attribute. */
  readonly rootUvs: Uint8Array<ArrayBuffer> | undefined
  readonly colors: Uint8Array<ArrayBuffer> | undefined
  readonly roughness: Uint8Array<ArrayBuffer> | undefined
}

/** The strands of a scene, group after group in the file's order. */
export interface HairStrands {
  readonly groups: readonly HairStrandsGroup[]
}

const refuse: SidecarRefusal = sidecarRefusal('hair strands')

/** The flag and attribute bits a record may carry. */
const KNOWN_FLAGS =
  HAIR_STRANDS_FLAG_TRIMMED_POINT |
  HAIR_STRANDS_FLAG_TRIMMED_CURVE |
  HAIR_STRANDS_FLAG_INVALID_POINT |
  HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT |
  HAIR_STRANDS_FLAG_SHUFFLED_CURVE |
  HAIR_STRANDS_FLAG_ROOT_TILE |
  HAIR_STRANDS_FLAG_STABLE_SET |
  HAIR_STRANDS_FLAG_STABLE |
  HAIR_STRANDS_FLAG_SCATTER_SET |
  HAIR_STRANDS_FLAG_SCATTER
const KNOWN_ATTRIBUTES =
  HAIR_STRANDS_ATTRIBUTE_ROOT_UV | HAIR_STRANDS_ATTRIBUTE_COLOR | HAIR_STRANDS_ATTRIBUTE_ROUGHNESS

/**
 * The manifest's `hairStrands` section, or undefined when the cache has none (a scene that carries
 * no curves writes neither the section nor the file); a section of another version throws
 * `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`.
 */
export const assertHairStrandsSection = (section: unknown) =>
  assertSidecarSection(section, HAIR_STRANDS_VERSION, 'hair strands')

/** The record of a group, its words read: the integers as they are, the lengths as the floats
 *  they are. */
function readRecord(view: DataView, at: number) {
  const word = (rank: number) => view.getUint32(at + rank * 4, true)
  const real = (rank: number) => view.getFloat32(at + rank * 4, true)
  const corner = (rank: number): Vec3 => [real(rank), real(rank + 1), real(rank + 2)]
  const rank = HAIR_STRANDS_GROUP_AT
  return {
    groupId: view.getInt32(at + rank.groupId * 4, true),
    flags: word(rank.flags),
    attributes: word(rank.attributes),
    curveCount: word(rank.curveCount),
    pointCount: word(rank.pointCount),
    firstCurve: word(rank.firstCurve),
    firstPoint: word(rank.firstPoint),
    firstRootUv: word(rank.firstRootUv),
    firstColor: word(rank.firstColor),
    firstRoughness: word(rank.firstRoughness),
    maxLength: real(rank.maxLength),
    maxRadius: real(rank.maxRadius),
    boundsMin: corner(rank.boundsMin),
    boundsMax: corner(rank.boundsMax),
    sourceCurves: word(rank.sourceCurves),
    sourcePoints: word(rank.sourcePoints),
  }
}

/** Checks one record against what the groups before it left: its bits, its counts, its floats and
 *  the ranks its tables start at. */
function checkRecord(
  record: ReturnType<typeof readRecord>,
  before: { curves: number; points: number; rootUvs: number; colors: number; roughness: number },
) {
  if ((record.flags & ~KNOWN_FLAGS) !== 0) refuse(`a group with flags ${record.flags}`)
  if ((record.attributes & ~KNOWN_ATTRIBUTES) !== 0)
    refuse(`a group with attributes ${record.attributes}`)
  if (record.curveCount > HAIR_STRANDS_MAX_CURVES_PER_GROUP || record.curveCount === 0)
    refuse(`a group of ${record.curveCount} curves`)
  if (
    record.pointCount > HAIR_STRANDS_MAX_POINTS_PER_GROUP ||
    record.pointCount < record.curveCount
  )
    refuse(`a group of ${record.pointCount} points`)
  if (record.firstCurve !== before.curves || record.firstPoint !== before.points)
    refuse('curves or points out of the order of their groups')
  // A table a group does not carry starts at 0; one it carries, where the groups before left off.
  const starts = (attribute: number, given: number, expected: number) =>
    given === ((record.attributes & attribute) !== 0 ? expected : 0)
  if (
    !starts(HAIR_STRANDS_ATTRIBUTE_ROOT_UV, record.firstRootUv, before.rootUvs) ||
    !starts(HAIR_STRANDS_ATTRIBUTE_COLOR, record.firstColor, before.colors) ||
    !starts(HAIR_STRANDS_ATTRIBUTE_ROUGHNESS, record.firstRoughness, before.roughness)
  )
    refuse('a table that starts out of the order of its groups')
  const numbers = [record.maxLength, record.maxRadius, ...record.boundsMin, ...record.boundsMax]
  if (!numbers.every(Number.isFinite) || record.maxLength < 0 || record.maxRadius < 0)
    refuse('a group holds a number that is not finite')
  if (record.boundsMin.some((low, axis) => low > record.boundsMax[axis]!))
    refuse('a group whose low corner lies past its high')
}

/** Checks the curve words of `curves`: each starts where the one before ended, holds at least one
 *  point and at most `HAIR_STRANDS_MAX_POINTS_PER_CURVE`, and together they hold `pointCount`. */
function checkCurves(curves: Uint8Array, pointCount: number) {
  const view = new DataView(curves.buffer, curves.byteOffset, curves.byteLength)
  let next = 0
  for (let at = 0; at < curves.byteLength; at += HAIR_STRANDS_CURVE_BYTES) {
    const word = view.getUint32(at, true),
      count = word >>> 24
    if ((word & HAIR_STRANDS_MAX_POINTS_PER_GROUP) !== next || count < 1)
      refuse('curves that are not one after the other')
    if (count > HAIR_STRANDS_MAX_POINTS_PER_CURVE) refuse(`a curve of ${count} points`)
    next += count
  }
  if (next !== pointCount) refuse('curves that do not hold the points of their group')
}

/** Where each table starts, one after the other, as `encode.rs` lays them out, and where the last ends. */
function tableOffsets(
  recordsEnd: number,
  before: { curves: number; points: number; rootUvs: number; colors: number; roughness: number },
) {
  let end = recordsEnd
  const table = (size: number, alignment = 1) => {
    end = alignUp(end, alignment)
    const at = end
    end += size
    return at
  }
  const offsets = {
    curves: table(before.curves * HAIR_STRANDS_CURVE_BYTES),
    points: table(before.points * HAIR_STRANDS_POINT_BYTES, HAIR_STRANDS_POINTS_ALIGNMENT),
    seeds: table(before.curves * HAIR_STRANDS_SEED_BYTES),
    lengths: table(before.curves * HAIR_STRANDS_LENGTH_BYTES, HAIR_STRANDS_TABLE_ALIGNMENT),
    rootUvs: table(before.rootUvs * HAIR_STRANDS_ROOT_UV_BYTES, HAIR_STRANDS_TABLE_ALIGNMENT),
    colors: table(before.colors * HAIR_STRANDS_COLOR_BYTES),
    roughness: table(before.roughness * HAIR_STRANDS_ROUGHNESS_BYTES),
  }
  return { offsets, end }
}

/** The groups of `records`, each a view of its part of every table of `bytes`. */
function groupsOf(
  bytes: Uint8Array<ArrayBuffer>,
  records: readonly ReturnType<typeof readRecord>[],
  offsets: ReturnType<typeof tableOffsets>['offsets'],
): HairStrandsGroup[] {
  const slice = (at: number, rank: number, stride: number, count: number) =>
    bytes.subarray(at + rank * stride, at + (rank + count) * stride)
  const groups = records.map((record): HairStrandsGroup => {
    const { firstCurve, firstPoint, firstRootUv, firstColor, firstRoughness, ...own } = record
    const { curveCount, pointCount, attributes } = own
    const curves = slice(offsets.curves, firstCurve, HAIR_STRANDS_CURVE_BYTES, curveCount)
    checkCurves(curves, pointCount)
    const held = (attribute: number) => (attributes & attribute) !== 0
    return {
      ...own,
      curves,
      points: slice(offsets.points, firstPoint, HAIR_STRANDS_POINT_BYTES, pointCount),
      seeds: slice(offsets.seeds, firstCurve, HAIR_STRANDS_SEED_BYTES, curveCount),
      lengths: slice(offsets.lengths, firstCurve, HAIR_STRANDS_LENGTH_BYTES, curveCount),
      rootUvs: held(HAIR_STRANDS_ATTRIBUTE_ROOT_UV)
        ? slice(offsets.rootUvs, firstRootUv, HAIR_STRANDS_ROOT_UV_BYTES, curveCount)
        : undefined,
      colors: held(HAIR_STRANDS_ATTRIBUTE_COLOR)
        ? slice(offsets.colors, firstColor, HAIR_STRANDS_COLOR_BYTES, pointCount)
        : undefined,
      roughness: held(HAIR_STRANDS_ATTRIBUTE_ROUGHNESS)
        ? slice(offsets.roughness, firstRoughness, HAIR_STRANDS_ROUGHNESS_BYTES, pointCount)
        : undefined,
    }
  })
  return groups
}

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The file must be its head, its records and its tables, no more: the
 * records' ranks follow one another and the tables fill the file to its end.
 */
export function parseHairStrands(bytes: Uint8Array<ArrayBuffer>): HairStrands {
  checkSidecarHead(bytes, {
    magic: HAIR_STRANDS_MAGIC,
    version: HAIR_STRANDS_VERSION,
    headBytes: HAIR_STRANDS_HEAD_BYTES,
    what: 'hair strands',
  })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const groupCount = view.getUint32(8, true)
  const pointTotal = view.getUint32(12, true)
  const recordsEnd = HAIR_STRANDS_HEAD_BYTES + groupCount * HAIR_STRANDS_GROUP_BYTES
  if (recordsEnd > bytes.byteLength) refuse('shorter than its records')
  const before = { curves: 0, points: 0, rootUvs: 0, colors: 0, roughness: 0 }
  const records = Array.from({ length: groupCount }, (_, k) => {
    const record = readRecord(view, HAIR_STRANDS_HEAD_BYTES + k * HAIR_STRANDS_GROUP_BYTES)
    checkRecord(record, before)
    before.curves += record.curveCount
    before.points += record.pointCount
    if (record.attributes & HAIR_STRANDS_ATTRIBUTE_ROOT_UV) before.rootUvs += record.curveCount
    if (record.attributes & HAIR_STRANDS_ATTRIBUTE_COLOR) before.colors += record.pointCount
    if (record.attributes & HAIR_STRANDS_ATTRIBUTE_ROUGHNESS) before.roughness += record.pointCount
    return record
  })
  if (before.points !== pointTotal) refuse('a head that counts other points than its groups')
  const { offsets, end } = tableOffsets(recordsEnd, before)
  if (alignUp(end, HAIR_STRANDS_TABLE_ALIGNMENT) !== bytes.byteLength)
    refuse('not its head, its records and its tables')
  return { groups: groupsOf(bytes, records, offsets) }
}
