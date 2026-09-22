import { Object3D } from '../../../sdk-core/world/object/object3d.ts';
import type { Color } from '../../../sdk-core/world/math/color.ts';
import type { Texture } from '../../../sdk-core/world/texture/texture.ts';
import type { LoadedModel } from './loadedModel.ts';

export interface LoadOptions {
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
  readonly isScene = true as const;
  private _background: Color | Texture | null = null;
  environment: Texture | null = null;
  fog: { color: Color; near: number; far: number } | null = null;

  private readonly loader: (url: string, options: LoadOptions) => Promise<LoadedModel>;
  constructor(loader: (url: string, options: LoadOptions) => Promise<LoadedModel>) {
    super();
    this.loader = loader;
    this.type = 'Scene';
  }
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
}
