import { multiplyMatrix4Typed } from '../../../sdk-core/src/math/matrix/matrix4Typed.ts';
import { boundToContext } from '../webgl/core/contextBound.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import type { HostDrawCamera } from '../camera/world.ts';
import type { HostDrawOutput } from '../webgl/core/renderTarget.ts';
import type { GuideSet } from './guideSet.ts';
import { GUIDE_INSTANCE_FLOATS } from './guidePack.ts';
import {
  GUIDE_GLSL_FRAGMENT,
  GUIDE_GLSL_VERTEX,
  GUIDE_UNIFORM_FLOATS,
  writeGuideView,
} from './guideShaders.ts';

const STRIDE = GUIDE_INSTANCE_FLOATS * 4;

/**
 * The WebGL2 guide draw: the same program as the WebGPU pass (`guideShaders.ts`), drawn into the
 * framebuffer the host composed the engine's image in, tested against the depth that image left,
 * with the host projection's forward depth, at the host's `pixelRatio`, read each frame. Built on the first frame that shows a guide, rebuilt
 * after a lost context; the path has no temporal accumulation, so nothing else is kept out.
 */
export function createWebglGuideDraw(gl: WebGL2RenderingContext, pixelRatio: () => number) {
  const view = new Float32Array(GUIDE_UNIFORM_FLOATS),
    screen = new Float64Array(16);
  let uploaded: unknown;
  const bound = boundToContext(
    gl,
    () => {
      uploaded = undefined;
      const program = createWebglProgram(gl, GUIDE_GLSL_VERTEX, GUIDE_GLSL_FRAGMENT);
      const vao = gl.createVertexArray()!,
        buffer = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const layout = [
        [0, 3, gl.FLOAT, false, 0],
        [1, 3, gl.FLOAT, false, 12],
        [2, 4, gl.UNSIGNED_BYTE, true, 24],
        [3, 1, gl.FLOAT, false, 28],
      ] as const;
      for (const [location, size, type, normalized, offset] of layout) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, type, normalized, STRIDE, offset);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindVertexArray(null);
      const at = (name: string) => gl.getUniformLocation(program, name);
      return {
        program,
        vao,
        buffer,
        matrix: at('matrix'),
        viewport: at('viewport'),
        pixelRatio: at('pixelRatio'),
      };
    },
    ({ program, vao, buffer }) => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buffer);
    },
  );
  return {
    /** Draws the visible guides into `output`'s framebuffer; false, and nothing touched, when
     *  none is shown or the context is lost. */
    draw(guides: GuideSet, camera: HostDrawCamera, output: HostDrawOutput) {
      const { width, height } = output;
      const packed = guides.pack();
      if (!packed.count) return false;
      const live = bound.current();
      if (!live) return false;
      multiplyMatrix4Typed(screen, camera.projection, camera.view);
      writeGuideView(view, screen, packed.anchor, width, height, pixelRatio());
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
      gl.useProgram(live.program);
      gl.bindVertexArray(live.vao);
      if (uploaded !== packed) {
        gl.bindBuffer(gl.ARRAY_BUFFER, live.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, packed.data, gl.DYNAMIC_DRAW);
        uploaded = packed;
      }
      gl.uniformMatrix4fv(live.matrix, false, view.subarray(0, 16));
      gl.uniform4fv(live.viewport, view.subarray(16, 20));
      gl.uniform1f(live.pixelRatio, view[20]);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.colorMask(true, true, true, true);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, packed.count);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      return true;
    },
    dispose: bound.dispose,
  };
}
