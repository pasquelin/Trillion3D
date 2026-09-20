import { EngineError } from '../sdk-core/index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import type { ExplorerOptions } from './explorerOptions.ts';

/** CSS owns layout; drawing-buffer attributes must never resize the observed layout. */
export function interactiveSize(canvas: HTMLCanvasElement, options: ExplorerOptions) {
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

export function interactiveOptions(canvas: HTMLCanvasElement, options: ExplorerOptions) {
  if (!options.interactive) return options;
  if (!canvas.ownerDocument.defaultView)
    throw new EngineError('CANVAS_WINDOW_UNAVAILABLE', 'Interactive rendering requires a window');
  return {
    ...options,
    ...interactiveSize(canvas, options),
    backends: options.backends ?? (options.autonomousGeometry ? undefined : [webgpuPagesBackend]),
  };
}

/** Preserve manual backend selection; the simple WebGPU path never silently changes capabilities. */
export function directWebgpu(options: ExplorerOptions, device: GPUDevice | undefined) {
  const requested = options.backends?.length === 1 && options.backends[0] === webgpuPagesBackend;
  if (options.interactive && requested && !device)
    throw new EngineError(
      'WEBGPU_UNAVAILABLE',
      'Interactive startup requires WebGPU; choose an explicit backend for another capability set',
    );
  return !!device && requested;
}
