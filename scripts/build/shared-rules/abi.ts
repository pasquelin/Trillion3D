// The values the compiler, the runtime and the physics module state in more than one language,
// written once in TypeScript and printed into the others (`../generate-shared-rules.ts`): the
// cache formats and compiler defaults into the compiler's Rust, and the public code of the family refusal into
// the browser's TypeScript.
import { join } from 'node:path'
import {
  ASSET_SCOPES,
  CLUSTERED_BLEND_FORMAT_VERSION,
  FORMAT_VERSION,
} from '../../../packages/sdk-core/src/contracts/base.ts'
import * as compiler from '../../../packages/sdk-core/src/contracts/compilerAbi.ts'
import * as partition from '../../../packages/sdk-core/src/contracts/partitionOptions.ts'
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/scene/light/contracts.ts'
import { DEFAULT_PIXEL_ERROR } from '../../../packages/sdk-core/src/lod/policy.ts'
import { REPOSITORY_ROOT, readJson } from '../../git/repository-files.ts'
import { upper } from './printer.ts'
import { header, rustStrings } from './statements.ts'

const CATALOGUE = 'packages/sdk-node/src/messages/messages.json'

/** The compiler's shared constants, `shared_math/abi.rs`, those of meshes and objects apart
 *  (`meshAbi.ts`). */
