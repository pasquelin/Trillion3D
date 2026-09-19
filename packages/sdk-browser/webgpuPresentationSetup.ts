import { createGpuPresenter } from './gpuPresentation.ts';

/**
 * Presentation surface of the WebGPU engine. With a host canvas, the engine configures it and
 * presents into it. Without one, it presents into a canvas of its own and publishes it: a host
 * whose surface is WebGL2 composes from that canvas (`createCanvasBlit`), and the engine builds
 * no object of the host's rendering library to get its image across.
 */
export function prepareWebgpuPresentation(
  device: GPUDevice,
  gpuCanvas: HTMLCanvasElement | undefined,
) {
  const outputCanvas =
    gpuCanvas ?? (typeof document !== 'undefined' ? document.createElement('canvas') : undefined);
  const presenter = outputCanvas ? createGpuPresenter(device, outputCanvas) : undefined;
  // Published only when it is the engine's own: a host canvas needs no composition, the engine
  // already presented into it.
  return { presenter, composedCanvas: gpuCanvas ? undefined : outputCanvas };
}
