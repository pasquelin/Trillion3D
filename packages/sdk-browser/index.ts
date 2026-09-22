import { createExplorer } from './explorer.ts';
import type { ExplorerTarget } from './explorerTarget.ts';
export type { ExplorerTarget } from './explorerTarget.ts';
import type { ExplorerOptions } from './backendTypes.ts';

export { replicateInstances } from './replicateInstances.ts';
export { autonomousPagesBackend } from './autonomousPages.ts';
export { EngineProfiler, type TelemetryReport } from './telemetry.ts';

export type {
  AssetScope,
  CameraPose,
  StablePreview,
  FrameMetrics,
  ClusterManifest,
} from '../sdk-core/index.ts';
export type {
  RenderBackend,
  BackendContext,
  BackendFactory,
  BackendDiagnostic,
  ExplorerOptions,
  PointOfInterest,
} from './backendTypes.ts';
export type { DiagnosticDetail } from './backendTypes.ts';
/** Host resources the engine reads and never builds (`hostResources.ts`): a host declares them
 *  with whatever library it draws with, the contract names only their shape. */
export type {
  HostAttribute,
  HostAttributes,
  HostColour,
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
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
export type { MultiplyLot } from './mathBatchRuntime.ts';
export type { LightingCapabilities } from '../sdk-core/index.ts';
export { framingFromBounds } from './framing.ts';
export { presentationColorDiagnostic } from './presentationDiagnostic.ts';
export { referenceBackend } from './referenceBackend.ts';
export { exactPagesBackend } from './exactPagesBackend.ts';
export { autonomousCacheReady, chooseBackends } from './defaultBackends.ts';
export type { BackendChoice } from './defaultBackends.ts';
export { createExplorer } from './explorer.ts';
export type { Explorer } from './explorer.ts';
export { runCameraPath } from './cameraPath.ts';
export { createGpuPageCache, httpPageSource } from './gpuPages.ts';
export type { ResidentPage } from './gpuPages.ts';
export { threeLodBackend } from './threeLod.ts';
export { webgpuPagesBackend } from './webgpuPages.ts';
export { createPageStreamer } from './streamingPages.ts';
export type { ComparisonLayout } from './comparison.ts';
export { COMPARISON_LIBRARIES, LOD_QUALITY } from '../sdk-core/index.ts';
/** Public browser job adapter. A completed explorer is owned by the caller; cancel/fail after construct disposes it. */
export async function createExplorerJob(
  id: string,
  target: ExplorerTarget,
  options: ExplorerOptions,
) {
  const { createJob } = await import('../sdk-core/index.ts');
  return createJob(
    id,
    ({ signal, progress }) =>
      createExplorer(target, {
        ...options,
        signal,
        onPreparation: (event) => progress({ ...event }),
      }),
    { signal: options.signal },
  );
}

export { detectCapabilities } from './capabilities.ts';
export { createLightingExperimentBackend } from './lightingExperimentBackend.ts';
export type {
  LightingExperimentRenderState,
  LightingExperimentRayDiagnostics,
} from './lightingExperimentBackend.ts';

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
