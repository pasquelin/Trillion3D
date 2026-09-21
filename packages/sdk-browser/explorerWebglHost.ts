import { DEFAULT_HEIGHT, DEFAULT_PIXEL_RATIO, DEFAULT_WIDTH } from './backendCommon.ts';
import { createWebglSurface } from './webglSurface.ts';
import type { WebglSurface } from './webglSurface.ts';

type Inputs = {
  canvas: HTMLCanvasElement;
  /** Logical size and pixel ratio the host asked for; the engine defaults fill what it left out. */
  size: { width?: number; height?: number; pixelRatio?: number };
  onLifecycle: (state: 'lost' | 'restored') => void;
};

/** Creates and sizes the WebGL2 surface before any draw adapter exists. */
export function prepareExplorerWebglSurface({ canvas, size, onLifecycle }: Inputs) {
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

/** Keeps the temporary draw adapter synchronized without resetting an unchanged buffer. */
export function resizeExplorerWebglHost(
  surface: WebglSurface,
  renderer: { setDrawingBufferSize(width: number, height: number, pixelRatio: number): void },
  width: number,
  height: number,
  pixelRatio: number,
) {
  return surface.resize(width, height, pixelRatio, (w, h, ratio) =>
    renderer.setDrawingBufferSize(w, h, ratio),
  );
}
