import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Color } from '../../../../sdk-core/src/world/math/color.ts';
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import type { LoadedModel } from './loadedModel.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { saveScene } from '../saved/write.ts';
import { readScene } from '../saved/read.ts';
import type { SavedScene } from '../saved/format.ts';

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
}

/**
 * The root of a world's scene: objects are added to it, a compiled model is loaded into it, and
 * what fills the image behind them is `background`.
 */
export class Scene extends Object3D {
  /** Always `true`: tells the scene root apart from any other object. */
  readonly isScene = true as const;
  private _background: Color | Texture | null = null;
  /** A picture of the surroundings that shiny surfaces reflect; `null` for none. */
  environment: Texture | null = null;
  /** Fog that fades objects into `color` between `near` and `far`; `null` for none. */
  fog: { color: Color; near: number; far: number } | null = null;

  private readonly loader: (url: string, options: LoadOptions) => Promise<LoadedModel>;
  constructor(loader: (url: string, options: LoadOptions) => Promise<LoadedModel>) {
    super();
    this.loader = loader;
    this.type = 'Scene';
  }
  /** What fills the image behind every object: a colour, a picture, or `null` for the default. */
  get background() {
    return this._background;
  }
  set background(value: Color | Texture | null) {
    this._background = value;
    this._link?.structure(this);
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
