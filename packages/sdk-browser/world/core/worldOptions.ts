import type { MeasuredWorldOptions } from '../../explorerOptions.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import type { WorldControls } from './worldCamera.ts';

/** What a page may set when it creates a world; saying nothing is the normal case. */
export interface WorldOptions {
  /** Absent: the best path the machine grants. Forced and missing: refused by its name. */
  renderer?: WorldRenderer;
  /** True by default: the world owns the loop and pauses after 120 stable frames. */
  interactive?: boolean;
  pixelRatio?: number;
  /** The controller driving the camera from the canvas; `'none'` by default. */
  controls?: WorldControls;
  signal?: AbortSignal;
}

/**
 * The options of every session a world opens: what the page set at creation, and what the world
 * holds at the moment — its device, its settings, its hooks. No imported light and no controller
 * of the session's own: a model's lights are nodes of the scene (`LoadedModel.lights`) and the
 * camera's controller is the world's, both written by the world itself.
 */
export const sessionOptions = (
  options: WorldOptions,
  held: Partial<MeasuredWorldOptions>,
): MeasuredWorldOptions => ({
  manifestUrl: '',
  interactive: options.interactive !== false,
  renderer: options.renderer,
  // A world the page leads draws at the screen's density too: the session's own loop, which
  // follows the density as it changes, is the only one that may leave it unset.
  pixelRatio:
    options.pixelRatio ?? (options.interactive === false ? globalThis.devicePixelRatio : undefined),
  signal: options.signal,
  importedLights: false,
  ownControls: false,
  ...held,
});
