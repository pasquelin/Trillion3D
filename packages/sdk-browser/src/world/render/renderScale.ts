import type { RenderBackend } from '../../backend/types.ts';
import { createWebglSceneTarget, type WebglSceneTarget } from '../../effects/webglOutput.ts';
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
import { renderExtent } from '../../webgpu/pages/state/renderScale.ts';

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

/** Where the image is drawn below the display, and the resample programs that bring it back. */
function createResources(gl: WebGL2RenderingContext) {
  const programs = [resampleProgram(gl, false), resampleProgram(gl, true)],
    vao = gl.createVertexArray()!;
  let target: WebglSceneTarget | undefined,
    width = 0,
    height = 0;
  return {
    programs,
    vao,
    /** The target, made `w` × `h`: the size at the bounds' maximum, which a scale step never remakes. */
    target(w: number, h: number) {
      if (target && w === width && h === height) return target;
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
      for (const { program } of programs) gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}

/**
 * WebGL2's render scale (#834): the scale the engine's `renderScaleControl` picks — its bounds'
 * maximum on a still image (`frameHeld`), which the kept image then is, the controller's while it
 * moves —, the image drawn at it in the top-left of a target made at that maximum, and resampled
 * to the display with Lanczos-2 (`../../webgl/core/resampleGlsl.ts`). WebGL2 keeps no history: no
 * jitter, no reconstruction, which is why its default minimum is 1 (`autonomousRenderScale`). A
 * comparison side or a capture (`target`), a context without half-float targets or a lost one draw
 * at the display's size. `drawn` and `steered` are written back for the controller and
 * `world.renderScale`.
 */
export function createComposeScale(gl: WebGL2RenderingContext) {
  const held = boundToContext(
    gl,
    () => createResources(gl),
    (made) => made.dispose(),
  );
  let destination: WebGLFramebuffer | null = null,
    untoned = false,
    drawing: WebglSceneTarget | undefined,
    render = [0, 0];
  return {
    /** The scale of the image last drawn on the surface: what a held frame shows. */
    kept: 1,
    /** The scale `backend` draws this image at; `undefined` without a control, into a `target`
     *  or without the chain (a capture), all at the display's size. */
    scaleOf(backend: RenderBackend, target: unknown, chained: boolean) {
      const control = backend.renderScaleControl;
      if (!control || target || !chained) return undefined;
      if (!halfFloatTargets(gl)) return 1;
      return backend.frameHeld === true ? control.bounds.max : control.wanted();
    },
    /** Redirects `output` to the target the image is drawn at `scale` in, bound and cleared to
     *  `clear` — a linear output's transparent black when absent —, far depth; returns the scale
     *  drawn, written back to the control: 1 where the image stays at the display's size. */
    begin(
      backend: RenderBackend,
      output: HostDrawOutput,
      scale?: number,
      clear?: readonly number[],
    ) {
      const control = backend.renderScaleControl;
      if (!control || scale === undefined) return 1;
      if (control.bounds.min >= 1 && held.alive()) held.current()!.release();
      const made = scale < 1 ? held.current() : null,
        drawn = made ? scale : 1;
      control.drawn = drawn;
      control.steered = control.bounds.auto && backend.frameHeld !== true && scale === drawn;
      if (!made) return 1;
      const { width, height } = output,
        max = control.bounds.max;
      drawing = made.target(renderExtent(width, max), renderExtent(height, max));
      render = [renderExtent(width, scale), renderExtent(height, scale)];
      destination = output.framebuffer;
      untoned = !!output.linear;
      output.framebuffer = drawing.target.framebuffer;
      output.displayWidth = width;
      [output.width, output.height] = render;
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
      gl.viewport(0, 0, render[0], render[1]);
      clearWebglTarget(gl, clear);
      return drawn;
    },
    /** Resamples the image `begin` redirected into the display, `width` × `height`, and gives
     *  `output` its display back; nothing when the image was drawn at the display's size. */
    end(output: HostDrawOutput, width: number, height: number) {
      const made = drawing && held.current();
      if (!made || !drawing) return;
      const pass = made.programs[untoned ? 1 : 0];
      output.framebuffer = destination;
      [output.width, output.height, output.displayWidth] = [width, height, undefined];
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
      gl.viewport(0, 0, width, height);
      setFullscreenPassState(gl);
      gl.useProgram(pass.program);
      gl.bindVertexArray(made.vao);
      gl.uniform2i(pass.render, render[0], render[1]);
      gl.uniform2f(pass.display, width, height);
      bindWebglTexture(gl, 2, drawing.untoned);
      bindWebglTexture(gl, 1, drawing.depth);
      bindWebglTexture(gl, 0, drawing.target.texture);
      // Every pixel takes the resampled depth, whatever the destination held.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Left on a unit, the target's textures would make the next draw into it a feedback loop.
      for (const unit of [2, 1, 0]) bindWebglTexture(gl, unit, null);
      gl.bindVertexArray(null);
      gl.enable(gl.DITHER);
      drawing = undefined;
    },
    dispose: () => held.dispose(),
  };
}
