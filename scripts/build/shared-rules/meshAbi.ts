// The compiler's settings of meshes and objects, written once in TypeScript and printed into the
// compiler's Rust (`../generate-shared-rules.ts`): `shared_math/abi/meshes.rs`, which `abi.rs`
// re-exports.
import * as compiler from '../../../packages/sdk-core/src/contracts/compilerAbi.ts'
import { header, rustStrings } from './statements.ts'

/** How each mesh is built and how each object is placed, `shared_math/abi/meshes.rs`. */
export function meshAbiRust() {
  const mesh = compiler.MESH_BUILD_RULES
  const shape = compiler.HLOD_SHAPE_RULES
  return `${header(
    [
      'packages/sdk-core/src/contracts/meshBuildAbi.ts',
      'packages/sdk-core/src/contracts/objectAbi.ts',
    ],
    '//!',
  )}

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
pub const MAX_MESH_CARDS_SETTING: &str = ${JSON.stringify(mesh.maxMeshCards.field)};
pub const MESH_CARD_MIN_DENSITY_SETTING: &str = ${JSON.stringify(mesh.meshCardMinDensity.field)};
pub const MESH_CARD_NORMAL_THRESHOLD_SETTING: &str = ${JSON.stringify(mesh.meshCardNormalThreshold.field)};
pub const POSITION_PRECISION_SETTING: &str = ${JSON.stringify(compiler.POSITION_PRECISION_SETTING)};
pub const NORMAL_PRECISION_SETTING: &str = ${JSON.stringify(compiler.NORMAL_PRECISION_SETTING)};
pub const TANGENT_PRECISION_SETTING: &str = ${JSON.stringify(compiler.TANGENT_PRECISION_SETTING)};
pub const MESH_BUILD_SETTINGS: ${rustStrings(compiler.MESH_BUILD_SETTINGS)};
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
/// The cards of a mesh: the defaults, the reference's, and the most cards a mesh may keep.
pub const DEFAULT_MAX_MESH_CARDS: u32 = ${mesh.maxMeshCards.default};
pub const DEFAULT_MESH_CARD_MIN_DENSITY: f64 = ${mesh.meshCardMinDensity.default};
pub const DEFAULT_MESH_CARD_NORMAL_THRESHOLD: f64 = ${mesh.meshCardNormalThreshold.default};
pub const MAX_MESH_CARDS: u32 = ${compiler.MAX_MESH_CARDS};
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
pub const HLOD_MESH_BUILD_SETTINGS: ${rustStrings(compiler.HLOD_MESH_BUILD_SETTINGS)};
pub const HLOD_SHAPE_PRESERVATIONS: ${rustStrings(compiler.HLOD_SHAPE_PRESERVATIONS)};
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
pub const DRAW_DISTANCE_SETTINGS: ${rustStrings(compiler.DRAW_DISTANCE_SETTINGS)};
pub const DEFAULT_DRAW_DISTANCE_MIN: f64 = ${compiler.DEFAULT_DRAW_DISTANCE_MIN.toFixed(1)};
pub const DEFAULT_DRAW_DISTANCE_MAX: f64 = ${compiler.DEFAULT_DRAW_DISTANCE_MAX.toFixed(1)};
pub const DEFAULT_DRAW_DISTANCE_PER_INSTANCE: bool = ${compiler.DEFAULT_DRAW_DISTANCE_PER_INSTANCE};
pub const OBJECT_SETTINGS: ${rustStrings(compiler.OBJECT_SETTINGS)};
pub const SKINNED_INSTANCE_SETTINGS: ${rustStrings(compiler.SKINNED_INSTANCE_SETTINGS)};
pub const OBJECT_MOBILITIES: ${rustStrings(compiler.OBJECT_MOBILITIES)};
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
