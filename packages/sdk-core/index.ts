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
  depthLayerBias,
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
  encodeManifestBinary,
  isBinaryManifest,
  manifestBinaryRanges,
  previewFirstLevel,
  previewLastLevel,
  previewLevelCount,
  previewLevelSize,
  previewPixelBytes,
} from './manifestBinary.ts';
export type {
  ManifestBinaryDescriptor,
  SlimClusterManifest,
  SlimPrimitive,
  SlimPrimitiveBinary,
} from './manifestBinary.ts';
export * from './diagnostics.ts';
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
export type {
  PageDecodeAnswer,
  PageDecodeCancel,
  PageDecodeDone,
  PageDecodeFailed,
  PageDecodeFailureCode,
  PageDecodeGeometryPayload,
  PageDecodeOp,
  PageDecodeRequest,
} from './pageDecodeContracts.ts';
export * from './oracles.ts';
export { determinantMatrix4, linearPartDeterminant, multiplyMatrix4 } from './mathMatrix4.ts';
export { invertMatrix4 } from './mathMatrix4Inverse.ts';
export { composeMatrix4, decomposeMatrix4 } from './mathMatrix4Trs.ts';
export { normalMatrix3 } from './mathMatrix3.ts';
export {
  crossVector3,
  dotVector3,
  transformAffinePoint,
  transformHomogeneousPoint,
} from './mathVector.ts';
export { hslToLinearRgb, linearToSrgb, srgbToLinear } from './mathColor.ts';
export {
  BOX_VALUES,
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from './mathBox.ts';
export { sphereFromBounds } from './mathSphere.ts';
export {
  FRUSTUM_PLANE_VALUES,
  clipPlanesFromMatrix,
  frustumPlanesFromMatrix,
  frustumPlanesToLocal,
} from './mathFrustum.ts';
export { frustumClipBox, frustumExcludesBox } from './mathFrustumBox.ts';
export { boxConeRejects } from './mathCone.ts';
export {
  addTransformNode,
  createTransformTree,
  setNodeAutoUpdate,
  setNodeLocalMatrix,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  type TransformTree,
} from './mathTransformTree.ts';
export { removeTransformNode, reparentTransformNode } from './mathTransformTreeStructure.ts';
export { updateNodeMatrixWorld, updateNodeWorldMatrix } from './mathTransformTreeUpdate.ts';
export {
  nodeWorldDirection,
  nodeWorldMirrorsFaces,
  nodeWorldPosition,
  nodeWorldQuaternion,
  nodeWorldScale,
} from './mathTransformTreeRead.ts';
export { lookAtNode } from './mathTransformTreeLookAt.ts';
export {
  createCameraFrame,
  perspectiveProjection,
  updateCameraFrame,
  type CameraFrame,
} from './mathCamera.ts';
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
