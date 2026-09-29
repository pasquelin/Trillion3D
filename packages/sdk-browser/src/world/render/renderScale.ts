import type { RenderBackend } from '../../backend/types.ts';
import { createWebglSceneTarget, type WebglSceneTarget } from '../../effects/webglOutput.ts';
import { sceneTargetBytes } from '../../effects/targets.ts';
import { boundToContext } from '../../webgl/core/contextBound.ts';
import { FULLSCREEN_VERTEX, setFullscreenPassState } from '../../webgl/core/fullscreenPass.ts';
import { createWebglProgram } from '../../webgl/core/program.ts';
import {
  bindWebglTexture,
  clearWebglTarget,
  halfFloatTargets,
  type HostDrawOutput,
} from '../../webgl/core/renderTarget.ts';
import { resampleFragment } from '../../webgl/core/resampleGlsl.ts';
import { renderExtent } from '../../frame/renderScaleOption.ts';

/** One resample program: plain, or with the effect chain's second attachment. */
function resampleProgram(gl: WebGL2RenderingContext, untoned: boolean) {
  const program = createWebglProgram(gl, FULLSCREEN_VERTEX, resampleFragment(untoned));
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.useProgram(program);
  gl.uniform1i(at('image'), 0);
  gl.uniform1i(at('depth'), 1);
  if (untoned) gl.uniform1i(at('untoned'), 2);
  return { program, render: at('render'), display: at('display') };
}
type ResampleProgram = ReturnType<typeof resampleProgram>;

/** Where the image is drawn below the display, and the resample programs that bring it back, each
 *  built on its first use. */
function createResources(gl: WebGL2RenderingContext) {
  const programs: (ResampleProgram | undefined)[] = [undefined, undefined],
    vao = gl.createVertexArray()!;
  let target: WebglSceneTarget | undefined,
    width = 0,
    height = 0;
  return {
    vao,
    program: (untoned: boolean) => (programs[+untoned] ??= resampleProgram(gl, untoned)),
    /** Bytes of the target, at its size (`sceneTargetBytes`). */
    get bytes() {
      return target ? sceneTargetBytes(width, height) : 0;
    },
    /** The target, made `w` × `h`: the size at the bounds' maximum, which a scale step never remakes. */
    target(w: number, h: number) {
      if (target && !target.refused && w === width && h === height) return target;
      target?.dispose();
      [width, height] = [w, h];
      return (target = createWebglSceneTarget(gl, w, h));
    },
    release() {
      target?.dispose();
      target = undefined;
    },
    dispose() {
      this.release();
      for (const made of programs) if (made) gl.deleteProgram(made.program);
      gl.deleteVertexArray(vao);
    },
  };
}

/**
 * WebGL2's render scale (#834): the scale the engine's `renderScaleControl` picks — its bounds'
 * maximum on a still image (`frameHeld`), which the kept image then is, the controller's while it
 * moves (`imageScale`) —, the image drawn at it in the top-left of a target made at that maximum,
 * and resampled to the display with Lanczos-2 (`../../webgl/core/resampleGlsl.ts`). WebGL2 keeps no
 * history: no jitter, no reconstruction, which is why its default minimum is 1
 * (`autonomousRenderScale`). A comparison side or a capture (`target`), a context without
 * half-float targets or a lost one draw at the display's size. `drawn` and `steered` are written
 * back for the controller and `world.renderScale`.
 */
export function createComposeScale(gl: WebGL2RenderingContext) {
  const held = boundToContext(
    gl,
    () => createResources(gl),
    (made) => made.dispose(),
  );
  let destination: WebGLFramebuffer | null = null,
    drawing: WebglSceneTarget | undefined,
    displayHeight = 0,
    /** The scale of the image last drawn on the surface, and of the one kept: what a held frame shows. */
    drawn = 1,
    kept = 1;
  return {
    /** The scale `backend` draws this image at; `undefined` without a control, into a `target`
     *  or without the chain (a capture), all at the display's size. */
    scaleOf(backend: RenderBackend, target: unknown, chained: boolean) {
      const control = backend.renderScaleControl;
      if (!control || target || !chained) return undefined;
      const scale = control.imageScale(backend.frameHeld === true);
      return scale < 1 && !halfFloatTargets(gl) ? 1 : scale;
    },
    /** Whether the kept image was drawn at `scale`, what a held frame put back must show. */
    holds: (scale: number | undefined) => kept === (scale ?? 1),
    /** The image just drawn on the surface is the one kept. */
    keep() {
      kept = drawn;
    },
    /** Redirects `output` to the target the image is drawn at `scale` in, bound and cleared to
     *  `clear` — a linear output's transparent black when absent —, far depth; writes the scale
     *  drawn back to the control. False where the image stays at the display's size, `output`
     *  untouched. */
    begin(
      backend: RenderBackend,
      output: HostDrawOutput,
      scale?: number,
      clear?: readonly number[],
    ) {
      // A draw that threw after the last `begin` left its redirect behind: never resampled now.
      drawn = 1;
      if (drawing) drawing = output.displayWidth = undefined;
      const control = backend.renderScaleControl;
      if (!control || scale === undefined) return false;
      if (control.bounds.min >= 1 && held.alive()) held.current()!.release();
      const made = scale < 1 ? held.current() : null;
      if (made) drawn = scale;
      control.drawn = drawn;
      control.steered = control.bounds.auto && backend.frameHeld !== true && scale === drawn;
      if (!made) return false;
      const { width, height } = output,
        max = control.bounds.max;
      drawing = made.target(renderExtent(width, max), renderExtent(height, max));
      destination = output.framebuffer;
      displayHeight = height;
      output.framebuffer = drawing.target.framebuffer;
      output.displayWidth = width;
      output.width = renderExtent(width, scale);
      output.height = renderExtent(height, scale);
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
      gl.viewport(0, 0, output.width, output.height);
      clearWebglTarget(gl, clear);
      return true;
    },
    /** Resamples the image `begin` redirected into the display and gives `output` its display
     *  back; nothing when the image was drawn at the display's size. */
    end(output: HostDrawOutput) {
      if (!drawing) return;
      const made = held.current(),
        from = drawing;
      drawing = undefined;
      if (!made) return;
      const pass = made.program(!!output.linear),
        width = output.displayWidth!,
        height = displayHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
      gl.viewport(0, 0, width, height);
      setFullscreenPassState(gl);
      gl.useProgram(pass.program);
      gl.bindVertexArray(made.vao);
      gl.uniform2i(pass.render, output.width, output.height);
      gl.uniform2f(pass.display, width, height);
      output.framebuffer = destination;
      output.width = width;
      output.height = height;
      output.displayWidth = undefined;
      bindWebglTexture(gl, 2, from.untoned);
      bindWebglTexture(gl, 1, from.depth);
      bindWebglTexture(gl, 0, from.target.texture);
      // Every pixel takes the resampled depth, whatever the destination held and whatever depth
      // write the engine's last draw left off.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(true);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Left on a unit, the target's textures would make the next draw into it a feedback loop.
      bindWebglTexture(gl, 2, null);
      bindWebglTexture(gl, 1, null);
      bindWebglTexture(gl, 0, null);
      gl.bindVertexArray(null);
      gl.enable(gl.DITHER);
    },
    /** Bytes of the target the image is drawn below the display in. */
    bytes: () => (held.alive() ? held.current()!.bytes : 0),
    dispose: () => held.dispose(),
  };
}
