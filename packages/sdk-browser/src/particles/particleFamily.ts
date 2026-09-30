import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { families } from '../host/families.ts';
import { refuseAll } from './poolStates.ts';

/** The particles' code for `pools` (`particleCode.ts`), which the frame that draws them waited for
 *  (`../host/families.ts`); a refused import refuses them, `refused` hearing why once. */
export function particleCodeFor(pools: readonly ParticlePool[], refused: (error: Error) => void) {
  const particles = families.particles,
    code = particles.get();
  if (particles.failed && refuseAll(pools)) refused(particles.failed);
  return code;
}

/** The WebGL2 step of `pools` (`webglParticles.ts`); a refused import is told as a context that
 *  cannot step them tells it. */
export function webglParticleStep(
  gl: WebGL2RenderingContext,
  pools: readonly ParticlePool[],
  refused: (reason: string) => void = () => {},
) {
  const failed = (error: Error) => refused(`PARTICLES_UNAVAILABLE: ${error.message}`);
  return particleCodeFor(pools, failed)?.createWebglParticles(gl, refused);
}
