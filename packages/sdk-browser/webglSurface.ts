import { DEFAULT_PIXEL_RATIO, devicePixels } from './backendCommon.ts';

export const WEBGL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: false,
  alpha: false,
  preserveDrawingBuffer: false,
};

export type WebglSurface = ReturnType<typeof createWebglSurface>;

type SurfaceOptions = {
  onLost?: () => void;
  onRestored?: () => void;
};

/** Owns the host WebGL2 context and its drawing-buffer lifecycle. */
export function createWebglSurface(canvas: HTMLCanvasElement, options: SurfaceOptions = {}) {
  const context = canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES);
  if (!context) throw new Error('WebGL2 unavailable');
  let lost = context.isContextLost(),
    restorations = 0,
    disposed = false,
    logicalWidth = 0,
    logicalHeight = 0,
    pixelRatio = DEFAULT_PIXEL_RATIO;
  const onContextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    options.onLost?.();
  };
  const onContextRestored = () => {
    lost = false;
    restorations++;
    options.onRestored?.();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  return {
    canvas,
    context,
    /** True from the loss itself, not from its event: the event is queued behind the frame that
     *  hit the dead context, and the host asks in that frame. The flag stays for the other end:
     *  a restored context answers before its event, and the resources are rebuilt on that event. */
    get lost() {
      return lost || context.isContextLost();
    },
    get disposed() {
      return disposed;
    },
    /** How many times the context came back: a GPU object built before the last restoration
     *  belongs to a dead context, and its owner rebuilds it. */
    get restorations() {
      return restorations;
    },
    get size() {
      return {
        width: logicalWidth,
        height: logicalHeight,
        pixelRatio,
        drawingWidth: canvas.width,
        drawingHeight: canvas.height,
      };
    },
    resize(
      width: number,
      height: number,
      ratio = DEFAULT_PIXEL_RATIO,
      apply?: (width: number, height: number, ratio: number) => void,
    ) {
      if (disposed) throw new Error('WebGL surface disposed');
      const changed = width !== logicalWidth || height !== logicalHeight || ratio !== pixelRatio;
      if (!changed) return false;
      if (apply) apply(width, height, ratio);
      else {
        const drawingWidth = devicePixels(width, ratio),
          drawingHeight = devicePixels(height, ratio);
        if (canvas.width !== drawingWidth) canvas.width = drawingWidth;
        if (canvas.height !== drawingHeight) canvas.height = drawingHeight;
      }
      logicalWidth = width;
      logicalHeight = height;
      pixelRatio = ratio;
      return changed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      context.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
