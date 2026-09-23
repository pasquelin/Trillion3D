import { EngineError } from '../sdk-core/src/index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import type { BackendFactory } from './backendTypes.ts';
import type { MeasuredWorldOptions } from './explorerOptions.ts';

/** CSS owns layout; drawing-buffer attributes must never resize the observed layout. */
export function interactiveSize(canvas: HTMLCanvasElement, options: MeasuredWorldOptions) {
  const width = options.width ?? Math.floor(canvas.clientWidth);
  const height = options.height ?? Math.floor(canvas.clientHeight);
  const pixelRatio = options.pixelRatio ?? canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new EngineError(
      'INVALID_VIEWPORT',
      'Give the canvas a positive CSS size or explicit dimensions',
    );
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0)
    throw new EngineError('INVALID_PIXEL_RATIO', 'Pixel ratio must be finite and positive');
  if (Math.floor(width * pixelRatio) < 1 || Math.floor(height * pixelRatio) < 1)
    throw new EngineError(
      'INVALID_VIEWPORT',
      'Canvas drawing buffer must contain at least one pixel',
    );
  return { width, height, pixelRatio };
}

export function interactiveOptions(canvas: HTMLCanvasElement, options: MeasuredWorldOptions) {
  if (!options.interactive) return options;
  if (!canvas.ownerDocument.defaultView)
    throw new EngineError('CANVAS_WINDOW_UNAVAILABLE', 'Interactive rendering requires a window');
  // No backend is forced here: `chooseBackends` reads the machine and takes the engine path
  // it allows, so an interactive host without WebGPU falls back instead of failing.
  return { ...options, ...interactiveSize(canvas, options) };
}

/** The WebGPU page raster presents its own surface when it is the session's only engine. A host
 *  that named it explicitly and got no device is refused by name: an explicit backend list never
 *  silently changes capabilities. A host that named nothing is served the fallback instead. */
export function directWebgpu(
  options: MeasuredWorldOptions,
  factories: BackendFactory[],
  device: GPUDevice | undefined,
) {
  const requested = factories.length === 1 && factories[0] === webgpuPagesBackend;
  if (options.interactive && options.backends && requested && !device)
    throw new EngineError(
      'WEBGPU_UNAVAILABLE',
      'Interactive startup requires WebGPU; choose an explicit backend for another capability set',
    );
  return !!device && requested;
}
