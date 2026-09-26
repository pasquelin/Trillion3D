// Page side of the WebGL2 particle proof (#759): the engine's own step on a real context, its
// state read back from the target each image drew into.
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
  const read = (slots: number) => {
    const state = new Float32Array(slots * 8); // two texels a slot
    gl.bindFramebuffer(gl.FRAMEBUFFER, drawnInto);
    gl.readPixels(0, 0, 2 * slots, 1, gl.RGBA, gl.FLOAT, state);
    return Array.from(state);
  };
  const images = [0, 1].map(() => {
    pool.advance(DT);
    particles.run([pool]);
    return read(3);
  });
  // A 60 s life at 144 Hz: stepped until its pool is idle, some steps past its death.
  const life = new ParticlePool({ capacity: 8, acceleration: [0, 0, 0] });
  life.emit(0, 0, 0, 0, 1, 0, 60);
  let steps = 0;
  for (; life.moving && steps < 62 * 144; steps++) {
    life.advance(1 / 144);
    particles.run([life]);
  }
  const dead = { steps, particle: read(1) };
  const erreur = gl.getError();
  particles.dispose();
  return { images, dead, erreurs: erreur ? [`GL error ${erreur}`] : [] };
}
