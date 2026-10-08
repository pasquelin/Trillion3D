export * from './contracts/index.ts'
export * from './impostor/switch.ts'
export * from './impostor/plan.ts'
export { impostorBakedByMesh } from './impostor/switchTable.ts'
export * from './bounce/contracts.ts'
export * from './contracts/proxy.ts'
export * from './bounce/cascades.ts'
export * from './bounce/occupancy.ts'
export * from './bounce/budget.ts'
export { assertSceneProxy, decodeSceneProxy } from './scene/core/proxy.ts'
export {
  DEPTH_LAYER_BIAS_UNITS,
  MAX_DEPTH_LAYER,
  TRANSPARENT_DEPTH_LAYER,
  depthLayerUnits,
} from './lod/depthLayer.ts'
export { MANIFEST_BINARY_MAGIC, MANIFEST_BINARY_VERSION } from './manifest/binaryFormat.ts'
export {
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
  previewFirstLevel,
  previewIsWhole,
  previewLastLevel,
  previewLevelSize,
} from './manifest/binary.ts'
export { assertManifestBinary } from './manifest/binaryTypes.ts'
export { decodeManifestBinary } from './manifest/binaryDecode.ts'
export { readPagedManifest } from './manifest/paged.ts'
export { textureLevelFormat, textureLevelUrl, type TextureLevelFormat } from './texture/levelUrl.ts'
export {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_COVERAGE,
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_NAMES,
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_BLOCK_SIDE,
  PREVIEW_LAYOUT_NAMES,
  PREVIEW_LOSSLESS_FORMAT,
  type TextureBlockFormat,
  type TextureLayout,
} from './manifest/binaryFormat.ts'
export { blocksAcross, levelBlockBytes, previewBlockBytes } from './texture/previewLevels.ts'
export type {
  ManifestBinaryDescriptor,
  SlimClusterManifest,
  SlimPrimitive,
  SlimPrimitiveBinary,
} from './manifest/binaryTypes.ts'
export * from './runtime/diagnostics.ts'
export { dagWarningsDiagnostic } from './contracts/dagWarnings.ts'
export { LOD_QUALITY, lodQuality, adaptivePixelError } from './lod/policy.ts'
export type { LodQualityId } from './lod/policy.ts'
export { frameStatistics, summarize } from './runtime/stats.ts'
export * from './runtime/stageProfile.ts'
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
} from './page/integrationContracts.ts'
export type {
  PageIntegrationAnswer,
  PageIntegrationDone,
  PageIntegrationFailed,
  PageIntegrationFailureCode,
  PageIntegrationRequest,
} from './page/integrationContracts.ts'
export {
  createPageIntegrationPlan,
  planPageIntegration,
  sortPages,
} from './page/integrationPlan.ts'
export type { PageIntegrationPlan } from './page/integrationPlan.ts'
export * from './lod/oracles.ts'
export * from '../../math/src/index.ts'
export * from './runtime/path/index.ts'
export * from './world/transform-tree/index.ts'
export { SceneNode, type SceneNodeOptions } from './scene/core/node.ts'
export { SCENE_MODEL_VERSION } from './scene/core/nodeContracts.ts'
export type { SceneState } from './scene/core/nodeContracts.ts'
export { SceneRoot, createSceneRoot } from './scene/core/root.ts'
export type { AlphaMode, LinearRgb, Material, Side } from './contracts/material.ts'
export type { SoftBodyType } from './physics/soft.ts'
export type { Texture, TextureColorSpace, TextureFilter, WrapMode } from './texture/contract.ts'
export * from './scene/core/tableSurfaces.ts'
export type { TablePage, TableSlot } from './scene/core/tablePages.ts'
export { compareImages } from './runtime/compareImages.ts'

/** The pending operation must support abort through its owner (RAF, readback, etc.). */
export { createJob } from './runtime/jobs/jobs.ts'
export type { JobStatus, JobProgress, JobSnapshot } from './runtime/jobs/jobs.ts'
export { createSafetyPolicy } from './runtime/safety/safety.ts'
export type {
  CapabilityTier,
  SafetyDecision,
  MeasuredCosts,
  SafetyConfig,
} from './runtime/safety/safety.ts'
export { userNotice } from './runtime/events.ts'
export type { RuntimeEvent, UserNotice } from './runtime/events.ts'
export {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  LIGHT_KIND,
  SCENE_LIGHT_VERSION,
} from './scene/light/contracts.ts'
export { cloneSceneLight } from './scene/light/clone.ts'
export {
  SCENE_ENVIRONMENT_FLOATS,
  TONE_MAPPING_RANK,
  addHemisphereIrradiance,
  addIrradianceCoefficients,
  addUniformIrradiance,
  emptyIrradiance,
} from './scene/core/environment.ts'
export type { SceneToneMapping } from './scene/core/environment.ts'
export type { SceneExponentialFog, SceneFog, SceneLinearFog } from './scene/core/fog.ts'
export type {
  SceneEnvironment,
  SceneLight,
  SceneLightingView,
  ShadowViewpoint,
} from './scene/light/contracts.ts'
export type { LightingCapabilities } from './scene/light/capabilities.ts'
export { validateSceneLight } from './scene/light/validate.ts'
export { validateSceneEnvironment } from './scene/core/environment.ts'
export { LIGHT_FIELD, createSceneLightStore } from './scene/light/store.ts'
export type { SceneLightStore } from './scene/light/store.ts'
export { SHADOW_PAGE } from './scene/light-shadow/sunEntries.ts'
export type { Counts } from './manifest/binaryLayout.ts'
export type { SlimCulling, SlimStreams, SlimStructure } from './manifest/binaryTypes.ts'
export type { WorldRoots, WorldRootsBundle, WorldRootsPage } from './manifest/worldRoots.ts'
export * from './llm/index.ts'
