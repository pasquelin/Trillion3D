export * from './contracts.ts';
export * from './bounceContracts.ts';
export * from './proxyContracts.ts';
export { probeCellsOf } from './probeCells.ts';
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
export function compareImages(a: Uint8Array, b: Uint8Array) {
  if (!a.length || a.length !== b.length || a.length % 4 !== 0)
    throw new Error('Invalid RGBA images');
  let differentPixels = 0,
    maxChannelError = 0,
    squared = 0;
  const isAlignedA = (a.byteOffset & 3) === 0;
  const isAlignedB = (b.byteOffset & 3) === 0;
  if (isAlignedA && isAlignedB) {
    const u32A = new Uint32Array(a.buffer, a.byteOffset, a.length >>> 2);
    const u32B = new Uint32Array(b.buffer, b.byteOffset, b.length >>> 2);
    const pixelCount = u32A.length;
    for (let p = 0; p < pixelCount; p++) {
      if (u32A[p] !== u32B[p]) {
        differentPixels++;
        const i = p << 2;
        const d0 = Math.abs(a[i] - b[i]);
        const d1 = Math.abs(a[i + 1] - b[i + 1]);
        const d2 = Math.abs(a[i + 2] - b[i + 2]);
        const d3 = Math.abs(a[i + 3] - b[i + 3]);
        squared += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
        const m01 = d0 > d1 ? d0 : d1;
        const m23 = d2 > d3 ? d2 : d3;
        const m = m01 > m23 ? m01 : m23;
        if (m > maxChannelError) maxChannelError = m;
      }
    }
  } else {
    for (let i = 0; i < a.length; i += 4) {
      let different = false;
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(a[i + c] - b[i + c]);
        squared += delta * delta;
        if (delta > maxChannelError) maxChannelError = delta;
        different ||= delta !== 0;
      }
      if (different) differentPixels++;
    }
  }
  return { differentPixels, maxChannelError, rmse: Math.sqrt(squared / a.length) };
}

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
