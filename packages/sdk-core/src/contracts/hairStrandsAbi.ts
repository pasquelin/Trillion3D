/**
 * The hair strands product, written once and read by the strands loader and the compiler's Rust
 * (`scripts/build/shared-rules/hairStrands.ts` prints it into `hair_strands/abi.rs`).
 *
 * A scene file may carry curves (an Alembic curves object, a USD `BasisCurves`): the strands of a
 * groom. The compiler merges the curves of every object of the scene into one groom, each object's
 * points placed by the world matrix of the node that carries it and its widths taken to metres by
 * the unit of its file alone, cuts the strands into groups by their group number, shuffles the
 * curves of each group, packs them as the renderer of strands reads them at rest — each point on
 * eight bytes, each curve on four — and writes every group in `hairStrands.bin`, one record per
 * group. The lengths — positions, lengths and radii — are in metres, in the space of the scene: a
 * record holds no matrix.
 *
 * A point is eight bytes: its position in three half floats (bytes 0 to 5), relative to the centre
 * of the group's box (the middle of `boundsMin` and `boundsMax`), then the byte of its distance along
 * its curve over the curve's length, times 255 (byte 6), and a byte whose low six bits are its radius
 * over the group's greatest radius, times 63, and whose high two are the kind of control point
 * (`HAIR_STRANDS_CONTROL_POINT_*`, byte 7). A curve is a word: the rank of its first point within
 * the group in its low 24 bits and its point count in its high eight.
 */

/** The job field that says whether each curve is given one control point more at its end, and the
 *  command line's flag holding it as JSON (`true` or `false`, default `true`). */
export const HAIR_STRANDS_ENDING_POINT_FIELD = 'hairEndingPoint'
export const HAIR_STRANDS_ENDING_POINT_OPTION = '--hair-ending-point='
/** The product holding every group of strands, and the manifest's section naming it. */
export const HAIR_STRANDS_FILE = 'hairStrands.bin'
/** The first four bytes of `hairStrands.bin`: `T3HS` read as a little-endian `u32`. */
export const HAIR_STRANDS_MAGIC = 0x53483354
/** Format of `hairStrands.bin` and of the manifest's `hairStrands` section
 *  (`asset-compiler-rust/src/hair_strands/encode.rs` lays it out). */
export const HAIR_STRANDS_VERSION = 1
/** The bytes of the file's head: the magic, the version, the group count and the point count (four
 *  `u32`, the last the points of every group together). */
export const HAIR_STRANDS_HEAD_BYTES = 16
/** The bytes of a curve in the curve table: its first point and its point count in one `u32`. */
export const HAIR_STRANDS_CURVE_BYTES = 4
/** The bytes of a point in the point table. */
export const HAIR_STRANDS_POINT_BYTES = 8
/** The tables follow the records one after the other: the curves, the points, then the attribute
 *  tables. The point table starts on a multiple of `HAIR_STRANDS_POINTS_ALIGNMENT` bytes of the file,
 *  and every other table, and the end of each, on a multiple of `HAIR_STRANDS_TABLE_ALIGNMENT`. */
export const HAIR_STRANDS_POINTS_ALIGNMENT = 8
export const HAIR_STRANDS_TABLE_ALIGNMENT = 4
/** The bytes of one entry of each attribute table, which follow the point table in this order:
 *  the curves' seeds (a byte, the whole table padded to four bytes), their lengths (a half float,
 *  padded likewise), their root coordinates (a word), then the points' colours (a word) and their
 *  roughness (a byte, padded). A group's entries start at the rank its record names. */
export const HAIR_STRANDS_SEED_BYTES = 1
export const HAIR_STRANDS_LENGTH_BYTES = 2
export const HAIR_STRANDS_ROOT_UV_BYTES = 4
export const HAIR_STRANDS_COLOR_BYTES = 4
export const HAIR_STRANDS_ROUGHNESS_BYTES = 1
/** The words of a group's record, by name: its group number (a signed word), its flags
 *  (`HAIR_STRANDS_FLAG_*`), the attributes it carries (`HAIR_STRANDS_ATTRIBUTE_*`), its curve count
 *  and its point count, the ranks of its first curve, first point, first root coordinate, first
 *  colour and first roughness in their tables, its longest curve and its greatest radius
 *  (`f32`), the low and the high corner of its box (six `f32`) and the curves and points its source
 *  declared, kept or not. */
export const HAIR_STRANDS_GROUP_AT = {
  groupId: 0,
  flags: 1,
  attributes: 2,
  curveCount: 3,
  pointCount: 4,
  firstCurve: 5,
  firstPoint: 6,
  firstRootUv: 7,
  firstColor: 8,
  firstRoughness: 9,
  maxLength: 10,
  maxRadius: 11,
  boundsMin: 12,
  boundsMax: 15,
  sourceCurves: 18,
  sourcePoints: 19,
} as const
/** The words of a group's record, and its bytes. */
export const HAIR_STRANDS_GROUP_WORDS = 20
export const HAIR_STRANDS_GROUP_BYTES = HAIR_STRANDS_GROUP_WORDS * 4
/** The bits of a group's flags: some curve had more points than a curve holds and lost the rest,
 *  the group held more curves or points than it can address and lost the curves past them, a curve
 *  held a point that is not a finite number and was left out, a curve was given one control point
 *  more at its end (the last segment of a strip would be lost otherwise), the curves of the group
 *  were shuffled (their order is not the file's), a root coordinate lies past 1 and names a tile of
 *  the texture sheet. */
export const HAIR_STRANDS_FLAG_TRIMMED_POINT = 1
export const HAIR_STRANDS_FLAG_TRIMMED_CURVE = 2
export const HAIR_STRANDS_FLAG_INVALID_POINT = 4
export const HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT = 8
export const HAIR_STRANDS_FLAG_SHUFFLED_CURVE = 16
export const HAIR_STRANDS_FLAG_ROOT_TILE = 256
/** The bits of a group's attributes: a root coordinate on each curve, a colour and a roughness on
 *  each point. */
export const HAIR_STRANDS_ATTRIBUTE_ROOT_UV = 1
export const HAIR_STRANDS_ATTRIBUTE_COLOR = 16
export const HAIR_STRANDS_ATTRIBUTE_ROUGHNESS = 32
/** The kinds of control point of a point's high two bits. */
export const HAIR_STRANDS_CONTROL_POINT_INSIDE = 0
export const HAIR_STRANDS_CONTROL_POINT_START = 1
export const HAIR_STRANDS_CONTROL_POINT_END = 2
/** The most points of a curve, curves of a group and points of a group a record holds. */
export const HAIR_STRANDS_MAX_POINTS_PER_CURVE = 255
export const HAIR_STRANDS_MAX_CURVES_PER_GROUP = 4194303
export const HAIR_STRANDS_MAX_POINTS_PER_GROUP = 16777215
