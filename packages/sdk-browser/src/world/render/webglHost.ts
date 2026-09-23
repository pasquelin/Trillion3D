import { DEFAULT_HEIGHT, DEFAULT_PIXEL_RATIO, DEFAULT_WIDTH } from '../../backend/common.ts';
import { createWebglSurface } from '../../webgl/core/surface.ts';

type Inputs = {
  canvas: HTMLCanvasElement;
  /** Logical size and pixel ratio the host asked for; the engine defaults fill what it left out. */
  size?: { width?: number; height?: number; pixelRatio?: number };
  onLifecycle: (state: 'lost' | 'restored') => void;
};

/** Creates and sizes the WebGL2 surface before any draw adapter exists. */
export function prepareExplorerWebglSurface({ canvas, size = {}, onLifecycle }: Inputs) {
  const surface = createWebglSurface(canvas, {
    onLost: () => onLifecycle('lost'),
    onRestored: () => onLifecycle('restored'),
  });
  surface.resize(
    size.width ?? DEFAULT_WIDTH,
    size.height ?? DEFAULT_HEIGHT,
    size.pixelRatio ?? DEFAULT_PIXEL_RATIO,
  );
  return surface;
}
