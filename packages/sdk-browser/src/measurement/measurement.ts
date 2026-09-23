/**
 * THE MEASUREMENT ENTRY. What the bench, the proofs and the comparison views name and a host
 * never does: the engine paths and the witnesses they are compared against, and the session
 * that takes an explicit list of them — beside everything the published entry exports. The
 * published entry (`../index.ts`) draws with one code and lets the engine choose the path; this one
 * exists so the witnesses stay nameable for the campaigns without being handed to every page.
 */
export * from '../index.ts';
import { openMeasuredWorld } from '../world/session/explorer.ts';
import type { MeasuredWorldTarget } from '../world/session/target.ts';
import type { MeasuredWorldOptions } from '../backend/types.ts';

export { openMeasuredWorld } from '../world/session/explorer.ts';
export type { MeasuredWorld } from '../world/session/explorer.ts';
export type { MeasuredWorldTarget } from '../world/session/target.ts';
export type { RenderBackend, BackendFactory, MeasuredWorldOptions } from '../backend/types.ts';
export { replicateInstances } from '../scene/replicateInstances.ts';
export { autonomousPagesBackend } from '../backend/autonomous/pages.ts';
export { referenceBackend } from '../backend/referenceBackend.ts';
export { exactPagesBackend } from '../backend/exact/backend.ts';
export { threeLodBackend } from '../host/three/lod.ts';
export { webgpuPagesBackend } from '../webgpu/pages/pages.ts';

/** Browser job adapter. A completed session is owned by the caller; cancel/fail after construct disposes it. */
export async function createMeasuredWorldJob(
  id: string,
  target: MeasuredWorldTarget,
  options: MeasuredWorldOptions,
) {
  const { createJob } = await import('../../../sdk-core/src/index.ts');
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
