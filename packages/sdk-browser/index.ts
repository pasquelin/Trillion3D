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
export { gpuPassBlockOf, gpuPassBlockTotals, gpuPassStageOf } from './gpuPassBlocks.ts';
export type { GpuPassBlock, GpuPassBlockTotals } from './gpuPassBlocks.ts';
export { createDiagnosticChannel } from './diagnosticChannel.ts';
export type {
  DiagnosticChannel,
  DiagnosticChannelOptions,
  DiagnosticObserver,
} from './diagnosticChannel.ts';
export type { SurfaceBuffer, SurfaceCapture } from './surfaceBuffer.ts';
export type { LightingCapabilities } from '../sdk-core/index.ts';
export { framingFromBounds } from './framing.ts';
export { presentationColorDiagnostic } from './presentationDiagnostic.ts';
export { referenceBackend } from './referenceBackend.ts';
export { exactPagesBackend } from './exactPagesBackend.ts';
export { DEFAULT_BACKENDS } from './defaultBackends.ts';
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
