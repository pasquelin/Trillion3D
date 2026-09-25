import type { EffectKind, EffectPass } from '../../../sdk-core/src/world/effect/chain.ts';
import { boundToContext } from '../webgl/core/contextBound.ts';
import { setFullscreenPassState } from '../webgl/core/fullscreenPass.ts';
import {
  bindWebglTarget,
  createWebglRenderTarget,
  halfFloatTargets,
  type WebglRenderTarget,
} from '../webgl/core/renderTarget.ts';
import {
  countKinds,
  EFFECT_KINDS as KINDS,
  effectPassTargets,
  effectTargetBytes,
  type EffectPassOf,
} from './targets.ts';
import { createWebglBloom } from './webglBloom.ts';
import {
  createWebglOutput,
  createWebglSceneTarget,
  type WebglEffectOutput,
  type WebglSceneTarget,
} from './webglOutput.ts';

export type { WebglEffectOutput } from './webglOutput.ts';

/** One kind of pass on WebGL2: its programs, made with the context, and the resources its passes
 *  share. */
export type WebglEffectKind<P> = {
  /** Bytes of what it holds as allocated. */
  readonly bytes: number;
  /** Sizes what it holds for `count` passes on a `w × h` image; zero passes free it. */
  resize(w: number, h: number, count: number): void;
  /** Draws `pass`, the `nth` of its kind in the chain, from `input` into `output`; returns the
   *  draws made, zero when it cannot draw at this size. */
  draw(pass: P, nth: number, input: WebglRenderTarget, output: WebglRenderTarget): number;
  dispose(): void;
};
type Kinds = { [K in EffectKind]: WebglEffectKind<EffectPassOf<K>> };

/** Each kind's WebGL2 implementation: the one place a new built-in or a custom pass plugs in. */
export const WEBGL_KINDS: { [K in EffectKind]: (gl: WebGL2RenderingContext) => Kinds[K] } = {
  bloom: createWebglBloom,
};

/** Everything the chain holds on the context: the kinds, the output, the vertex array, targets. */
function createResources(gl: WebGL2RenderingContext) {
  const output = createWebglOutput(gl),
    vao = gl.createVertexArray()!,
    made: Partial<Kinds> = {},
    counts = {} as Record<EffectKind, number>,
    nth = {} as Record<EffectKind, number>,
    targets: WebglRenderTarget[] = [];
  let scene: WebglSceneTarget | undefined,
    width = 0,
    height = 0,
    draws = 0;
  const release = () => {
    for (const target of targets) target.dispose();
    targets.length = 0;
    scene?.dispose();
    scene = undefined;
    width = height = 0;
    for (const kind of KINDS) made[kind]?.resize(0, 0, 0);
  };
  /** Draws `pass` with its kind's implementation; the chain holds built-ins only (`EffectKind`). */
  const drawPass = <K extends EffectKind>(
    pass: EffectPassOf<K>,
    input: WebglRenderTarget,
    into: WebglRenderTarget,
  ) => made[pass.kind as K]!.draw(pass, nth[pass.kind]++, input, into);
  return {
    output,
    vao,
    get scene() {
      return scene!;
    },
    get bytes() {
      let bytes = effectTargetBytes(width, height, targets.length, !!scene);
      for (const kind of KINDS) bytes += made[kind]?.bytes ?? 0;
      return bytes;
    },
    /** The scene's target, then the pass targets and each kind's own, for `passes` at `w` × `h`. */
    ensure(passes: readonly EffectPass[], w: number, h: number) {
      if (w !== width || h !== height) release();
      width = w;
      height = h;
      scene ??= createWebglSceneTarget(gl, w, h);
      while (targets.length < effectPassTargets(passes.length))
        targets.push(createWebglRenderTarget(gl, w, h, { depth: false, hdr: true }));
      countKinds(passes, counts);
      for (const kind of KINDS)
        if (counts[kind]) (made[kind] ??= WEBGL_KINDS[kind](gl)).resize(w, h, counts[kind]);
        else made[kind]?.resize(0, 0, 0);
    },
    /** Draws the last `run` made. */
    get draws() {
      return draws;
    },
    /** Runs the passes on the scene's target; returns the last image. */
    run(passes: readonly EffectPass[]) {
      for (const kind of KINDS) nth[kind] = 0;
      let image = scene!.target,
        written = 0;
      draws = 0;
      for (const pass of passes) {
        const next = targets[written % 2],
          drawn = drawPass(pass as EffectPassOf<EffectKind>, image, next);
        if (!drawn) continue;
        draws += drawn;
        image = next;
        written++;
      }
      return image;
    },
    release,
    dispose() {
      release();
      for (const kind of KINDS) made[kind]?.dispose();
      output.dispose();
      gl.deleteVertexArray(vao);
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
    /** Bytes of the targets the chain holds: the scene's with its depth, the passes', the kinds'. */
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
      made.ensure(passes, w, h);
      const scene = made.scene.target;
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
      const image = made.run(passes);
      bindWebglTarget(gl, destination);
      made.output.draw(image, made.scene, out);
      draws = made.draws + 1;
      gl.bindVertexArray(null);
      // Dithering back at the context's default: the frames after the chain draw as without it.
      gl.enable(gl.DITHER);
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
