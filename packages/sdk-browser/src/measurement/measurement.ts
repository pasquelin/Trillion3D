/**
 * THE MEASUREMENT SEAM. What the bench, the proofs and the comparison views name and a host
 * never does: the engine's own paths, and the session that takes an explicit list of backends —
 * beside everything the published entry exports. The published entry (`../index.ts`) draws with
 * one code and lets the engine choose the path; this one lets a caller hand the session any
 * `BackendFactory` it likes. The witnesses the engine is compared against are such factories, and
 * they live beside the bench, not here: `bench/witnesses/measurement.ts` re-exports this entry
 * with them added. Nothing reached from this file imports the host library.
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
