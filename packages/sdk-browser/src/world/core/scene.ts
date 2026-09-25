import { Object3D, type SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts';
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import type { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { listen, unlisten } from '../../../../sdk-core/src/world/math/observed.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import type { LoadedModel } from './loadedModel.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { saveScene } from '../saved/write.ts';
import { readScene } from '../saved/read.ts';
import type { SavedScene } from '../saved/format.ts';
import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs.ts';
import { validateSceneFog } from '../../../../sdk-core/src/scene/core/fog.ts';
import { sceneFogOf, type Fog } from './sceneFog.ts';
export { sceneFogOf };

/** What `scene.load` may be told about the model it loads; every field is optional. */
export interface LoadOptions {
  /** Stops the load when the signal is aborted. */
  signal?: AbortSignal;
  /** `'full'` requires the whole cache, `'progressive'` its streamed slice; a model of another
   *  scope is refused by name. Unset, the model is read at the scope its pointer declares. */
  scope?: 'full' | 'progressive';
  /** A streamer the page configured; the world's session streams with its own. */
  stream?: unknown;
  /** Where the model's origin goes in the scene. */
  position?: readonly [number, number, number] | { x: number; y: number; z: number };
  /** Hears how far the load has got: `bytes` at each chunk of every file read, up to
   *  `completed === total`; `manifest` once the manifest is read, `tables` once the scene tables
   *  are, then `resources` as each file the scene reads lands (`completed` of `total` known so
   *  far). The event is a `JobProgress`: a `createJob` wrapping the load passes its `progress`
   *  here, and `world.awaitPages` hears the first pages on the same shape. */
  onProgress?: (event: JobProgress) => void;
}

/** What a world hears from its scene: a node's changes, its background and its fog set or
 *  written. */
export type WorldSceneLink = SceneLink & { background(): void; fog(): void };

/**
 * The root of a world's scene: objects are added to it, a compiled model is loaded into it, and
 * what fills the image behind them is `background`.
 */
export class Scene extends Object3D {
  /** Always `true`: tells the scene root apart from any other object. */
  readonly isScene = true as const;
  private _background: Color | null = null;
  /** Tells the world the background changed, chained on the colour to hear writes in place. */
  private readonly recoloured = () => (this._link as WorldSceneLink | null)?.background();
  /** A picture of the surroundings that shiny surfaces reflect; `null` for none. */
  environment: Texture | null = null;
  private _fog: Fog | null = null;
  /** Tells the world the fog changed, chained on its colour to hear writes in place. */
  private readonly refogged = () => (this._link as WorldSceneLink | null)?.fog();

  private readonly loader: (url: string, options: LoadOptions) => Promise<LoadedModel>;
  constructor(loader: (url: string, options: LoadOptions) => Promise<LoadedModel>) {
    super();
    this.loader = loader;
    this.type = 'Scene';
  }
  /** Refused: a world has one scene root, never cloned. */
  protected override blank(): this {
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'A Scene cannot be cloned: a world has one');
  }
  /** What fills the image behind every object: a colour, or `null` for the default. A change
   *  shows at the next frame, the session kept: a new colour set here, or the one held written
   *  through its methods (`set`, `setRGB`, `setHex`, `setHSL`...). A direct write of `.r`, `.g`
   *  or `.b` is not heard: set `background` again after one. A picture, or any value without
   *  `getHex`, is refused (`UNSUPPORTED_SCENE_UPDATE`): no path draws one. */
  get background() {
    return this._background;
  }
  set background(value: Color | null) {
    if (value != null && typeof (value as { getHex?: unknown }).getHex !== 'function')
      throw new EngineError(
        'UNSUPPORTED_SCENE_UPDATE',
        'scene.background takes a colour or null: a picture background is not drawn',
      );
    if (this._background) unlisten(this._background, this.recoloured);
    this._background = value ?? null;
    if (value) listen(value, this.recoloured);
    this.recoloured();
  }
  /** Fog over every surface, opaque and transparent, on both renderers; `null`, the default,
   *  for none, at no cost. `{ color, near, far }` fades objects into `color` from `near` to `far`,
   *  distances from the camera; `{ color, density }` thickens by `density` per unit of distance;
   *  add `heightFalloff` (and `baseHeight`, 0 by default) and it lies on the ground, thinning out
   *  above `baseHeight` — divided by e every `1 / heightFalloff` units up. A change shows at the
   *  next frame: a new fog set here, or its colour written through its methods. A direct write of
   *  `near`, `far`, `density`... is not heard: set `fog` again after one. A fog out of range —
   *  `far` not beyond `near`, a negative density — is refused (`INVALID_SCENE_ENVIRONMENT`). */
  get fog() {
    return this._fog;
  }
  set fog(value: Fog | null) {
    if (value) validateSceneFog(sceneFogOf(value)!);
    if (this._fog) unlisten(this._fog.color, this.refogged);
    this._fog = value ?? null;
    if (value) listen(value.color, this.refogged);
    this.refogged();
  }
  /** Loads a compiled model — its manifest URL — and adds it to this scene. */
  async load(manifestUrl: string, options: LoadOptions = {}) {
    const model = await this.loader(manifestUrl, options);
    const at = options.position;
    if (at) {
      if (Array.isArray(at)) model.position.set(at[0], at[1], at[2]);
      else model.position.copy(at as { x: number; y: number; z: number });
    }
    this.add(model);
    return model;
  }
  /** The scene as plain JSON, versioned: its objects, shapes by the call that built them,
   *  materials, lights and loaded models by address; `camera`'s pose too when one is given.
   *  @param camera - A camera to save with the scene, `world.camera` most often. */
  toJSON(camera?: Camera): SavedScene {
    return saveScene(this, camera);
  }
  /** Replaces what the scene holds with a scene `toJSON` saved, its `helper` marks kept;
   *  resolves once its models are loaded. Another format or version is refused
   *  (`UNSUPPORTED_SCENE_FORMAT`). Calls made while one is reading run one after the other, in
   *  order, each on what the one before left: two saved scenes never merge.
   *  @param json - The saved scene. @param camera - A camera to put where the scene was saved from. */
  fromJSON(json: unknown, camera?: Camera) {
    const read = () => readScene(this, json, camera);
    const next = this.reading.then(read, read);
    this.reading = next.catch(() => undefined);
    return next;
  }
  /** The last `fromJSON` under way, settled or not: the next one waits for it. */
  private reading: Promise<void> = Promise.resolve();
}
