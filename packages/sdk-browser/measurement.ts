/**
 * THE MEASUREMENT ENTRY. What the bench, the proofs and the comparison views name and a host
 * never does: the engine paths and the witnesses they are compared against, and the session
 * that takes an explicit list of them — beside everything the published entry exports. The published entry (`index.ts`) draws with one code and
 * lets the engine choose the path; this one exists so the witnesses stay nameable for the
 * campaigns without being handed to every page.
 */
export * from './index.ts';
import { openMeasuredWorld } from './explorer.ts';
import type { MeasuredWorldTarget } from './explorerTarget.ts';
import type { MeasuredWorldOptions } from './backendTypes.ts';

export { openMeasuredWorld } from './explorer.ts';
export type { MeasuredWorld } from './explorer.ts';
export type { MeasuredWorldTarget } from './explorerTarget.ts';
export type {
  RenderBackend,
  BackendContext,
  BackendFactory,
  MeasuredWorldOptions,
} from './backendTypes.ts';
export { replicateInstances } from './replicateInstances.ts';
export { runCameraPath } from './cameraPath.ts';
export { autonomousPagesBackend } from './autonomousPages.ts';
export { referenceBackend } from './referenceBackend.ts';
export { exactPagesBackend } from './exactPagesBackend.ts';
export { threeLodBackend } from './threeLod.ts';
export { webgpuPagesBackend } from './webgpuPages.ts';
export { autonomousCacheReady, chooseBackends } from './defaultBackends.ts';
export type { BackendChoice } from './defaultBackends.ts';
export { createLightingExperimentBackend } from './lightingExperimentBackend.ts';
export type {
  LightingExperimentRenderState,
  LightingExperimentRayDiagnostics,
} from './lightingExperimentBackend.ts';

/** Browser job adapter. A completed session is owned by the caller; cancel/fail after construct disposes it. */
export async function createMeasuredWorldJob(
  id: string,
  target: MeasuredWorldTarget,
  options: MeasuredWorldOptions,
) {
  const { createJob } = await import('../sdk-core/index.ts');
  return createJob(
    id,
    ({ signal, progress }) =>
      openMeasuredWorld(target, {
        ...options,
        signal,
        onPreparation: (event) => progress({ ...event }),
      }),
    { signal: options.signal },
  );
}
