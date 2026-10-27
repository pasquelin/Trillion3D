// The constants of a mesh's distance field, written once in TypeScript
// (`packages/sdk-core/src/contracts/distanceFieldAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the settings' names and defaults, the brick, the band, the mips
// and the magic of `distanceFields.bin`.
import * as field from '../../../packages/sdk-core/src/contracts/distanceFieldAbi.ts'
import { float, header, rustConsts } from './statements.ts'

/** A Rust literal of a range's end: the largest and smallest numbers by their names, a float always with its point. */
const end = (value: number) =>
  value >= 1e300 ? 'f64::MAX' : value <= -1e300 ? 'f64::MIN' : float(value)

/** The distance field's shared constants, `distance_field/abi.rs`. */
export function distanceFieldAbiRust() {
  const rules = field.DISTANCE_FIELD_RULES
  const density = rules.distanceFieldDensity.range
  return `${header(['packages/sdk-core/src/contracts/distanceFieldAbi.ts'], '//!')}

/// The mesh build settings of a distance field (\`meshBuild\`) and their defaults, the reference's.
pub const DISTANCE_FIELD_SETTING: &str = ${JSON.stringify(rules.distanceField.field)};
pub const DISTANCE_FIELD_SCALE_SETTING: &str = ${JSON.stringify(rules.distanceFieldScale.field)};
pub const DISTANCE_FIELD_TWO_SIDED_SETTING: &str = ${JSON.stringify(rules.distanceFieldTwoSided.field)};
pub const DISTANCE_FIELD_DENSITY_SETTING: &str = ${JSON.stringify(rules.distanceFieldDensity.field)};
pub const DISTANCE_FIELD_MAX_RESOLUTION_SETTING: &str = ${JSON.stringify(rules.distanceFieldMaxResolution.field)};
pub const DEFAULT_DISTANCE_FIELD: bool = ${rules.distanceField.default};
pub const DEFAULT_DISTANCE_FIELD_SCALE: f64 = ${rules.distanceFieldScale.default.toFixed(1)};
pub const DEFAULT_DISTANCE_FIELD_TWO_SIDED: bool = ${rules.distanceFieldTwoSided.default};
pub const DEFAULT_DISTANCE_FIELD_DENSITY: f64 = ${rules.distanceFieldDensity.default};
pub const DEFAULT_DISTANCE_FIELD_MAX_RESOLUTION: u32 = ${rules.distanceFieldMaxResolution.default};
/// The range of the density: any finite number.
pub const DISTANCE_FIELD_DENSITY_RANGE: (f64, f64) = (${end(density[0])}, ${end(density[1])});
/// The reference's length unit per metre, the brick, the band, the mips and the magic of
/// \`distanceFields.bin\`.
${rustConsts({
  DISTANCE_FIELD_UNITS_PER_METRE: [field.DISTANCE_FIELD_UNITS_PER_METRE, 'f64'],
  DISTANCE_FIELD_UNIQUE_BRICK: [field.DISTANCE_FIELD_UNIQUE_BRICK, 'usize'],
  DISTANCE_FIELD_BRICK: [field.DISTANCE_FIELD_BRICK, 'usize'],
  DISTANCE_FIELD_MIPS: [field.DISTANCE_FIELD_MIPS, 'usize'],
  DISTANCE_FIELD_BAND_VOXELS: [field.DISTANCE_FIELD_BAND_VOXELS, 'f64'],
  DISTANCE_FIELD_OBJECT_BORDER: [field.DISTANCE_FIELD_OBJECT_BORDER, 'usize'],
  DISTANCE_FIELD_MAX_INDIRECTION: [field.DISTANCE_FIELD_MAX_INDIRECTION, 'usize'],
  DISTANCE_FIELD_FILE: [field.DISTANCE_FIELD_FILE, '&str'],
  DISTANCE_FIELD_MAGIC: [field.DISTANCE_FIELD_MAGIC, 'u32'],
  DISTANCE_FIELD_VERSION: [field.DISTANCE_FIELD_VERSION, 'u32'],
  DISTANCE_FIELD_HEAD_BYTES: [field.DISTANCE_FIELD_HEAD_BYTES, 'usize'],
  DISTANCE_FIELD_MESH_BYTES: [field.DISTANCE_FIELD_MESH_BYTES, 'usize'],
  DISTANCE_FIELD_FLAG_TWO_SIDED: [field.DISTANCE_FIELD_FLAG_TWO_SIDED, 'u32'],
  DISTANCE_FIELD_FLAG_HLOD_CELL: [field.DISTANCE_FIELD_FLAG_HLOD_CELL, 'u32'],
  DISTANCE_FIELD_MIP_BYTES: [field.DISTANCE_FIELD_MIP_BYTES, 'usize'],
})}
`
}
