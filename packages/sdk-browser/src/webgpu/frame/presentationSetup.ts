import { createGpuPresenter } from '../../gpu/core/presentation.ts';

/**
 * Presentation surface of the WebGPU engine. With a host canvas, the engine configures it and
 * presents into it. Without one, it presents into a canvas of its own, which it publishes as
 * `presentedSurface`: a host whose surface is WebGL2 composes from that canvas
 * (`createBackendPresenter`), and the engine builds no object of the host's rendering library to get
 * its image across.
 */
export function prepareWebgpuPresentation(
  device: GPUDevice,
  gpuCanvas: HTMLCanvasElement | undefined,
) {
  const outputCanvas =
    gpuCanvas ?? (typeof document !== 'undefined' ? document.createElement('canvas') : undefined);
  return outputCanvas ? createGpuPresenter(device, outputCanvas) : undefined;
}
