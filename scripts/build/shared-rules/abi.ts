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
import { DEFAULT_PIXEL_ERROR } from '../../../packages/sdk-core/src/lod/policy.ts'
import { REPOSITORY_ROOT, readJson } from '../../git/repository-files.ts'
import { upper } from './printer.ts'
import { header } from './statements.ts'

const CATALOGUE = 'packages/sdk-node/src/messages/messages.json'

/** A Rust array of the strings `words`. */
const strings = (words: readonly string[]) =>
  `[&str; ${words.length}] = [${words.map((word) => JSON.stringify(word)).join(', ')}]`

/** The compiler's shared constants, `shared_math/abi.rs`. */
export function compilerAbiRust() {
  const mesh = compiler.MESH_BUILD_RULES
  const shape = compiler.HLOD_SHAPE_RULES
  return `${header(
    [
      'packages/sdk-core/src/contracts/base.ts',
      'packages/sdk-core/src/contracts/compilerAbi.ts',
      'packages/sdk-core/src/contracts/hlodAbi.ts',
      'packages/sdk-core/src/contracts/hlodApproximationAbi.ts',
      'packages/sdk-core/src/contracts/hlodLayerAbi.ts',
      'packages/sdk-core/src/contracts/materialAbi.ts',
      'packages/sdk-core/src/contracts/meshBuildAbi.ts',
      'packages/sdk-core/src/contracts/objectAbi.ts',
      'packages/sdk-core/src/contracts/partitionAbi.ts',
      'packages/sdk-core/src/contracts/partitionGridOptions.ts',
      'packages/sdk-core/src/contracts/partitionOptions.ts',
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
/// The keys of a glTF node's \`extras\` making its object stand as itself in every HLOD actor its
/// chain builds, and taking it out of every HLOD layer.
pub const HLOD_INSTANCE_MARK: &str = ${JSON.stringify(compiler.HLOD_INSTANCE_MARK)};
pub const HLOD_INCLUDE_MARK: &str = ${JSON.stringify(compiler.HLOD_INCLUDE_MARK)};
/// How an HLOD layer builds its actors.
pub const HLOD_BUILDERS: ${strings(compiler.HLOD_BUILDERS)};
/// Which LOD of each source a merged layer takes.
pub const HLOD_LOD_SELECTIONS: ${strings(compiler.HLOD_LOD_SELECTIONS)};
/// How a merged layer generates the texture coordinates of a mesh baked on its own triangles that
/// has none to reuse.
pub const HLOD_MERGE_UV_METHODS: ${strings(compiler.HLOD_MERGE_UV_METHODS)};
/// How an HLOD atlas bakes a translucent source, the value \`false\` names first, and the one
/// \`true\` names.
pub const HLOD_TRANSLUCENCIES: ${strings(compiler.HLOD_TRANSLUCENCIES)};
pub const DEFAULT_HLOD_TRANSLUCENCY: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_TRANSLUCENCY)};
/// What an approximated layer's atlas holds where it holds no chart's value, the value \`false\`
/// names first, and the one \`true\` names.
pub const HLOD_EMPTY_TEXELS: ${strings(compiler.HLOD_EMPTY_TEXELS)};
pub const DEFAULT_HLOD_EMPTY_TEXELS: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_EMPTY_TEXELS)};
/// How an approximated layer closes its scene's base and how a ground plane clips its shell, each
/// the value \`false\` names first, and the one \`true\` names.
pub const HLOD_BASE_CAPPINGS: ${strings(compiler.HLOD_BASE_CAPPINGS)};
pub const DEFAULT_HLOD_BASE_CAPPING: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_BASE_CAPPING)};
pub const HLOD_GROUND_CLIPPINGS: ${strings(compiler.HLOD_GROUND_CLIPPINGS)};
pub const DEFAULT_HLOD_GROUND_CLIPPING: &str = ${JSON.stringify(compiler.DEFAULT_HLOD_GROUND_CLIPPING)};
/// How a simplified layer's vertex normals weigh the faces around a vertex, and how its transfer's
/// rays pick their hit.
pub const HLOD_NORMAL_METHODS: ${strings(compiler.HLOD_NORMAL_METHODS)};
pub const HLOD_TRANSFER_RAYS: ${strings(compiler.HLOD_TRANSFER_RAYS)};
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
/// The key of a glTF material's \`extras\` naming its displacement, the keys it may hold and the
/// keys of its fade range, and the defaults, the reference's: the magnitude, the centre and the
/// fade range's two ends.
pub const DISPLACEMENT_EXTRA: &str = ${JSON.stringify(compiler.DISPLACEMENT_EXTRA)};
pub const DISPLACEMENT_KEYS: ${strings(compiler.DISPLACEMENT_KEYS)};
pub const DISPLACEMENT_FADE_KEYS: ${strings(compiler.DISPLACEMENT_FADE_KEYS)};
pub const DEFAULT_DISPLACEMENT_MAGNITUDE: f64 = ${compiler.DEFAULT_DISPLACEMENT_MAGNITUDE.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_CENTER: f64 = ${compiler.DEFAULT_DISPLACEMENT_CENTER.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_FADE_START: f64 = ${compiler.DEFAULT_DISPLACEMENT_FADE_START.toFixed(1)};
pub const DEFAULT_DISPLACEMENT_FADE_END: f64 = ${compiler.DEFAULT_DISPLACEMENT_FADE_END.toFixed(1)};
/// The job field setting the partition's main grid, the command line's flag holding it as JSON,
/// the settings it may name, their defaults — the reference's main grid's — and the most a grid's
/// priority may be.
pub const PARTITION_GRID_FIELD: &str = ${JSON.stringify(compiler.PARTITION_GRID_FIELD)};
pub const PARTITION_GRID_OPTION: &str = ${JSON.stringify(compiler.PARTITION_GRID_OPTION)};
pub const PARTITION_GRID_SETTINGS: ${strings(partition.PARTITION_GRID_SETTINGS)};
pub const DEFAULT_PARTITION_CELL_SIZE: f64 = ${compiler.DEFAULT_PARTITION_CELL_SIZE.toFixed(1)};
pub const DEFAULT_PARTITION_LOADING_RANGE: f64 = ${compiler.DEFAULT_PARTITION_LOADING_RANGE.toFixed(1)};
pub const DEFAULT_PARTITION_PRIORITY: u32 = ${compiler.DEFAULT_PARTITION_PRIORITY};
pub const MAX_PARTITION_PRIORITY: u32 = ${compiler.MAX_PARTITION_PRIORITY};
pub const DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING: bool = ${partition.DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING};
/// The job field naming several streaming grids, the command line's flag holding it as JSON, the
/// key of a grid's name in it, the characters it may not hold and the first grid's name when it
/// names none, the reference's.
pub const PARTITION_GRIDS_FIELD: &str = ${JSON.stringify(compiler.PARTITION_GRIDS_FIELD)};
pub const PARTITION_GRIDS_OPTION: &str = ${JSON.stringify(compiler.PARTITION_GRIDS_OPTION)};
pub const PARTITION_GRID_NAME_KEY: &str = ${JSON.stringify(compiler.PARTITION_GRID_NAME_KEY)};
pub const PARTITION_GRID_NAME_FORBIDDEN: &str = ${JSON.stringify(compiler.PARTITION_GRID_NAME_FORBIDDEN)};
pub const DEFAULT_PARTITION_GRID_NAME: &str = ${JSON.stringify(compiler.DEFAULT_PARTITION_GRID_NAME)};
/// The job field naming the world partition's scheme, the command line's flag holding it, a bare
/// name, the schemes and the default one, the reference's.
pub const PARTITION_SCHEME_FIELD: &str = ${JSON.stringify(partition.PARTITION_SCHEME_FIELD)};
pub const PARTITION_SCHEME_OPTION: &str = ${JSON.stringify(partition.PARTITION_SCHEME_OPTION)};
pub const PARTITION_SCHEMES: ${strings(partition.PARTITION_SCHEMES)};
pub const DEFAULT_PARTITION_SCHEME: &str = ${JSON.stringify(partition.DEFAULT_PARTITION_SCHEME)};
/// Each scheme's own settings of the main grid, the bounds a loose cell may stream by, an HLOD
/// level's grid settings, and the defaults of a world the reference creates.
pub const HASH_SET_GRID_SETTINGS: ${strings(partition.HASH_SET_GRID_SETTINGS)};
pub const SPATIAL_HASH_GRID_SETTINGS: ${strings(partition.SPATIAL_HASH_GRID_SETTINGS)};
pub const PARTITION_STREAM_BOUNDS: ${strings(partition.PARTITION_STREAM_BOUNDS)};
pub const DEFAULT_PARTITION_STREAM_BOUNDS: &str = ${JSON.stringify(partition.DEFAULT_PARTITION_STREAM_BOUNDS)};
pub const DEFAULT_PARTITION_FLAT: bool = ${partition.DEFAULT_PARTITION_FLAT};
pub const PARTITION_HLOD_GRID_SETTINGS: ${strings(partition.PARTITION_HLOD_GRID_SETTINGS)};
pub const DEFAULT_PARTITION_NESTED_LEVELS: bool = ${partition.DEFAULT_PARTITION_NESTED_LEVELS};
pub const DEFAULT_PARTITION_PULL_COARSER: bool = ${partition.DEFAULT_PARTITION_PULL_COARSER};
pub const DEFAULT_PARTITION_SMALL_BY_CENTRE: bool = ${partition.DEFAULT_PARTITION_SMALL_BY_CENTRE};
/// The job field setting how each mesh is built, the command line's flag holding it as JSON, the
/// key of its rules by object, its settings — each also the key of a glTF mesh's \`extras\` naming
/// it — and their defaults, the reference's.
pub const MESH_BUILD_FIELD: &str = ${JSON.stringify(compiler.MESH_BUILD_FIELD)};
pub const MESH_BUILD_OPTION: &str = ${JSON.stringify(compiler.MESH_BUILD_OPTION)};
pub const MESH_BUILD_OBJECTS: &str = ${JSON.stringify(compiler.MESH_BUILD_OBJECTS)};
pub const STORED_TANGENTS_SETTING: &str = ${JSON.stringify(mesh.storedTangents.field)};
pub const KEPT_TRIANGLES_SETTING: &str = ${JSON.stringify(mesh.keptTriangles.field)};
pub const TRIMMED_ERROR_SETTING: &str = ${JSON.stringify(mesh.trimmedError.field)};
pub const DROP_NEAR_COLLAPSED_SETTING: &str = ${JSON.stringify(mesh.dropNearCollapsed.field)};
pub const ALWAYS_RESIDENT_SETTING: &str = ${JSON.stringify(mesh.alwaysResidentKib.field)};
pub const RECOMPUTE_NORMALS_SETTING: &str = ${JSON.stringify(mesh.recomputeNormals.field)};
pub const RECOMPUTE_TANGENTS_SETTING: &str = ${JSON.stringify(mesh.recomputeTangents.field)};
pub const MIKK_TSPACE_SETTING: &str = ${JSON.stringify(mesh.useMikkTSpace.field)};
pub const WEIGHTED_NORMALS_SETTING: &str = ${JSON.stringify(mesh.computeWeightedNormals.field)};
pub const SKINNED_WELD_POSITION_SETTING: &str = ${JSON.stringify(mesh.skinnedWeldPosition.field)};
pub const SKINNED_WELD_NORMAL_SETTING: &str = ${JSON.stringify(mesh.skinnedWeldNormal.field)};
pub const SKINNED_WELD_TEXTURE_SETTING: &str = ${JSON.stringify(mesh.skinnedWeldTexture.field)};
pub const VOXEL_RAYS_SETTING: &str = ${JSON.stringify(mesh.voxelRays.field)};
pub const VOXEL_LEVEL_SETTING: &str = ${JSON.stringify(mesh.voxelLevel.field)};
pub const VOXEL_BACK_UP_SETTING: &str = ${JSON.stringify(mesh.voxelBackUp.field)};
pub const VOXEL_SEPARABLE_SETTING: &str = ${JSON.stringify(mesh.voxelSeparable.field)};
pub const VOXEL_NDF_SETTING: &str = ${JSON.stringify(mesh.voxelNdf.field)};
pub const VOXEL_OPACITY_SETTING: &str = ${JSON.stringify(mesh.voxelOpacity.field)};
pub const ALLOW_ASSEMBLIES_SETTING: &str = ${JSON.stringify(mesh.allowAssemblies.field)};
pub const POSITION_PRECISION_SETTING: &str = ${JSON.stringify(compiler.POSITION_PRECISION_SETTING)};
pub const NORMAL_PRECISION_SETTING: &str = ${JSON.stringify(compiler.NORMAL_PRECISION_SETTING)};
pub const TANGENT_PRECISION_SETTING: &str = ${JSON.stringify(compiler.TANGENT_PRECISION_SETTING)};
pub const MESH_BUILD_SETTINGS: ${strings(compiler.MESH_BUILD_SETTINGS)};
pub const DEFAULT_STORED_TANGENTS: bool = ${mesh.storedTangents.default};
pub const DEFAULT_KEPT_TRIANGLES: f64 = ${mesh.keptTriangles.default.toFixed(1)};
pub const DEFAULT_TRIMMED_ERROR: f64 = ${mesh.trimmedError.default.toFixed(1)};
pub const DEFAULT_DROP_NEAR_COLLAPSED: bool = ${mesh.dropNearCollapsed.default};
pub const DEFAULT_ALWAYS_RESIDENT_KIB: u32 = ${mesh.alwaysResidentKib.default};
pub const MAX_ALWAYS_RESIDENT_KIB: u32 = ${compiler.MAX_ALWAYS_RESIDENT_KIB};
pub const DEFAULT_RECOMPUTE_NORMALS: bool = ${mesh.recomputeNormals.default};
pub const DEFAULT_RECOMPUTE_TANGENTS: bool = ${mesh.recomputeTangents.default};
pub const DEFAULT_MIKK_TSPACE: bool = ${mesh.useMikkTSpace.default};
pub const DEFAULT_WEIGHTED_NORMALS: bool = ${mesh.computeWeightedNormals.default};
pub const DEFAULT_SKINNED_WELD_POSITION: f64 = ${mesh.skinnedWeldPosition.default};
pub const DEFAULT_SKINNED_WELD_NORMAL: f64 = ${mesh.skinnedWeldNormal.default};
pub const DEFAULT_SKINNED_WELD_TEXTURE: f64 = ${mesh.skinnedWeldTexture.default};
/// How a voxelized mesh's voxels are sampled: the defaults, the reference's, and the rays a voxel
/// casts at most, the packet they are cast in, and the count below which a voxel no ray hit is
/// sampled again a level up.
pub const DEFAULT_VOXEL_RAYS: u32 = ${mesh.voxelRays.default};
pub const DEFAULT_VOXEL_LEVEL: i32 = ${mesh.voxelLevel.default};
pub const DEFAULT_VOXEL_BACK_UP: f64 = ${mesh.voxelBackUp.default.toFixed(1)};
pub const DEFAULT_VOXEL_SEPARABLE: bool = ${mesh.voxelSeparable.default};
pub const DEFAULT_VOXEL_NDF: bool = ${mesh.voxelNdf.default};
pub const DEFAULT_VOXEL_OPACITY: bool = ${mesh.voxelOpacity.default};
pub const DEFAULT_ALLOW_ASSEMBLIES: bool = ${mesh.allowAssemblies.default};
pub const MAX_VOXEL_RAYS: u32 = ${compiler.MAX_VOXEL_RAYS};
pub const VOXEL_RAY_PACKET: u32 = ${compiler.VOXEL_RAY_PACKET};
pub const VOXEL_REMEMBER_BELOW_RAYS: u32 = ${compiler.VOXEL_REMEMBER_BELOW_RAYS};
/// How a mesh keeps its shape as its DAG is built — the keys of a glTF mesh's \`extras\` bounding
/// its edges and holding its texture coordinates, and their defaults, the reference's —, and the
/// settings a merged HLOD layer's \`meshBuild\` names for its actors' meshes, with the shapes it
/// may keep.
pub const EDGE_LENGTH_SETTING: &str = ${JSON.stringify(shape.edgeLengthBound.field)};
pub const HOLD_TEXTURE_SETTING: &str = ${JSON.stringify(shape.holdTextureCoordinates.field)};
pub const DEFAULT_EDGE_LENGTH_BOUND: f64 = ${shape.edgeLengthBound.default.toFixed(1)};
pub const DEFAULT_HOLD_TEXTURE: bool = ${shape.holdTextureCoordinates.default};
pub const HLOD_MESH_BUILD_SETTINGS: ${strings(compiler.HLOD_MESH_BUILD_SETTINGS)};
pub const HLOD_SHAPE_PRESERVATIONS: ${strings(compiler.HLOD_SHAPE_PRESERVATIONS)};
pub const DEFAULT_SHAPE_PRESERVATION: &str = ${JSON.stringify(shape.shapePreservation.default)};
/// The object settings' job field, flag, rules key, settings (each a glTF node's \`extras\` key),
/// skinned-instance settings, mobilities, defaults (the reference's) and bank frame rate.
pub const OBJECT_SETTINGS_FIELD: &str = ${JSON.stringify(compiler.OBJECT_SETTINGS_FIELD)};
pub const OBJECT_SETTINGS_OPTION: &str = ${JSON.stringify(compiler.OBJECT_SETTINGS_OPTION)};
pub const OBJECT_SETTINGS_OBJECTS: &str = ${JSON.stringify(compiler.OBJECT_SETTINGS_OBJECTS)};
pub const SPATIALLY_LOADED_SETTING: &str = ${JSON.stringify(compiler.SPATIALLY_LOADED_SETTING)};
pub const SKINNED_INSTANCE_SETTING: &str = ${JSON.stringify(compiler.SKINNED_INSTANCE_SETTING)};
pub const RUNTIME_GRID_SETTING: &str = ${JSON.stringify(compiler.RUNTIME_GRID_SETTING)};
pub const FAR_FIELD_SETTING: &str = ${JSON.stringify(compiler.FAR_FIELD_SETTING)};
pub const DEFAULT_FAR_FIELD: bool = ${compiler.DEFAULT_FAR_FIELD};
pub const DRAW_DISTANCE_SETTING: &str = ${JSON.stringify(compiler.DRAW_DISTANCE_SETTING)};
pub const DRAW_DISTANCE_SETTINGS: ${strings(compiler.DRAW_DISTANCE_SETTINGS)};
pub const DEFAULT_DRAW_DISTANCE_MIN: f64 = ${compiler.DEFAULT_DRAW_DISTANCE_MIN.toFixed(1)};
pub const DEFAULT_DRAW_DISTANCE_MAX: f64 = ${compiler.DEFAULT_DRAW_DISTANCE_MAX.toFixed(1)};
pub const OBJECT_SETTINGS: ${strings(compiler.OBJECT_SETTINGS)};
pub const SKINNED_INSTANCE_SETTINGS: ${strings(compiler.SKINNED_INSTANCE_SETTINGS)};
pub const OBJECT_MOBILITIES: ${strings(compiler.OBJECT_MOBILITIES)};
pub const DEFAULT_SPATIALLY_LOADED: bool = ${compiler.DEFAULT_SPATIALLY_LOADED};
pub const DEFAULT_BANK_LOOPING: bool = ${compiler.DEFAULT_BANK_LOOPING};
pub const DEFAULT_BANK_PLAY_RATE: f64 = ${compiler.DEFAULT_BANK_PLAY_RATE.toFixed(1)};
pub const DEFAULT_BANK_POSITION: f64 = ${compiler.DEFAULT_BANK_POSITION.toFixed(1)};
pub const DEFAULT_BANK_BOUNDS_SCALE: f64 = ${compiler.DEFAULT_BANK_BOUNDS_SCALE.toFixed(1)};
pub const DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE: f64 = ${compiler.DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE.toFixed(1)};
pub const DEFAULT_OBJECT_MOBILITY: &str = ${JSON.stringify(compiler.DEFAULT_OBJECT_MOBILITY)};
pub const ANIMATION_BANK_SAMPLE_RATE: f64 = ${compiler.ANIMATION_BANK_SAMPLE_RATE.toFixed(1)};
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
