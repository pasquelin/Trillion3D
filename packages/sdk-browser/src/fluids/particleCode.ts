import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { onDemand } from '../host/onDemand.ts';
import { refuseAll } from '../particles/poolStates.ts';

/** The fluids' code (`fluidCode.ts`), imported on the first pool a world draws: a page without
 *  particles nor transmissive surface downloads none of it (`host/onDemand.ts`, #1353). */
export const fluidCode = onDemand(() => import('./fluidCode.ts'));

/**
 * The WebGL2 step of `pools` once its code has arrived, else `undefined`: until then what they
 * stage waits. A refused import refuses them, `refused` hearing why once, as a context that
 * cannot step them does (`webglParticles.ts`).
 */
export function webglParticleStep(
  gl: WebGL2RenderingContext,
  pools: readonly ParticlePool[],
  refused: (reason: string) => void = () => {},
) {
  const failed = fluidCode.failed;
  if (failed && refuseAll(pools)) refused(`PARTICLES_UNAVAILABLE: ${failed.message}`);
  return fluidCode.get()?.createWebglParticles(gl, refused);
}
