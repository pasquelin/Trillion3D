export * from './contracts/index.ts';
export * from './bounce/contracts.ts';
export * from './contracts/proxy.ts';
export * from './bounce/cascades.ts';
export * from './bounce/occupancy.ts';
export * from './bounce/budget.ts';
export { assertSceneProxy, decodeSceneProxy } from './scene/core/proxy.ts';
export {
  DEPTH_LAYER_BIAS_UNITS,
  MAX_DEPTH_LAYER,
  depthLayerUnits,
  biasedDepthBits,
} from './lod/depthLayer.ts';
export {
  MANIFEST_BINARY_MAGIC,
  MANIFEST_BINARY_VERSION,
  PREVIEW_BASE,
  PREVIEW_MAX_LEVELS,
  TEXTURE_PREVIEW_VERSION,
  assertManifestBinary,
  decodeManifestBinary,
  decodeManifestPreviews,
  encodeManifestBinary,
  isBinaryManifest,
  manifestBinaryRanges,
  previewFirstLevel,
  previewIsWhole,
  previewLastLevel,
  previewLevelCount,
  previewLevelSize,
  previewPixelBytes,
} from './manifest/binary.ts';
export {
  textureLevelFormat,
  textureLevelUrl,
  type TextureLevelFormat,
} from './texture/levelUrl.ts';
export {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_NAMES,
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_BLOCK_SIDE,
  PREVIEW_LAYOUT_NAMES,
  PREVIEW_LOSSLESS_FORMAT,
  type TextureBlockFormat,
  type TextureLayout,
} from './manifest/binaryFormat.ts';
export { blocksAcross, levelBlockBytes, previewBlockBytes } from './texture/previewLevels.ts';
export type {
  ManifestBinaryDescriptor,
  SlimClusterManifest,
  SlimPrimitive,
  SlimPrimitiveBinary,
} from './manifest/binary.ts';
export * from './runtime/diagnostics.ts';
export { dagWarningsDiagnostic } from './contracts/dagWarnings.ts';
export type { PrimitiveDagStall, PrimitiveDagWarning } from './contracts/dagWarnings.ts';
export { LOD_QUALITY, lodQuality, adaptivePixelError } from './lod/policy.ts';
export type { LodQualityId } from './lod/policy.ts';
export * from './runtime/competitors.ts';
export * from './runtime/paths.ts';
export * from './runtime/stats.ts';
export * from './runtime/stageProfile.ts';
export * from './page/decodeContracts.ts';
export {
  PAGE_INTEGRATION_FAILURES,
  PAGE_INTEGRATION_PROTOCOL,
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_PAGE_INDEX,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from './page/integrationContracts.ts';
export type {
  PageIntegrationAnswer,
  PageIntegrationDone,
  PageIntegrationFailed,
  PageIntegrationFailureCode,
  PageIntegrationRequest,
} from './page/integrationContracts.ts';
export {
  createPageIntegrationPlan,
  planPageIntegration,
  sortPages,
} from './page/integrationPlan.ts';
export type { PageIntegrationPlan } from './page/integrationPlan.ts';
export * from './math/oracles.ts';
export * from './math/index.ts';
export { SCENE_MODEL_VERSION, SceneNode, type SceneNodeOptions } from './scene/core/node.ts';
export type { SceneState } from './scene/core/nodeContracts.ts';
export { SceneRoot, createSceneRoot } from './scene/core/root.ts';
export type { AlphaMode, LinearRgb, Material, Side } from './contracts/material.ts';
export type { Texture, TextureColorSpace, TextureFilter, WrapMode } from './texture/contract.ts';
export {
  MATERIAL_TABLE_VERSION,
  NODE_TABLE_VERSION,
  SCENE_TABLES_FILE,
  SCENE_TABLES_VERSION,
  TABLE_FLAGS,
  TABLE_NUMBERS,
  TABLE_SLOTS,
  TABLE_TRIPLETS,
  assertSceneTables,
  type PreparedSceneTables,
  type TableMaterial,
  type TableNode,
  type TableTexture,
  type TableTextureSlot,
} from './scene/core/tableContracts.ts';
export { compareImages } from './runtime/compareImages.ts';

/** The pending operation must support abort through its owner (RAF, readback, etc.). */
export { createJob } from './runtime/jobs.ts';
export type { JobStatus, JobProgress, JobSnapshot } from './runtime/jobs.ts';
export { createSafetyPolicy } from './runtime/safety.ts';
export type {
  CapabilityTier,
  SafetyDecision,
  MeasuredCosts,
  SafetyConfig,
} from './runtime/safety.ts';
export { userNotice } from './runtime/events.ts';
export type { RuntimeEvent, UserNotice } from './runtime/events.ts';
export {
  createLightingScene,
  exportLightingGltf,
  createDefaultLightingSceneLights,
} from './lighting/scene/experimentScene.ts';
export type {
  Vec3,
  Surface,
  Patch,
  Scene,
  LightingSceneLight,
} from './lighting/scene/experimentScene.ts';
export { createTransport, solveTransportOracle } from './lighting/transport/transport.ts';
export type {
  TransportOptions,
  TransportProgress,
  TransportResult,
  TransportSnapshot,
} from './lighting/transport/contracts.ts';
export {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  SCENE_LIGHT_BUFFER_FLOATS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  LIGHT_KIND,
  SCENE_LIGHT_VERSION,
} from './scene/light/contracts.ts';
export { cloneSceneLight } from './scene/light/clone.ts';
export {
  SCENE_ENVIRONMENT_FLOATS,
  TONE_MAPPING_RANK,
  addHemisphereIrradiance,
  addIrradianceCoefficients,
  addUniformIrradiance,
  emptyIrradiance,
  environmentLights,
} from './scene/core/environment.ts';
export type { SceneToneMapping } from './scene/core/environment.ts';
export type {
  SceneEnvironment,
  SceneLight,
  SceneLightingView,
  ShadowViewpoint,
} from './scene/light/contracts.ts';
export type { LightingCapabilities } from './scene/light/capabilities.ts';
export { validateSceneEnvironment, validateSceneLight } from './scene/light/validate.ts';
export { LIGHT_FIELD, createSceneLightStore } from './scene/light/store.ts';
export type { SceneLightStore } from './scene/light/store.ts';
export {
  POINT_FACE_AXES,
  SHADOW_CULL_FLOATS,
  SHADOW_FACE_FLOATS,
  SHADOW_FACE_MASK_WORD,
  SHADOW_SLICE_FLOATS,
  faceCountOf,
  writeFace,
} from './scene/light-shadow/faces.ts';
export { SHADOW_FACE_SIDES, desiredFaceSide } from './scene/light-shadow/atlas.ts';
export { RECTS_PER_SLICE, createShadowPlan } from './scene/light-shadow/plan.ts';
export type { ShadowPlan } from './scene/light-shadow/plan.ts';
export { SHADOW_PAGE, pageRowsOf } from './scene/light-shadow/pages.ts';
export { forEachShadowFace } from './scene/light-shadow/casters.ts';
export { openPlanes, shadowCasterPlanes } from './scene/light-shadow/casterPlanes.ts';
export { regionRect } from './scene/light-shadow/volume.ts';
export type { NumberSink } from './math/matrix/matrix4.ts';
export type { Counts } from './manifest/binaryLayout.ts';
export type { SlimCulling, SlimStreams, SlimStructure } from './manifest/binaryTypes.ts';
export * from './llm/index.ts';
