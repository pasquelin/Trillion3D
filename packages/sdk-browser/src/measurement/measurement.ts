/**
 * THE MEASUREMENT SEAM. What the bench and the proofs name and a host never does: the engine's
 * own factory and the session it is handed to (`engine`), beside everything the published entry
 * exports. The published entry (`../index.ts`) loads the engine's renderer as a family; this one
 * hands the session the factory itself, or a stand-in. Nothing reached from this file imports the
 * witness library.
 */
export * from '../index.ts'
import { openMeasuredWorld } from '../world/session/explorer.ts'
import type { MeasuredWorldTarget } from '../world/session/target.ts'
import type { MeasuredWorldOptions } from '../engine/types.ts'

export { openMeasuredWorld } from '../world/session/explorer.ts'
export type { MeasuredWorld } from '../world/session/explorer.ts'
export type { MeasuredWorldTarget } from '../world/session/target.ts'
export type { Engine, EngineFactory, MeasuredWorldOptions } from '../engine/types.ts'
export { replicateInstances } from '../scene/replicateInstances.ts'
export { webgpuPagesEngine } from '../webgpu/pages/pages.ts'
export { attachParticles } from '../world/core/worldSession.ts'
// The screen-error measure reads a drawn mesh's side the way the engine does (`bench/runner`).
export { sideOf } from '../scene/materialSide.ts'
export { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts'

/** Browser job adapter. A completed session is owned by the caller; cancel/fail after construct disposes it. */
export async function createMeasuredWorldJob(
  id: string,
  target: MeasuredWorldTarget,
  options: MeasuredWorldOptions,
) {
  const { createJob } = await import('../../../sdk-core/src/index.ts')
  return createJob(
    id,
    ({ signal, progress }) =>
      openMeasuredWorld(target, {
        ...options,
        signal,
        onPreparation: (event) => progress({ ...event }),
      }),
    { signal: options.signal },
  )
}
