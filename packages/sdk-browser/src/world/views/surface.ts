import { createWebglRenderTarget } from '../../webgl/core/renderTarget.ts';
import { boundToContext } from '../../webgl/core/contextBound.ts';
import type { PresentRect } from '../../gpu/core/presentAt.ts';

/** One view's full-quality composition target, copied pixel for pixel into its canvas rectangle. */
export function createViewSurface(gl: WebGL2RenderingContext) {
  const held = boundToContext(
    gl,
    () => createWebglRenderTarget(gl, 1, 1),
    (target) => target.dispose(),
  );
  return {
    target(rect: PresentRect) {
      const target = held.current();
      if (!target) throw new Error('CONTEXT_LOST');
      target.resize(rect.width, rect.height);
      return target;
    },
    present(rect: PresentRect) {
      const target = held.current();
      if (!target) throw new Error('CONTEXT_LOST');
      const top = gl.drawingBufferHeight - rect.y;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(
        0,
        0,
        target.width,
        target.height,
        rect.x,
        top - rect.height,
        rect.x + rect.width,
        top,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    bytes: () => {
      const target = held.alive() ? held.current() : null;
      return target ? target.width * target.height * 8 : 0;
    },
    dispose: () => held.dispose(),
  };
}
