import { families } from '../host/families.ts';

/** The particles' code (`particleCode.ts`), which the frame that draws them waited for
 *  (`../host/families.ts`): a refused import is `FAMILY_LOAD_FAILED`, and the frame waits on. */
export const particleCode = () => families.particles.get();

/** The WebGL2 step of the pools (`webglParticles.ts`), `refused` hearing a context that cannot
 *  step them. */
export const webglParticleStep = (
  gl: WebGL2RenderingContext,
  refused: (reason: string) => void = () => {},
) => particleCode()?.createWebglParticles(gl, refused);
