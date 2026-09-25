import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts';
import type { WebglEffectKind } from './webglEffects.ts';
import { FULLSCREEN_VERTEX } from '../webgl/core/fullscreenPass.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import {
  bindWebglTarget,
  createWebglRenderTarget,
  type WebglRenderTarget,
} from '../webgl/core/renderTarget.ts';
import { bloomBlend, bloomLevelBytes, bloomLevelSizes } from './bloomFilter.ts';
import { BLOOM_GLSL } from './bloomGlsl.ts';

type Program = ReturnType<typeof bloomProgram>;

/** One bloom program and the uniforms it sets: `level` on unit 0, `scene` on unit 1. */
function bloomProgram(gl: WebGL2RenderingContext, fragment: string) {
  const program = createWebglProgram(gl, FULLSCREEN_VERTEX, fragment);
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.useProgram(program);
  gl.uniform1i(at('level'), 0);
  gl.uniform1i(at('scene'), 1);
  const targetTexel = at('targetTexel'),
    sourceTexel = at('sourceTexel'),
    radius = at('radius'),
    keep = at('keep'),
    glow = at('glow');
  return {
    program,
    use(out: readonly number[], read: readonly number[], spread: number, k = 0, g = 0) {
      gl.useProgram(program);
      gl.uniform2f(targetTexel, 1 / out[0], 1 / out[1]);
      gl.uniform2f(sourceTexel, 1 / read[0], 1 / read[1]);
      gl.uniform1f(radius, spread);
      gl.uniform1f(keep, k);
      gl.uniform1f(glow, g);
    },
  };
}

/**
 * The WebGL2 bloom, the same chain as `webgpuBloom.ts` from the same filters (`bloomFilter.ts`):
 * one half-float target per level, sized with the image (`resize`), and three programs. `draw`
 * writes, into `output`, `input` with its glow; every bloom of the chain draws on the same levels,
 * one after the other. The caller has set the full-screen pass state and bound its vertex array.
 */
export function createWebglBloom(gl: WebGL2RenderingContext): WebglEffectKind<Bloom> {
  const programs: Record<keyof typeof BLOOM_GLSL, Program> = {
    down: bloomProgram(gl, BLOOM_GLSL.down),
    up: bloomProgram(gl, BLOOM_GLSL.up),
    composite: bloomProgram(gl, BLOOM_GLSL.composite),
  };
  let levels: WebglRenderTarget[] = [],
    sizes: (readonly [number, number])[] = [],
    width = 0,
    height = 0;
  /** Frees the levels; nothing to do, and nothing allocated, once they are free. */
  const release = () => {
    if (!width) return;
    for (const level of levels) level.dispose();
    levels = [];
    sizes = [];
    width = height = 0;
  };
  const into = (target: WebglRenderTarget) => bindWebglTarget(gl, target);
  const read = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };
  return {
    /** Bytes of the level chain as allocated. */
    get bytes() {
      return levels.length ? bloomLevelBytes(width, height) : 0;
    },
    /** Sizes the chain for an image of `w` × `h`; no bloom in the chain frees it. */
    resize(w: number, h: number, count: number) {
      if (!count) return release();
      if (w === width && h === height) return;
      release();
      width = w;
      height = h;
      sizes = bloomLevelSizes(w, h);
      levels = sizes.map(([lw, lh]) =>
        createWebglRenderTarget(gl, lw, lh, { depth: false, hdr: true }),
      );
    },
    /**
     * Filters `input` down the levels and back up, then blends the first level's sum into
     * `output` at the image's size: 2 × levels draws, none on an image too small to halve. Leaves
     * blending off.
     */
    draw(bloom, _nth, input, output) {
      const count = levels.length;
      if (!count) return 0;
      const full = [width, height],
        { radius } = bloom;
      // The image stays on unit 1 for the whole chain: no pass writes it, composition reads it.
      read(1, input.texture);
      for (let level = 0; level < count; level++) {
        into(levels[level]);
        programs.down.use(sizes[level], level ? sizes[level - 1] : full, radius);
        read(0, level ? levels[level - 1].texture : input.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let level = count - 2; level >= 0; level--) {
        into(levels[level]);
        programs.up.use(sizes[level], sizes[level + 1], radius);
        read(0, levels[level + 1].texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
      const { keep, glow } = bloomBlend(bloom.intensity, count);
      into(output);
      programs.composite.use(full, sizes[0], radius, keep, glow);
      read(0, levels[0].texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return 2 * count;
    },
    dispose() {
      release();
      for (const { program } of Object.values(programs)) gl.deleteProgram(program);
    },
  };
}
