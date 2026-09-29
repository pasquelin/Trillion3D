import type { RenderScale } from '../../frame/renderScaleOption.ts';
import { createScaleControl } from '../../frame/scaleControl.ts';
import type { BackendContext } from '../types.ts';

/**
 * WebGL2's render scale (#834): the same setting and controller as WebGPU's
 * (`../../frame/scaleControl.ts`), the image drawn at it and resampled spatially by
 * the composer (`../../world/render/renderScale.ts`). WebGL2 keeps no history to reconstruct from,
 * so a resampled image is a loss: its default minimum is 1 — `'auto'` holds the display's size —
 * and only a page that names a lower minimum, or a fixed scale, draws below it. The capability
 * `temporal upscaling` stays unsupported (`./capabilities.ts`).
 */
export function autonomousRenderScale(context: Pick<BackendContext, 'renderScale'>) {
  const control = createScaleControl(context.renderScale, 1);
  return {
    renderScaleControl: control,
    setRenderScale: (scale: RenderScale) => control.set(scale),
    renderScale: () => control.drawn,
  };
}
