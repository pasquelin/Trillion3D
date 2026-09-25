import type { EffectPass } from '../../../sdk-core/src/world/effect/chain.ts';
import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts';
import { boundToContext } from '../webgl/core/contextBound.ts';
import { FULLSCREEN_VERTEX, setFullscreenPassState } from '../webgl/core/fullscreenPass.ts';
import { OUTPUT_TRANSFER_GLSL } from '../webgl/core/outputGlsl.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import {
  bindWebglTarget,
  createWebglRenderTarget,
  halfFloatTargets,
  type WebglRenderTarget,
} from '../webgl/core/renderTarget.ts';
import { BLOOM_TEXEL_BYTES } from './bloomFilter.ts';
import { createWebglBloom } from './webglBloom.ts';

/**
 * The display chain's last links after the effects: premultiplied linear radiance over the
 * background, as the WebGPU composition writes it — an uncovered pixel is the background as it is,
 * a covered one its radiance through the scene's curve and the sRGB transfer, a partly covered one
 * the mix of the two by coverage.
 */
const OUTPUT_FRAGMENT = `#version 300 es
precision highp float;precision highp sampler2D;uniform sampler2D image;uniform bool toneMapped;
uniform vec3 background;out vec4 color;
${OUTPUT_TRANSFER_GLSL}
void main(){vec4 v=texelFetch(image,ivec2(gl_FragCoord.xy),0);
if(v.a<=0.0){color=vec4(background,1.0);return;}
float a=min(v.a,1.0);vec3 c=v.rgb/v.a;if(toneMapped)c=toneMap(c);
color=vec4(linearToSrgb(c)*a+background*(1.0-a),1.0);}`;

/** What one display chain needs besides the passes: the curve and the encoded background. */
export type WebglEffectOutput = {
  toneMapped: boolean;
  /** Rank of the scene's curve (`TONE_MAPPING_RANK`). */
  toneCurve: number;
  /** The background, sRGB-encoded. */
  background: readonly [number, number, number];
};

/** Everything the chain holds on the context: programs, vertex array, bloom and targets. */
function createResources(gl: WebGL2RenderingContext) {
  const program = createWebglProgram(gl, FULLSCREEN_VERTEX, OUTPUT_FRAGMENT);
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.useProgram(program);
  gl.uniform1i(at('image'), 0);
  const [toneMapped, toneCurve, background] = ['toneMapped', 'toneCurve', 'background'].map(at);
  const vao = gl.createVertexArray()!,
    bloom = createWebglBloom(gl),
    targets: WebglRenderTarget[] = [];
  let width = 0,
    height = 0;
  const release = () => {
    for (const target of targets) target.dispose();
    targets.length = 0;
    width = height = 0;
    bloom.resize(0, 0);
  };
  return {
    bloom,
    vao,
    targets,
    get bytes() {
      const texels = width * height,
        depth = targets.length ? texels * 4 : 0;
      return targets.length * texels * BLOOM_TEXEL_BYTES + depth + bloom.bytes;
    },
    /** The scene's target — with depth — then `count` pass targets, at `w` × `h`. */
    ensure(count: number, w: number, h: number) {
      if (w !== width || h !== height) release();
      width = w;
      height = h;
      while (targets.length < count + 1)
        targets.push(createWebglRenderTarget(gl, w, h, { depth: !targets.length, hdr: true }));
      bloom.resize(w, h);
    },
    release,
    output(image: WebglRenderTarget, out: WebglEffectOutput) {
      gl.useProgram(program);
      gl.uniform1i(toneMapped, out.toneMapped ? 1 : 0);
      gl.uniform1i(toneCurve, out.toneCurve);
      gl.uniform3f(background, out.background[0], out.background[1], out.background[2]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, image.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      release();
      bloom.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

/**
 * The WebGL2 side of `world.effects`. The engine draws the scene's linear radiance into a
 * half-float target (`begin`), the passes run on it, each into the next of two targets, and the
 * output program brings the last into display space where the frame lands (`end`). Nothing exists
 * before the first frame with a pass; the targets follow the image's size and `release` frees
 * them when the chain empties. A context that cannot render half floats draws without the chain
 * (`supported`). Everything lives as long as the context and is rebuilt after a loss.
 */
export function createWebglEffects(gl: WebGL2RenderingContext) {
  const held = boundToContext(
    gl,
    () => createResources(gl),
    (made) => made.dispose(),
  );
  let draws = 0;
  return {
    /** Whether this context renders the chain's half-float targets. */
    supported: () => halfFloatTargets(gl),
    /** Bytes of the targets the chain holds: the scene's with its depth, the passes', the bloom's. */
    get bytes() {
      return held.alive() ? held.current()!.bytes : 0;
    },
    /** Passes the last `end` drew, the output included. */
    get draws() {
      return draws;
    },
    /** Binds the scene's linear target at `w` × `h`, cleared to transparent black and far depth,
     *  and returns it; null on a lost context. */
    begin(passes: readonly EffectPass[], w: number, h: number) {
      const made = held.current();
      if (!made) return null;
      made.ensure(Math.min(passes.length, 2), w, h);
      const scene = made.targets[0];
      bindWebglTarget(gl, scene);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return scene;
    },
    /** Runs the passes over the scene's target and draws the result into `destination` — the
     *  drawing buffer for null — through the display chain. */
    end(
      passes: readonly EffectPass[],
      destination: WebglRenderTarget | null,
      out: WebglEffectOutput,
    ) {
      const made = held.current();
      if (!made) return;
      setFullscreenPassState(gl);
      gl.bindVertexArray(made.vao);
      let image = made.targets[0];
      draws = 0;
      if (made.bloom.levels)
        for (let index = 0; index < passes.length; index++) {
          const next = made.targets[1 + (index % 2)];
          draws += made.bloom.draw(passes[index] as Bloom, image, next);
          image = next;
        }
      bindWebglTarget(gl, destination);
      made.output(image, out);
      draws++;
      gl.bindVertexArray(null);
    },
    /** Frees the targets; the programs stay. */
    release() {
      if (held.alive()) held.current()!.release();
    },
    dispose() {
      held.dispose();
    },
  };
}