export function compilerAbiRust() {
  return `${header(
    [
      'packages/sdk-core/src/contracts/base.ts',
      'packages/sdk-core/src/contracts/compilerAbi.ts',
      'packages/sdk-core/src/contracts/hlodAbi.ts',
      'packages/sdk-core/src/contracts/hlodApproximationAbi.ts',
      'packages/sdk-core/src/contracts/hlodLayerAbi.ts',
      'packages/sdk-core/src/contracts/materialAbi.ts',
      'packages/sdk-core/src/contracts/partitionAbi.ts',
      'packages/sdk-core/src/contracts/partitionGridRules.ts',
      'packages/sdk-core/src/contracts/partitionOptions.ts',
      'packages/sdk-core/src/lod/policy.ts',
      'packages/sdk-core/src/scene/light/contracts.ts',
    ],
    '//!',
  )}

mod meshes;
pub use meshes::*;

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
/// The widest half-angle of a spot's cone and the least gap of its outer cone over its inner one,
/// in radians: the engine's own (\`SceneLight\` contract, \`LIGHT_SETTINGS\`), as the baked
/// lights and the runtime read them.
pub const SPOT_CONE_LIMIT: f64 = ${LIGHT_SETTINGS.spotConeLimit};
pub const SPOT_CONE_GAP: f64 = ${LIGHT_SETTINGS.spotConeGap};
/// The scopes a job may name.
pub const SCOPES: ${rustStrings(ASSET_SCOPES)};
/// How meshes may be simplified; the first is the default.
pub const SIMPLIFICATIONS: ${rustStrings(compiler.SIMPLIFICATIONS)};
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
/// The keys of a glTF node's \`extras\` making its object stand as itself in every HLOD actor its
/// chain builds, and taking it out of every HLOD layer.
pub const HLOD_INSTANCE_MARK: &str = ${JSON.stringify(compiler.HLOD_INSTANCE_MARK)};
pub const HLOD_INCLUDE_MARK: &str = ${JSON.stringify(compiler.HLOD_INCLUDE_MARK)};
/// How an HLOD layer builds its actors.
pub const HLOD_BUILDERS: ${rustStrings(compiler.HLOD_BUILDERS)};
/// Which LOD of each source a merged layer takes.
pub const HLOD_LOD_SELECTIONS: ${rustStrings(compiler.HLOD_LOD_SELECTIONS)};
/// How a merged layer generates the texture coordinates of a mesh baked on its own triangles that
/// has none to reuse.
pub const HLOD_MERGE_UV_METHODS: ${rustStrings(compiler.HLOD_MERGE_UV_METHODS)};
/// How an HLOD atlas bakes a translucent source, the value \`false\` names first, and the one
/// \`true\` names.
pub const HLOD_TRANSLUCENCIES: ${rustStrings(compiler.HLOD_TRANSLUCENCIES)};
pub const DEFAULT_HLOD_TRANSLUCENCY: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_TRANSLUCENCY)};
/// What an approximated layer's atlas holds where it holds no chart's value, the value \`false\`
/// names first, and the one \`true\` names.
pub const HLOD_EMPTY_TEXELS: ${rustStrings(compiler.HLOD_EMPTY_TEXELS)};
pub const DEFAULT_HLOD_EMPTY_TEXELS: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_EMPTY_TEXELS)};
/// How an approximated layer closes its scene's base and how a ground plane clips its shell, each
/// the value \`false\` names first, and the one \`true\` names.
pub const HLOD_BASE_CAPPINGS: ${rustStrings(compiler.HLOD_BASE_CAPPINGS)};
pub const DEFAULT_HLOD_BASE_CAPPING: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_BASE_CAPPING)};
pub const HLOD_GROUND_CLIPPINGS: ${rustStrings(compiler.HLOD_GROUND_CLIPPINGS)};
pub const DEFAULT_HLOD_GROUND_CLIPPING: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_GROUND_CLIPPING)};
/// How a simplified layer's vertex normals weigh the faces around a vertex, and how its transfer's
/// rays pick their hit.
pub const HLOD_NORMAL_METHODS: ${rustStrings(compiler.HLOD_NORMAL_METHODS)};
pub const HLOD_TRANSFER_RAYS: ${rustStrings(compiler.HLOD_TRANSFER_RAYS)};
/// The atlas sides, in texels, an approximated layer may name, and its side when it names none.
pub const MIN_HLOD_TEXTURE_SIZE: usize = ${compiler.MIN_HLOD_TEXTURE_SIZE};
pub const MAX_HLOD_TEXTURE_SIZE: usize = ${compiler.MAX_HLOD_TEXTURE_SIZE};
pub const DEFAULT_HLOD_TEXTURE_SIZE: usize = ${compiler.DEFAULT_HLOD_TEXTURE_SIZE};
/// An approximated layer's voxel and geometric deviation, metres, when it names none.
pub const DEFAULT_HLOD_ACCURACY: f64 = ${compiler.DEFAULT_HLOD_ACCURACY.toFixed(1)};
pub const DEFAULT_HLOD_DEVIATION: f64 = ${compiler.DEFAULT_HLOD_DEVIATION.toFixed(1)};
/// A layer's grid cell side and loading range, metres, when it names none.
pub const DEFAULT_HLOD_CELL_SIZE: f64 = ${compiler.DEFAULT_HLOD_CELL_SIZE.toFixed(1)};
pub const DEFAULT_HLOD_LOADING_RANGE: f64 = ${compiler.DEFAULT_HLOD_LOADING_RANGE.toFixed(1)};
/// The most levels a chain may have, HLOD 0 included.
pub const MAX_HLOD_LEVELS: usize = ${compiler.MAX_HLOD_LEVELS};
/// A 1×1 opaque white PNG, what a scene decodes in place of an image whose chain the cache bakes.
pub const BAKED_IMAGE: &str = ${JSON.stringify(compiler.BAKED_IMAGE)};
/// The job field naming the scene's temporal anti-aliasing level, the command line's flag holding
/// it, the levels, \`off\` first, and the one \`true\` names.
pub const TEMPORAL_AA_FIELD: &str = ${JSON.stringify(compiler.TEMPORAL_AA_FIELD)};
pub const TEMPORAL_AA_OPTION: &str = ${JSON.stringify(compiler.TEMPORAL_AA_OPTION)};
pub const TEMPORAL_AA_LEVELS: ${rustStrings(compiler.TEMPORAL_AA_LEVELS)};
pub const DEFAULT_TEMPORAL_AA_LEVEL: &str = ${JSON.stringify(compiler.DEFAULT_TEMPORAL_AA_LEVEL)};
/// The job fields naming the responsive objects and setting materials by name, the command
/// line's flags holding them as JSON, the key of a glTF material's \`extras\` naming its
/// responsiveness, the levels of a material's responsiveness, \`off\` first, and the one \`true\`
/// names, and the settings a material may name.
pub const RESPONSIVE_FIELD: &str = ${JSON.stringify(compiler.RESPONSIVE_FIELD)};
pub const RESPONSIVE_OPTION: &str = ${JSON.stringify(compiler.RESPONSIVE_OPTION)};
pub const MATERIALS_FIELD: &str = ${JSON.stringify(compiler.MATERIALS_FIELD)};
pub const MATERIALS_OPTION: &str = ${JSON.stringify(compiler.MATERIALS_OPTION)};
pub const RESPONSIVE_EXTRA: &str = ${JSON.stringify(compiler.RESPONSIVE_EXTRA)};
pub const RESPONSIVE_LEVELS: ${rustStrings(compiler.RESPONSIVE_LEVELS)};
pub const DEFAULT_RESPONSIVE_LEVEL: &str = ${JSON.stringify(compiler.DEFAULT_RESPONSIVE_LEVEL)};
pub const MATERIAL_SETTINGS: ${rustStrings(compiler.MATERIAL_SETTINGS)};
/// The job field naming the voxelized objects, the command line's flag holding it as JSON, and the
/// key of a glTF mesh's \`extras\` asking for voxels.
pub const VOXELIZE_FIELD: &str = ${JSON.stringify(compiler.VOXELIZE_FIELD)};
pub const VOXELIZE_OPTION: &str = ${JSON.stringify(compiler.VOXELIZE_OPTION)};
pub const VOXELIZE_EXTRA: &str = ${JSON.stringify(compiler.VOXELIZE_EXTRA)};
/// The key of a glTF material's \`extras\` naming its displacement, the keys it may hold and the
/// keys of its fade range, and the defaults, the reference's: the magnitude, the centre and the
/// fade range's two ends.
pub const DISPLACEMENT_EXTRA: &str = ${JSON.stringify(compiler.DISPLACEMENT_EXTRA)};
pub const DISPLACEMENT_KEYS: ${rustStrings(compiler.DISPLACEMENT_KEYS)};
pub const DISPLACEMENT_FADE_KEYS: ${rustStrings(compiler.DISPLACEMENT_FADE_KEYS)};
pub const DEFAULT_DISPLACEMENT_MAGNITUDE: f64 = ${compiler.DEFAULT_DISPLACEMENT_MAGNITUDE.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_CENTER: f64 = ${compiler.DEFAULT_DISPLACEMENT_CENTER.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_FADE_START: f64 = ${compiler.DEFAULT_DISPLACEMENT_FADE_START.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_FADE_END: f64 = ${compiler.DEFAULT_DISPLACEMENT_FADE_END.toFixed(1)};
/// The job field setting the partition's main grid, the command line's flag holding it as JSON,
/// the settings it may name, their defaults — the reference's main grid's — and the most a grid's
/// priority may be.
pub const PARTITION_GRID_FIELD: &str = ${JSON.stringify(compiler.PARTITION_GRID_FIELD)};
pub const PARTITION_GRID_OPTION: &str = ${JSON.stringify(compiler.PARTITION_GRID_OPTION)};
pub const PARTITION_GRID_SETTINGS: ${rustStrings(partition.PARTITION_GRID_SETTINGS)};
pub const DEFAULT_PARTITION_CELL_SIZE: f64 = ${compiler.DEFAULT_PARTITION_CELL_SIZE.toFixed(1)};
pub const DEFAULT_PARTITION_LOADING_RANGE: f64 = ${compiler.DEFAULT_PARTITION_LOADING_RANGE.toFixed(1)};
pub const DEFAULT_PARTITION_PRIORITY: u32 = ${compiler.DEFAULT_PARTITION_PRIORITY};
pub const MAX_PARTITION_PRIORITY: u32 = ${compiler.MAX_PARTITION_PRIORITY};
pub const DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING: bool = ${partition.DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING};
/// The job field naming several streaming grids, the command line's flag holding it as JSON, the
/// key of a grid's name, the characters it may not hold, and the first grid's default name.
pub const PARTITION_GRIDS_FIELD: &str = ${JSON.stringify(compiler.PARTITION_GRIDS_FIELD)};
pub const PARTITION_GRIDS_OPTION: &str = ${JSON.stringify(compiler.PARTITION_GRIDS_OPTION)};
pub const PARTITION_GRID_NAME_KEY: &str = ${JSON.stringify(compiler.PARTITION_GRID_NAME_KEY)};
pub const PARTITION_GRID_NAME_FORBIDDEN: &str = ${JSON.stringify(compiler.PARTITION_GRID_NAME_FORBIDDEN)};
pub const DEFAULT_PARTITION_GRID_NAME: &str = ${JSON.stringify(compiler.DEFAULT_PARTITION_GRID_NAME)};
/// The job field naming the world partition's scheme, the command line's flag holding it, a bare
/// name, the schemes and the default one, the reference's.
pub const PARTITION_SCHEME_FIELD: &str = ${JSON.stringify(partition.PARTITION_SCHEME_FIELD)};
pub const PARTITION_SCHEME_OPTION: &str = ${JSON.stringify(partition.PARTITION_SCHEME_OPTION)};
pub const PARTITION_SCHEMES: ${rustStrings(partition.PARTITION_SCHEMES)};
pub const DEFAULT_PARTITION_SCHEME: &str = ${JSON.stringify(partition.DEFAULT_PARTITION_SCHEME)};
/// Each scheme's own settings of the main grid, the bounds a loose cell may stream by, an HLOD
/// level's grid settings, and the defaults of a world the reference creates.
pub const HASH_SET_GRID_SETTINGS: ${rustStrings(partition.HASH_SET_GRID_SETTINGS)};
pub const SPATIAL_HASH_GRID_SETTINGS: ${rustStrings(partition.SPATIAL_HASH_GRID_SETTINGS)};
pub const PARTITION_STREAM_BOUNDS: ${rustStrings(partition.PARTITION_STREAM_BOUNDS)};
pub const DEFAULT_PARTITION_STREAM_BOUNDS: &str = ${JSON.stringify(partition.DEFAULT_PARTITION_STREAM_BOUNDS)};
pub const DEFAULT_PARTITION_FLAT: bool = ${partition.DEFAULT_PARTITION_FLAT};
pub const PARTITION_HLOD_GRID_SETTINGS: ${rustStrings(partition.PARTITION_HLOD_GRID_SETTINGS)};
pub const DEFAULT_PARTITION_NESTED_LEVELS: bool = ${partition.DEFAULT_PARTITION_NESTED_LEVELS};
pub const DEFAULT_PARTITION_PULL_COARSER: bool = ${partition.DEFAULT_PARTITION_PULL_COARSER};
pub const DEFAULT_PARTITION_SMALL_BY_CENTRE: bool = ${partition.DEFAULT_PARTITION_SMALL_BY_CENTRE};
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
