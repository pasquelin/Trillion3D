// The constants of a mesh's distance field, written once in TypeScript
// (`packages/sdk-core/src/contracts/distanceFieldAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the settings' names and defaults, the brick, the band, the mips
// and the magic of `distanceFields.bin`.
import * as field from '../../../packages/sdk-core/src/contracts/distanceFieldAbi.ts'
import { header } from './statements.ts'

/** The distance field's shared constants, `distance_field/abi.rs`. */
export function distanceFieldAbiRust() {
  const rules = field.DISTANCE_FIELD_RULES
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
/// The range of the density.
pub const DISTANCE_FIELD_DENSITY_RANGE: (f64, f64) = (${rules.distanceFieldDensity.range[0]}, ${rules.distanceFieldDensity.range[1]});
/// The reference's length unit per metre, the brick, the band, the mips and the magic of
/// \`distanceFields.bin\`.
pub const DISTANCE_FIELD_UNITS_PER_METRE: f64 = ${field.DISTANCE_FIELD_UNITS_PER_METRE.toFixed(1)};
pub const DISTANCE_FIELD_UNIQUE_BRICK: usize = ${field.DISTANCE_FIELD_UNIQUE_BRICK};
pub const DISTANCE_FIELD_BRICK: usize = ${field.DISTANCE_FIELD_BRICK};
pub const DISTANCE_FIELD_MIPS: usize = ${field.DISTANCE_FIELD_MIPS};
pub const DISTANCE_FIELD_BAND_VOXELS: f64 = ${field.DISTANCE_FIELD_BAND_VOXELS.toFixed(1)};
pub const DISTANCE_FIELD_OBJECT_BORDER: usize = ${field.DISTANCE_FIELD_OBJECT_BORDER};
pub const DISTANCE_FIELD_MAX_INDIRECTION: usize = ${field.DISTANCE_FIELD_MAX_INDIRECTION};
pub const DISTANCE_FIELD_FILE: &str = ${JSON.stringify(field.DISTANCE_FIELD_FILE)};
pub const DISTANCE_FIELD_MAGIC: u32 = ${field.DISTANCE_FIELD_MAGIC};
pub const DISTANCE_FIELD_VERSION: u32 = ${field.DISTANCE_FIELD_VERSION};
pub const DISTANCE_FIELD_HEAD_BYTES: usize = ${field.DISTANCE_FIELD_HEAD_BYTES};
pub const DISTANCE_FIELD_MESH_BYTES: usize = ${field.DISTANCE_FIELD_MESH_BYTES};
pub const DISTANCE_FIELD_MIP_BYTES: usize = ${field.DISTANCE_FIELD_MIP_BYTES};
`
}
