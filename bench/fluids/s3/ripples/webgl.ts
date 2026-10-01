import { createWebglProgram } from '../../../../packages/sdk-browser/src/webgl/core/program.ts';
import {
  FULLSCREEN_VERTEX,
  setFullscreenPassState,
} from '../../../../packages/sdk-browser/src/webgl/core/fullscreenPass.ts';
import {
  createWebglRenderTarget,
  halfFloatTargets,
} from '../../../../packages/sdk-browser/src/webgl/core/renderTarget.ts';
import { createRippleModel } from './model.ts';
import { SPLAT_FRAGMENT, SPLAT_VERTEX, STEP_GLSL } from './glsl.ts';
import type { RippleFrame, RippleSpec } from './types.ts';

/** Dedicated spike context: no render state of a production world is borrowed. RGBA16F blending
 *  does not require EXT_float_blend (which adds 32-bit float blending). No texture feedback. */
export function createWebglRipples(gl: WebGL2RenderingContext, spec: RippleSpec) {
  const model = createRippleModel(spec),
    n = model.resolution;
  if (!halfFloatTargets(gl)) throw new Error('Ripple half-float render targets are unavailable');
  const targets = [0, 1].map(() => createWebglRenderTarget(gl, n, n, { depth: false, hdr: true }));
  const solve = createWebglProgram(gl, FULLSCREEN_VERTEX, STEP_GLSL);
  const splat = createWebglProgram(gl, SPLAT_VERTEX, SPLAT_FRAGMENT);
  const buffer = gl.createBuffer(),
    vao = gl.createVertexArray();
  const physical = gl.getUniformLocation(solve, 'physical'),
    shift = gl.getUniformLocation(solve, 'shift');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, model.records.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.useProgram(splat);
  gl.uniform1f(gl.getUniformLocation(splat, 'extent'), model.extent);
  gl.useProgram(solve);
  gl.uniform1i(gl.getUniformLocation(solve, 'source'), 0);
  setFullscreenPassState(gl);
  gl.clearColor(0, 0, 0, 0);
  for (const target of targets) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
  gl.useProgram(null);
  let current = 0,
    disposed = false;
  const advance = (dt: number, x = 0, z = 0) => {
    gl.disable(gl.BLEND);
    gl.useProgram(solve);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1 - current].framebuffer);
    gl.uniform4f(physical, dt, model.dx, model.depth, Math.exp(-model.damping * dt));
    gl.uniform2i(shift, Math.max(-n, Math.min(n, x)), Math.max(-n, Math.min(n, z)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    current = 1 - current;
  };
  return {
    resolution: n,
    rate: model.rate,
    bytes: model.stateBytes + model.records.byteLength,
    texture: () => targets[current].texture,
    step(seconds: number, _encoder?: GPUCommandEncoder, frame?: RippleFrame) {
      if (disposed || gl.isContextLost()) throw new Error('Ripple context is unavailable');
      const work = model.plan(seconds, frame);
      setFullscreenPassState(gl);
      gl.viewport(0, 0, n, n);
      if (work.recentered) advance(0, work.shiftX, work.shiftZ);
      if (work.splats) {
        // Unbind the previous read texture before drawing into it with blending.
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[current].framebuffer);
        gl.useProgram(splat);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, model.records, 0, work.splats * 4);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, work.splats);
      }
      for (let i = 0; i < work.steps; i++) advance(model.dt);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray(null);
      gl.useProgram(null);
      return work;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      targets.forEach((target) => target.dispose());
      gl.deleteProgram(solve);
      gl.deleteProgram(splat);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
  };
}
