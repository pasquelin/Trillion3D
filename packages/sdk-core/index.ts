export * from './contracts.ts';
export * from './bounceContracts.ts';
export * from './proxyContracts.ts';
export * from './bounceCascades.ts';
export * from './bounceOccupancy.ts';
export * from './bounceBudget.ts';
export { assertSceneProxy, decodeSceneProxy } from './sceneProxy.ts';
export {
  DEPTH_LAYER_BIAS_UNITS,
  MAX_DEPTH_LAYER,
  depthLayerUnits,
  biasedDepthBits,
} from './depthLayer.ts';
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
} from './manifestBinary.ts';
export { textureLevelUrl } from './textureLevelUrl.ts';
export {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_NAMES,
} from './manifestBinaryFormat.ts';
export type {
  ManifestBinaryDescriptor,
  SlimClusterManifest,
  SlimPrimitive,
  SlimPrimitiveBinary,
} from './manifestBinary.ts';
export * from './diagnostics.ts';
export { dagWarningsDiagnostic } from './dagWarnings.ts';
export type { PrimitiveDagWarning } from './dagWarnings.ts';
export { LOD_QUALITY, lodQuality, adaptivePixelError } from './lodPolicy.ts';
export type { LodQualityId } from './lodPolicy.ts';
export * from './competitors.ts';
export * from './paths.ts';
export * from './stats.ts';
export * from './stageProfile.ts';
export {
  PAGE_DECODE_FAILURES,
  PAGE_DECODE_PROTOCOL,
  pageDecodeFailureCode,
  pageDecodeWorkerCount,
} from './pageDecodeContracts.ts';
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
} from './pageIntegrationContracts.ts';
export type {
  PageIntegrationAnswer,
  PageIntegrationDone,
  PageIntegrationFailed,
  PageIntegrationFailureCode,
  PageIntegrationRequest,
} from './pageIntegrationContracts.ts';
export {
  createPageIntegrationPlan,
  planPageIntegration,
  sortPages,
} from './pageIntegrationPlan.ts';
export type { PageIntegrationPlan } from './pageIntegrationPlan.ts';
export type {
  PageDecodeAnswer,
  PageDecodeCancel,
  PageDecodeDone,
  PageDecodeFailed,
  PageDecodeFailureCode,
  PageDecodeGeometryPayload,
  PageDecodeOp,
  PageDecodeRequest,
  PageDecodeShare,
} from './pageDecodeContracts.ts';
export * from './oracles.ts';
export * from './mathIndex.ts';
export { SCENE_MODEL_VERSION, SceneNode, type SceneNodeOptions } from './sceneNode.ts';
export type { SceneState } from './sceneNodeContracts.ts';
export { SceneRoot, createSceneRoot } from './sceneRoot.ts';
export { compareImages } from './compareImages.ts';

/** The pending operation must support abort through its owner (RAF, readback, etc.). */
export { createJob } from './jobs.ts';
export type { JobStatus, JobProgress, JobSnapshot } from './jobs.ts';
export { createSafetyPolicy } from './safety.ts';
export type { CapabilityTier, SafetyDecision, MeasuredCosts, SafetyConfig } from './safety.ts';
export { userNotice } from './events.ts';
export type { RuntimeEvent, UserNotice } from './events.ts';
export {
  createLightingScene,
  exportLightingGltf,
  createDefaultLightingSceneLights,
} from './lightingExperimentScene.ts';
export type { Vec3, Surface, Patch, Scene, LightingSceneLight } from './lightingExperimentScene.ts';
export { createTransport, solveTransportOracle } from './lightingTransport.ts';
export type {
  TransportOptions,
  TransportProgress,
  TransportResult,
  TransportSnapshot,
} from './lightingTransportContracts.ts';
export {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  SCENE_LIGHT_BUFFER_FLOATS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  LIGHT_KIND,
  SCENE_LIGHT_VERSION,
} from './sceneLightContracts.ts';
export type {
  SceneEnvironment,
  SceneLight,
  SceneLightingView,
  ShadowViewpoint,
} from './sceneLightContracts.ts';
export type { LightingCapabilities } from './sceneLightCapabilities.ts';
export { validateSceneEnvironment, validateSceneLight } from './sceneLightValidate.ts';
export { LIGHT_FIELD, createSceneLightStore } from './sceneLightStore.ts';
export type { SceneLightStore } from './sceneLightStore.ts';
export {
  POINT_FACE_AXES,
  SHADOW_CULL_FLOATS,
  SHADOW_FACE_FLOATS,
  SHADOW_SLICE_FLOATS,
  faceCountOf,
  writeFace,
} from './sceneLightShadowFaces.ts';
export { SHADOW_FACE_SIDES, desiredFaceSide } from './sceneLightShadowAtlas.ts';
export { RECTS_PER_SLICE, createShadowPlan } from './sceneLightShadowPlan.ts';
export type { ShadowPlan } from './sceneLightShadowPlan.ts';
export { SHADOW_PAGE, pageRowsOf } from './sceneLightShadowPages.ts';
export { regionRect } from './sceneLightShadowVolume.ts';
export type { NumberSink } from './mathMatrix4.ts';
export type { Counts } from './manifestBinaryLayout.ts';
export type { SlimCulling, SlimStreams, SlimStructure } from './manifestBinaryTypes.ts';
export * from './llm/index.ts';
