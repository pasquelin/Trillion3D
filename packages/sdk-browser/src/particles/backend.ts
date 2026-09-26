import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';

/** The pass label the GPU timings name the particle step by (`passesGpu`). */
export const PARTICLES_PASS = 'Trillion3D particles';

/**
 * What each renderer does with the world's pools, once per image, behind the same pool
 * (`sdk-core/src/fluids/particles.ts`): `run` takes each pool's step, uploads its staged records
 * and moves every live particle on the GPU, making the pool's state the first time it sees it;
 * it returns the dispatches or draws it encoded. `dispose` frees every pool's state.
 */
export interface ParticleBackend<Frame> {
  run(pools: readonly ParticlePool[], frame: Frame): number;
  dispose(): void;
}
