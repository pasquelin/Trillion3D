// The physics cook's constants, written once in TypeScript and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the vertex stride of a soft body, the density a closed mesh is
// weighed at and the rules a cooked soft body is made by, which the page's `softBodyOf` reads too.
import {
  GRAVITY_PRESETS,
  PHYSICS_STEP,
  SHAPE_DENSITY,
} from '../../../packages/sdk-core/src/physics/options.ts'
import {
  SOFT_AREAL_DENSITY,
  SOFT_FOOTPRINT,
  SOFT_LINEAR_DENSITY,
  SOFT_MAX_SWELL,
  SOFT_SUBSTEPS,
} from '../../../packages/sdk-core/src/physics/soft/soft.ts'
import { SOFT_VERTEX_WORDS } from '../../../packages/sdk-core/src/physics/soft/softLayout.ts'
import { float, header } from './statements.ts'

/** The cook's shared constants, `physics_cook/rules.rs`. */
export function physicsCookRulesRust() {
  return `${header(
    [
      'packages/sdk-core/src/physics/options.ts',
      'packages/sdk-core/src/physics/soft/soft.ts',
      'packages/sdk-core/src/physics/soft/softLayout.ts',
    ],
    '//!',
  )}

/// Words of each soft body vertex, \`x, y, z, mass\`: the worker's and the builder's stride.
pub const SOFT_VERTEX_WORDS: usize = ${SOFT_VERTEX_WORDS};
/// Density a body is weighed at, kg/m³: the runtime's.
pub const SHAPE_DENSITY: f64 = ${float(SHAPE_DENSITY)};
/// kg/m² of a cloth's or a volume's skin, and kg/m of a rope, left undeclared.
pub const SOFT_AREAL_DENSITY: f64 = ${float(SOFT_AREAL_DENSITY)};
pub const SOFT_LINEAR_DENSITY: f64 = ${float(SOFT_LINEAR_DENSITY)};
/// A volume's default pressure rests its weight on this share of its mean cross-section, and a
/// volume keeps within this share of its rest volume.
pub const SOFT_FOOTPRINT: f64 = ${float(SOFT_FOOTPRINT)};
pub const SOFT_MAX_SWELL: f64 = ${float(SOFT_MAX_SWELL)};
/// The engine's fixed step.
pub const PHYSICS_STEP: f64 = ${float(PHYSICS_STEP)};
/// The solver's substeps of a soft body per step.
pub const SOFT_SUBSTEPS: u32 = ${SOFT_SUBSTEPS};
/// Earth's pull, m/s².
pub const EARTH_GRAVITY: f64 = ${float(GRAVITY_PRESETS.earth)};
`
}
