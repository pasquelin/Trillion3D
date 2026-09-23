import type { MeasuredWorldOptions } from '../session/options.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import type { WorldControls } from './worldCamera.ts';

/** What a page may set when it creates a world; saying nothing is the normal case. */
export interface WorldOptions {
  /**
   * How the world draws, `'webgpu'` or `'webgl2'`. Left out, the world takes the best the machine
   * grants; a renderer the machine lacks is refused by its name, never swapped for the other.
   * @defaultValue the best the machine grants
   */
  renderer?: WorldRenderer;
  /**
   * Whether the world runs its own loop: it draws when something changes and rests after 120
   * frames with nothing new. `false` lets the page call `world.render()` itself.
   * @defaultValue true
   */
  interactive?: boolean;
  /** How many image pixels per screen pixel. @defaultValue the screen's own density */
  pixelRatio?: number;
  /** The controller that moves the camera from the canvas; `world.controls.kind` changes it later.
   *  @defaultValue 'none' */
  controls?: WorldControls;
  /** Stops the world's loads when the signal is aborted. */
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
