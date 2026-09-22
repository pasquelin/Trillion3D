// The world and its families: what a page writes (issue #319). One barrel per family folder.
export * from './world/core/index.ts';
export * from '../sdk-core/world/math/index.ts';
export * from '../sdk-core/world/geometry/index.ts';
export * from '../sdk-core/world/buffer/index.ts';
export * from '../sdk-core/world/object/index.ts';
export * from '../sdk-core/world/material/index.ts';
export * from '../sdk-core/world/light/index.ts';
export * from '../sdk-core/world/camera/index.ts';
export * from '../sdk-core/world/animation/index.ts';
export * from '../sdk-core/world/constants/index.ts';
export * from './world/texture/index.ts';
export * from './world/loader/index.ts';
export * from './world/helper/index.ts';
export * from './world/page/index.ts';
export * from './world/budget/index.ts';
export * from './world/metric/index.ts';
export * from './world/diagnostic/index.ts';
export * from './world/capability/index.ts';
export * from './world/capture/index.ts';
export * from './world/pose/index.ts';
export * from './world/batch/index.ts';

export { EngineProfiler, type TelemetryReport } from './telemetry.ts';

export type {
  AssetScope,
  StablePreview,
  FrameMetrics,
  ClusterManifest,
} from '../sdk-core/index.ts';
export type { BackendDiagnostic, PointOfInterest } from './backendTypes.ts';
export type { DiagnosticDetail } from './backendTypes.ts';
/** Host resources the engine reads and never builds (`hostResources.ts`): a host declares them
 *  with whatever library it draws with, the contract names only their shape. */
export type {
  HostAttribute,
  HostAttributes,
  HostBox,
  HostColour,
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
  HostDisposable,
  HostGeometry,
  HostMaterial,
  HostMaterials,
  HostMesh,
  HostNode,
  HostPoint,
  HostScene,
  HostTexture,
  HostTraversable,
} from './hostResources.ts';
/** The host scene graph as the engine walks it (`hostGraphNodes.ts`): the shapes a source node,
 *  its pose and its rotation are read through. */
export type { HostGraphNode, HostRotation, HostVector } from './hostGraphNodes.ts';
export type { HostNodeMatrix, MatrixElements } from './matrixElements.ts';
export { gpuPassBlockOf, gpuPassBlockTotals, gpuPassStageOf } from './gpuPassBlocks.ts';
export type { GpuPassBlock, GpuPassBlockTotals } from './gpuPassBlocks.ts';
export { createDiagnosticChannel } from './diagnosticChannel.ts';
export type {
  DiagnosticChannel,
  DiagnosticChannelOptions,
  DiagnosticObserver,
} from './diagnosticChannel.ts';
export type { SurfaceBuffer, SurfaceCapture } from './surfaceBuffer.ts';
export type { HostDrawCamera } from './cameraWorld.ts';
export type { HostDrawOutput } from './webglRenderTarget.ts';
export type { MemoryBudgets, MemoryBudgetsReport } from './webgpuPagesMemory.ts';
export type { GeometryPool, PoolClamp, TexturePool } from './webgpuMemoryBudgets.ts';
export type { ShadowAtlasDigest } from './gpuShadowDigest.ts';
export type { PartitionAudit } from './webgpuPartitionAudit.ts';
export type { TransparentOcclusionAudit } from './webgpuTransparentOcclusionAudit.ts';
export type { CpuStepSummary } from './cpuProfile.ts';
export type { ArrivalPlan } from './pageIntegrationHost.ts';
export type { DecodedGeometryPage } from './geometryPage.ts';
export type {
  TextureLevel,
  TextureLevelReader,
  TextureLevelRequest,
} from './textureLevelReader.ts';
export type { AtlasLanes, LaneCounts, TextureCompression } from './textureBlockFormats.ts';
export type { HostRetentionDelta, StreamPage } from './streamingTypes.ts';
export type { BoxTransformLot, MultiplyLot } from './mathBatchRuntime.ts';
export type { LightingCapabilities } from '../sdk-core/index.ts';
export { framingFromBounds } from './framing.ts';
export { presentationColorDiagnostic } from './presentationDiagnostic.ts';
export { createGpuPageCache, httpPageSource } from './gpuPages.ts';
export type { ResidentPage } from './gpuPages.ts';
export { createPageStreamer } from './streamingPages.ts';
export type { ComparisonLayout } from './comparison.ts';
export { COMPARISON_LIBRARIES, LOD_QUALITY } from '../sdk-core/index.ts';
export { detectCapabilities } from './capabilities.ts';
export {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  NORMAL_MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  SPHERE_VALUES,
  boxTransformBatch,
  boxTransformUnionBatch,
  boxUnionBatch,
  composeMatrix4Batch,
  decomposeMatrix4Batch,
  frustumKeepsBoxBatch,
  hierarchyUpdateBatch,
  invertMatrix4Batch,
  linearToSrgbBatch,
  multiplyMatrix4Batch,
  normalMatrix3Batch,
  sphereFromBoundsBatch,
  srgbToLinearBatch,
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from '../sdk-core/index.ts';

// The camera controllers a session hands out: their contract is public because
// `explorer.controls()` and its four siblings return it (`docs/SDK.md`, "Camera controllers").
export type { ChangeListener, ControlVector, PivotCameraControls } from './cameraControlTypes.ts';
export type { FlyCameraControls } from './cameraFlyControls.ts';
export type { FirstPersonCameraControls } from './cameraFirstPersonControls.ts';
export type { TrackballCameraControls } from './cameraTrackballControls.ts';
export type { PanZoomCameraControls } from './cameraPanZoomControls.ts';
