/**
 * The settings of a mesh's distance field, written once as rules (`settingRules.ts`) and read by
 * the mesh build's resolver (`meshBuildOptions.ts`), the options schema and the compiler's Rust
 * (`scripts/build/shared-rules/distanceField.ts`). They are `meshBuild` settings (`meshBuildAbi.ts`):
 * a rule's, the scene's, the mesh's own glTF `extras`, the default — the reference's.
 *
 * The field is a mesh's signed distance, sampled in bricks of 8³ bytes around its surface. The
 * reference's own lengths are in centimetres; ours are metres, so a density of the reference's
 * `0.2` voxels per centimetre is 20 per metre (`DISTANCE_FIELD_UNITS_PER_METRE`).
 *
 * - `distanceField`: whether the mesh's field is built (`true`, the default: the reference's
 *   gameplay templates, third person, first person and top down, turn the generation on in a new
 *   project). A scene lit by the distance-field occlusion or traced by the software ray tracing
 *   needs it; `false` builds none.
 * - `distanceFieldScale`: the mesh's resolution scale, a number of at least 0 (1): the voxels a
 *   unit of its size holds are the density times this scale. 0 builds no field for the mesh; a scale
 *   above 1 lets the field reach the full `distanceFieldMaxResolution` where one at most 1 reaches
 *   its half.
 * - `distanceFieldTwoSided`: whether the field is built as if every triangle were two-sided (the
 *   mesh's own double-sided materials are two-sided either way): no back face then makes a voxel
 *   inside the mesh.
 * - `distanceFieldDensity`: the voxels a centimetre of a mesh of scale 1 holds, from 0.05 to 0.4
 *   (0.2): changing it rebuilds every field.
 * - `distanceFieldMaxResolution`: the most voxels along one axis a mesh's field holds, a whole
 *   number of at least 1 (256): a mesh of scale 1 or less holds half of it.
 */
import { atLeast, countSetting, flagSetting, numberSetting, rulesOf } from './settingRules.ts'

/** The reference's length unit per metre: its centimetres, which its density and its resolution
 *  scale are written in. */
export const DISTANCE_FIELD_UNITS_PER_METRE = 100
/** The voxels along one side of a brick that belong to it alone (the eighth, shared with the next
 *  brick, is its filtering border), the bricks of a field's cell. */
export const DISTANCE_FIELD_UNIQUE_BRICK = 7
/** The voxels along one side of a brick as stored. */
export const DISTANCE_FIELD_BRICK = 8
/** The mips a mesh's field is built at; the coarsest is the one always loaded. */
export const DISTANCE_FIELD_MIPS = 3
/** The width of the band around the surface a field stores, in voxels. */
export const DISTANCE_FIELD_BAND_VOXELS = 4
/** The border around the mesh's box, in voxels, kept for the gradient. */
export const DISTANCE_FIELD_OBJECT_BORDER = 1
/** The most bricks along one axis a field's indirection table holds, less one. */
export const DISTANCE_FIELD_MAX_INDIRECTION = 1024
/** The product holding every mesh's field, and the manifest's section naming it. */
export const DISTANCE_FIELD_FILE = 'distanceFields.bin'
/** The first four bytes of `distanceFields.bin`: `T3DF` read as a little-endian `u32`. */
export const DISTANCE_FIELD_MAGIC = 0x46443354
/** Format of `distanceFields.bin` and of the manifest's `distanceFields` section
 *  (`asset-compiler-rust/src/distance_field/encode.rs` lays it out). */
export const DISTANCE_FIELD_VERSION = 1
/** The bytes of the file's head: the magic, the version, the mesh count and a reserved word. */
export const DISTANCE_FIELD_HEAD_BYTES = 16
/** The bytes of a mesh's record: its compiled mesh and its flags (bit 0: mostly two-sided), the
 *  low and the high corner of its box in metres (six `f32`), then a record for each mip. */
export const DISTANCE_FIELD_MESH_BYTES = 200
/** The bytes of a mip's record: its three indirection sides, its distance scale and bias, its
 *  volume-to-virtual-UV scale and add (three `f32` each), the bricks it holds, and where its data
 *  starts in the file and how long it is. The data is the indirection table (one `u32` a brick
 *  cell, `0xffffffff` where the cell holds none), then the bricks, 512 bytes each. */
export const DISTANCE_FIELD_MIP_BYTES = 56

/** The mesh build settings of a distance field, with their defaults, the reference's. */
export const DISTANCE_FIELD_RULES = /* @__PURE__ */ (() =>
  rulesOf([
    flagSetting('distanceField', true),
    numberSetting('distanceFieldScale', 1, atLeast(0)),
    flagSetting('distanceFieldTwoSided', false),
    numberSetting('distanceFieldDensity', 0.2, [0.05, 0.4]),
    countSetting('distanceFieldMaxResolution', 256, 1),
  ]))()

/** The fields of `DISTANCE_FIELD_RULES`, in order. */
export const DISTANCE_FIELD_SETTINGS = [
  'distanceField',
  'distanceFieldScale',
  'distanceFieldTwoSided',
  'distanceFieldDensity',
  'distanceFieldMaxResolution',
] as const

/** A source's distance field settings as the compiler reads them, each left out when not named. */
export type MeshDistanceFieldSettingsWire = {
  distanceField?: boolean
  distanceFieldScale?: number
  distanceFieldTwoSided?: boolean
  distanceFieldDensity?: number
  distanceFieldMaxResolution?: number
}
