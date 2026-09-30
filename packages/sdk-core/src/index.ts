export * from './contracts/index.ts';
export * from './impostor/switch.ts';
export * from './impostor/octahedron.ts';
export * from './impostor/plan.ts';
export * from './bounce/contracts.ts';
export * from './contracts/proxy.ts';
export * from './bounce/cascades.ts';
export * from './bounce/occupancy.ts';
export * from './bounce/budget.ts';
export { assertSceneProxy, decodeSceneProxy } from './scene/core/proxy.ts';
export { MAX_DEPTH_LAYER, depthLayerUnits } from './lod/depthLayer.ts';
export {
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
  previewFirstLevel,
  previewIsWhole,
  previewLastLevel,
  previewLevelSize,
} from './manifest/binary.ts';
export { readPagedManifest } from './manifest/paged.ts';
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
  PREVIEW_BLOCK_BYTES,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_BLOCK_SIDE,
  PREVIEW_LAYOUT_NAMES,
  PREVIEW_LOSSLESS_FORMAT,
  type TextureBlockFormat,
  type TextureLayout,
} from './manifest/binaryFormat.ts';
export { blocksAcross, levelBlockBytes } from './texture/previewLevels.ts';
export * from './runtime/diagnostics.ts';
export { dagWarningsDiagnostic } from './contracts/dagWarnings.ts';
export { LOD_QUALITY, adaptivePixelError } from './lod/policy.ts';
export * from './runtime/paths.ts';
export * from './runtime/stats.ts';
export * from './runtime/stageProfile.ts';
export * from './page/decodeContracts.ts';
export {
  PAGE_INTEGRATION_PROTOCOL,
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from './page/integrationContracts.ts';
export type { PageIntegrationAnswer, PageIntegrationRequest } from './page/integrationContracts.ts';
export {
  createPageIntegrationPlan,
  planPageIntegration,
  sortPages,
} from './page/integrationPlan.ts';
export type { PageIntegrationPlan } from './page/integrationPlan.ts';
export * from './math/oracles.ts';
export * from './math/index.ts';
export type { Material, Side } from './contracts/material.ts';
export type { Texture, TextureFilter, WrapMode } from './texture/contract.ts';
export * from './scene/core/tableSurfaces.ts';
export { compareImages } from './runtime/compareImages.ts';

/** The pending operation must support abort through its owner (RAF, readback, etc.). */
export { createJob } from './runtime/jobs.ts';
export type { JobStatus, JobProgress, JobSnapshot } from './runtime/jobs.ts';
export type { RuntimeEvent } from './runtime/events.ts';
export {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  LIGHT_KIND,
} from './scene/light/contracts.ts';
export { cloneSceneLight } from './scene/light/clone.ts';
export {
  SCENE_ENVIRONMENT_FLOATS,
  TONE_MAPPING_RANK,
  emptyIrradiance,
} from './scene/core/environment.ts';
export type { SceneToneMapping } from './scene/core/environment.ts';
export type { SceneFog } from './scene/core/fog.ts';
export type {
  SceneEnvironment,
  SceneLight,
  SceneLightingView,
  ShadowViewpoint,
} from './scene/light/contracts.ts';
export type { LightingCapabilities } from './scene/light/capabilities.ts';
export { validateSceneLight } from './scene/light/validate.ts';
export { createSceneLightStore } from './scene/light/store.ts';
export type { SceneLightStore } from './scene/light/store.ts';
export { SHADOW_CULL_FLOATS, SHADOW_RECORD_FLOATS, writeFace } from './scene/light-shadow/faces.ts';
export { createShadowPlan } from './scene/light-shadow/plan.ts';
export type { ShadowPlan } from './scene/light-shadow/plan.ts';
export type { NumberSink } from './math/matrix/matrix4.ts';
export * from './llm/index.ts';
