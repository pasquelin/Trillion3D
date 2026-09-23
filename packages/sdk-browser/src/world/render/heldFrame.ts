import { boundToContext } from '../../webgl/core/contextBound.ts';
import { createWebglRenderTarget } from '../../webgl/core/renderTarget.ts';

/**
 * Held frame of an engine that draws on the host surface.
 *
 * Such an engine says when its frame cannot differ from the previous one; redrawing it would
 * cost the whole scene for the same image. The canvas content, for its part, does not survive
 * from frame to frame — `preserveDrawingBuffer` is false, and relying on it would display
 * whatever the browser happens to keep.
 *
 * What is kept is therefore an explicit copy: the last complete frame is blitted from the
 * drawing buffer into a colour-only target of the same size, and a held frame blits it back —
 * one copy each way, no program, no scene, no conversion, since both hold raw display bytes.
 * The copy costs a whole frame of bandwidth; it only happens after a complete frame, never
 * after a held frame, which only puts back what it just read.
 */
export function createHeldFrame(gl: WebGL2RenderingContext) {
  let width = 0,
    height = 0,
    kept = false;
  const copy = boundToContext(
    gl,
    () => createWebglRenderTarget(gl, width, height, { depth: false }),
    (target) => target.dispose(),
  );
  /** Whole-buffer copy between the drawing buffer and the kept texture, in either direction. */
  const blit = (read: WebGLFramebuffer | null, draw: WebGLFramebuffer | null) => {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  return {
    /** True when a complete frame has been kept at the current drawing-buffer size, and the
     *  context that holds it is alive: a lost one lost the copy with it. */
    holds(drawingWidth: number, drawingHeight: number) {
      return kept && drawingWidth === width && drawingHeight === height && copy.alive();
    },
    /** Keeps the complete frame that was just drawn, by copying the drawing buffer. */
    keep(drawingWidth: number, drawingHeight: number) {
      if (drawingWidth !== width || drawingHeight !== height) {
        copy.dispose();
        width = drawingWidth;
        height = drawingHeight;
      }
      const target = copy.current();
      if (!target) return;
      blit(null, target.framebuffer);
      kept = true;
    },
    /** Puts the kept frame back on the drawing buffer: one copy, nothing of the scene. */
    present() {
      const source = copy.current();
      if (source) blit(source.framebuffer, null);
    },
    dispose() {
      copy.dispose();
      kept = false;
    },
  };
}
