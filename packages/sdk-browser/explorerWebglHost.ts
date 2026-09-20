import { createWebglSurface } from './webglSurface.ts';
import type { WebglSurface } from './webglSurface.ts';

type Inputs = {
  canvas: HTMLCanvasElement;
  onLifecycle: (state: 'lost' | 'restored') => void;
};

/** Creates and sizes the WebGL2 surface before any draw adapter exists. */
export function prepareExplorerWebglSurface(inputs: Inputs) {
  return createWebglSurface(inputs.canvas, {
    onLost: () => inputs.onLifecycle('lost'),
    onRestored: () => inputs.onLifecycle('restored'),
  });
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
