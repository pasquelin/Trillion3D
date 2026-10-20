// The values the compiler, the runtime and the physics module state in more than one language,
// written once in TypeScript and printed into the others (`../generate-shared-rules.ts`): the
// cache formats and compiler defaults into the compiler's Rust, and the public code of the family refusal into
// the browser's TypeScript.
import { join } from 'node:path'
import {
  ASSET_SCOPES,
  CLUSTERED_BLEND_FORMAT_VERSION,
  FORMAT_VERSION,
} from '../../packages/sdk-core/src/contracts/base.ts'
import * as compiler from '../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { DEFAULT_PIXEL_ERROR } from '../../packages/sdk-core/src/lod/policy.ts'
import { REPOSITORY_ROOT, readJson } from '../repository-files.ts'
import { upper } from './printer.ts'
import { header } from './statements.ts'

const CATALOGUE = 'packages/sdk-node/src/messages/messages.json'

/** A Rust array of the strings `words`. */
const strings = (words: readonly string[]) =>
  `[&str; ${words.length}] = [${words.map((word) => JSON.stringify(word)).join(', ')}]`

/** The compiler's shared constants, `shared_math/abi.rs`. */
export function compilerAbiRust() {
  return `${header(
    [
      'packages/sdk-core/src/contracts/base.ts',
      'packages/sdk-core/src/contracts/compilerAbi.ts',
      'packages/sdk-core/src/lod/policy.ts',
    ],
    '//!',
  )}

/// Cache format this compiler writes (\`base.ts\` documents each format's change).
pub const FORMAT_VERSION: u32 = ${FORMAT_VERSION};
/// Outer cache format required for clustered BLEND.
pub const CLUSTERED_BLEND_FORMAT_VERSION: u32 = ${CLUSTERED_BLEND_FORMAT_VERSION};
/// The triangle budget of a compilation that names none.
pub const DEFAULT_TRIANGLE_BUDGET: usize = ${compiler.DEFAULT_TRIANGLE_BUDGET};
/// The memory, in MB, of a compilation that names none.
pub const DEFAULT_RAM_BUDGET_MB: usize = ${compiler.DEFAULT_RAM_BUDGET_MB};
/// The most threads one job may use.
pub const MAX_THREADS: usize = ${compiler.MAX_THREADS};
/// The least memory, in MB, one job needs to decode the smallest scene.
pub const MIN_RAM_BUDGET_MB: usize = ${compiler.MIN_RAM_BUDGET_MB};
/// The screen error, in pixels, a view's cut is held to when its host names none: the distance
/// at which a cut draws a cluster.
pub const DEFAULT_PIXEL_ERROR: f64 = ${DEFAULT_PIXEL_ERROR.toFixed(1)};
/// The scopes a job may name.
pub const SCOPES: ${strings(ASSET_SCOPES)};
/// How meshes may be simplified; the first is the default.
pub const SIMPLIFICATIONS: ${strings(compiler.SIMPLIFICATIONS)};
/// The fields of one compile job, as a batch file names them.
pub mod job_field {
${compiler.JOB_FIELDS.map((field) => `    pub const ${upper(field)}: &str = ${JSON.stringify(field)};`).join('\n')}
}
/// The job fields in the order the command line takes them; its short forms leave out
/// \`simplification\`, then \`threads\` and \`ramBudgetMb\`.
pub const JOB_FIELDS: [&str; ${compiler.JOB_FIELDS.length}] = [${compiler.JOB_FIELDS.map((field) => `job_field::${upper(field)}`).join(', ')}];
/// The job field naming the HLOD, and the command line's flag holding it as JSON.
pub const HLOD_FIELD: &str = ${JSON.stringify(compiler.HLOD_FIELD)};
pub const HLOD_OPTION: &str = ${JSON.stringify(compiler.HLOD_OPTION)};
/// The key of a glTF node's \`extras\` marking its object for an HLOD group or layer, by name.
pub const HLOD_MARK: &str = ${JSON.stringify(compiler.HLOD_MARK)};
/// How an HLOD layer builds its actors.
pub const HLOD_BUILDERS: ${strings(compiler.HLOD_BUILDERS)};
/// Which LOD of each source a merged layer takes.
pub const HLOD_LOD_SELECTIONS: ${strings(compiler.HLOD_LOD_SELECTIONS)};
/// The atlas sides, in texels, an approximated layer may name, and its side when it names none.
pub const MIN_HLOD_TEXTURE_SIZE: usize = ${compiler.MIN_HLOD_TEXTURE_SIZE};
pub const MAX_HLOD_TEXTURE_SIZE: usize = ${compiler.MAX_HLOD_TEXTURE_SIZE};
pub const DEFAULT_HLOD_TEXTURE_SIZE: usize = ${compiler.DEFAULT_HLOD_TEXTURE_SIZE};
/// An approximated layer's voxel, in pixels, when it names none.
pub const DEFAULT_HLOD_VOXEL_PIXELS: f64 = ${compiler.DEFAULT_HLOD_VOXEL_PIXELS};
/// The most levels a chain may have, HLOD 0 included.
pub const MAX_HLOD_LEVELS: usize = ${compiler.MAX_HLOD_LEVELS};
/// A 1×1 opaque white PNG, what a scene decodes in place of an image whose chain the cache bakes.
pub const BAKED_IMAGE: &str = ${JSON.stringify(compiler.BAKED_IMAGE)};
/// The job field naming the scene's temporal anti-aliasing level, the command line's flag holding
/// it, the levels, \`off\` first, and the one \`true\` names.
pub const TEMPORAL_AA_FIELD: &str = ${JSON.stringify(compiler.TEMPORAL_AA_FIELD)};
pub const TEMPORAL_AA_OPTION: &str = ${JSON.stringify(compiler.TEMPORAL_AA_OPTION)};
pub const TEMPORAL_AA_LEVELS: ${strings(compiler.TEMPORAL_AA_LEVELS)};
pub const DEFAULT_TEMPORAL_AA_LEVEL: &str = ${JSON.stringify(compiler.DEFAULT_TEMPORAL_AA_LEVEL)};
/// The job fields naming the responsive objects and setting materials by name, the command
/// line's flags holding them as JSON, the keys of a glTF material's \`extras\` naming its history
/// share and asking for a responsive history, the named history shares, and the settings a
/// material may name.
pub const RESPONSIVE_FIELD: &str = ${JSON.stringify(compiler.RESPONSIVE_FIELD)};
pub const RESPONSIVE_OPTION: &str = ${JSON.stringify(compiler.RESPONSIVE_OPTION)};
pub const MATERIALS_FIELD: &str = ${JSON.stringify(compiler.MATERIALS_FIELD)};
pub const MATERIALS_OPTION: &str = ${JSON.stringify(compiler.MATERIALS_OPTION)};
pub const RESPONSIVE_EXTRA: &str = ${JSON.stringify(compiler.RESPONSIVE_EXTRA)};
pub const TEMPORAL_AA_EXTRA: &str = ${JSON.stringify(compiler.TEMPORAL_AA_EXTRA)};
pub const TEMPORAL_AA_SHARES: [(&str, f64); ${Object.keys(compiler.TEMPORAL_AA_SHARES).length}] = [${Object.entries(
    compiler.TEMPORAL_AA_SHARES,
  )
    .map(([name, share]) => `(${JSON.stringify(name)}, ${share.toFixed(2)})`)
    .join(', ')}];
pub const MATERIAL_SETTINGS: ${strings(compiler.MATERIAL_SETTINGS)};
/// The job field naming the voxelized objects, the command line's flag holding it as JSON, and the
/// key of a glTF mesh's \`extras\` asking for voxels.
pub const VOXELIZE_FIELD: &str = ${JSON.stringify(compiler.VOXELIZE_FIELD)};
pub const VOXELIZE_OPTION: &str = ${JSON.stringify(compiler.VOXELIZE_OPTION)};
pub const VOXELIZE_EXTRA: &str = ${JSON.stringify(compiler.VOXELIZE_EXTRA)};
`
}

/** The public code of the family refusal, read from the message catalogue. */
export function familyLoadFailedId() {
  const entry = (
    readJson(join(REPOSITORY_ROOT, CATALOGUE)) as {
      messages: { id: string; code: string }[]
    }
  ).messages.find((message) => message.code === 'FAMILY_LOAD_FAILED')
  if (!entry) throw new Error('the message catalogue has no FAMILY_LOAD_FAILED')
  return `${header([CATALOGUE], '//')}

/** The public code of a family that could not load (\`FAMILY_LOAD_FAILED\` in the message catalogue). */
export const FAMILY_LOAD_FAILED_ID = '${entry.id}'
`
}
