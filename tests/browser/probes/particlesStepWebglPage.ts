// Page side of the WebGL2 particle proof (#759): the engine's own step (`createWebglParticles`)
// on a real WebGL2 context, two images of a pool ten kilometres from the world origin. Only this
// page reads the state back, from the target each image drew into.
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts';
import { createWebglParticles } from '../../../packages/sdk-browser/src/particles/webglParticles.ts';

const FAR = 10_000,
  DT = 1 / 64;

export function executer() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return { indisponible: 'no WebGL2 context' };
  // The target the step drew into: the one that holds the pool's state after it.
  let drawnInto: WebGLFramebuffer | null = null;
  const draw = gl.drawArrays.bind(gl);
  gl.drawArrays = (mode, first, count) => {
    drawnInto = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    draw(mode, first, count);
  };
  const particles = createWebglParticles(gl);
  const pool = new ParticlePool({ capacity: 600, emitPerFrame: 4, origin: [FAR, 0, FAR] });
  pool.emit(FAR + 0.25, 2, FAR, 0.064, 1, 0, 4); // 1 mm along x each step
  pool.emit(FAR, 3, FAR, 5, 5, 5, 0); // born dead: kept as staged, never moved
  const images = [0, 1].map(() => {
    pool.advance(DT);
    particles.run([pool]);
    const state = new Float32Array(3 * 8); // three slots, two texels each
    gl.bindFramebuffer(gl.FRAMEBUFFER, drawnInto);
    gl.readPixels(0, 0, 6, 1, gl.RGBA, gl.FLOAT, state);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return Array.from(state);
  });
  const erreur = gl.getError();
  particles.dispose();
  return { images, erreurs: erreur ? [`GL error ${erreur}`] : [] };
}
