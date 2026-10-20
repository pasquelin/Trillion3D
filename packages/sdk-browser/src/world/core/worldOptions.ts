import type { MeasuredWorldOptions } from '../session/options.ts'
import type { WorldControls } from './worldCamera.ts'
import type { WorldPhysicsOptions } from '../../physics/worldPhysicsOptions.ts'
import type { RenderScale } from '../../frame/renderScaleOption.ts'
import type { WorldQualityOptions } from './worldQuality.ts'

/** What a page may set when it creates a world; saying nothing is the normal case. */
export interface WorldOptions {
  /**
   * Whether the world runs its own loop: it draws when something changes and rests after 120
   * frames with nothing new. `false` lets the page call `world.render()` itself.
   * @defaultValue true
   */
  interactive?: boolean
  /** How many image pixels per screen pixel. @defaultValue the screen's own density */
  pixelRatio?: number
  /** The controller that moves the camera from the canvas; `world.controls.kind` changes it later.
   *  `'vehicle'` throws `NO_VEHICLE` here: no vehicle is set before the world exists — set
   *  `world.controls.vehicle`, then `kind`. @defaultValue 'none' */
  controls?: WorldControls
  /** Stops the world's loads when the signal is aborted. */
  signal?: AbortSignal
  /** Turns the physics on (`world.physics`): `true`, or gravity and budgets. Jolt is fetched only
   *  then. @defaultValue false */
  physics?: boolean | WorldPhysicsOptions
  /** Temporal antialiasing: sub-pixel jitter accumulated over frames, at a quality level —
   *  `'off'`, `'low'`, `'medium'`, `'high'`, `'max'` —, `true` the default level. `false` or
   *  `'off'` draws each pixel at its centre, with no history, what a pixel-exact capture asks.
   *  Named here, it holds over the quality preset and a scene's level; switched later by
   *  `world.temporalAntialiasing`. @defaultValue none: the preset's level, else the first loaded
   *  scene's, else `'max'` */
  temporalAntialiasing?: import('../../../../sdk-core/src/contracts/materialOptions.ts').TemporalAntialiasingOption
  /** The fraction of the display per axis the image is drawn at, before temporal antialiasing
   *  rebuilds it to the display: `'auto'` lets the frame budget choose it between `min` and `max`
   *  (`{ min, max }`, 0.5 and the display's default by default — 0.5 on a 3840×2160
   *  drawing buffer, 1 on a 720-tall one, `displayResolutionFraction`), a number fixes it, 1 the
   *  display's own size. A still image is drawn at that
   *  scale too, the budget's, and held once whole cycles of its jitter phases are averaged.
   *  Changed later by `world.renderScale`. @defaultValue 'auto' */
  renderScale?: RenderScale
  /** The most frames a second the world draws, even while its scene moves: a frame is drawn on a
   *  whole number of display refreshes, the fastest such rate at or under it (12 on a 60 Hz
   *  display: one refresh in five), each image shown for the same time; the ticks between draw
   *  and count nothing. A page of several worlds caps those out of focus. Changed later by
   *  `world.maxFrameRate`. @defaultValue Infinity, the display's rate */
  maxFrameRate?: number
  /** The quality: a preset, groups at levels of their own, the resolution (`world.quality`).
   *  @defaultValue every group at `'max'`, today's defaults; the native resolution, dynamic */
  quality?: WorldQualityOptions
  /** Debug mode, a development build's tools against a shipping build: the frames are filed
   *  into the CPU step profile (`world.cpuSteps`) and the frame report only in it. It is the
   *  page's, as `?profile` in its address turns it on; `world.diagnostic.debug` switches it later.
   *  @defaultValue false */
  debug?: boolean
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
  // Unset, the screen's density, followed as it changes whoever leads (`canvasFollower`).
  pixelRatio: options.pixelRatio,
  signal: options.signal,
  importedLights: false,
  ...held,
})
