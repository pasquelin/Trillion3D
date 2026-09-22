import { Vector2 } from '../math/vector2.ts';
import { listen } from '../math/observed.ts';
import type { ColorSpace, Filter, Wrap } from '../constants/index.ts';

let nextTexture = 1;

/**
 * An image and how it is sampled, in a page's words (`wrap`, `filter`, `colorSpace`). Any write
 * reaches the materials that sample it.
 */
export class Texture {
  readonly isTexture = true as const;
  readonly id = `texture-${nextTexture++}`;
  name = '';
  wrapS: Wrap = 'clamp';
  wrapT: Wrap = 'clamp';
  readonly repeat = new Vector2(1, 1);
  readonly offset = new Vector2(0, 0);
  rotation = 0;
  minFilter: Filter = 'linearMipLinear';
  magFilter: Filter = 'linear';
  colorSpace: ColorSpace = 'srgb';
  flipY = true;
  anisotropy = 1;
  channel = 0;
  /** Bumped by every write: what a material compares to resample. */
  version = 0;
  readonly _listeners = new Set<() => void>();

  image: unknown;
  /** What the image holds beyond its pixels: `'cube'`, `'array'`, `'depth'`, `'compressed'`. */
  readonly layout: string;
  readonly format: string;
  constructor(image: unknown, layout = '2d', format = 'rgba') {
    this.image = image;
    this.layout = layout;
    this.format = format;
    const changed = () => this.touch();
    listen(this.repeat, changed);
    listen(this.offset, changed);
    // A sampling word written after creation reaches the materials that sample this texture.
    return new Proxy(this, {
      set(target, key, value) {
        Reflect.set(target, key, value);
        if (key !== 'version') target.touch();
        return true;
      },
    });
  }
  /** Both wrap modes at once. */
  get wrap(): Wrap {
    return this.wrapS;
  }
  set wrap(mode: Wrap) {
    this.wrapS = this.wrapT = mode;
    this.touch();
  }
  get width(): number {
    return (this.image as { width?: number } | null)?.width ?? 0;
  }
  get height(): number {
    return (this.image as { height?: number } | null)?.height ?? 0;
  }
  /** `texture.needsUpdate = true` after changing the image or a field: the samplers re-read it. */
  set needsUpdate(value: boolean) {
    if (value) this.touch();
  }
  get needsUpdate() {
    return false;
  }
  private touch() {
    this.version++;
    for (const listener of this._listeners) listener();
  }
  clone() {
    const copy = new Texture(this.image, this.layout, this.format);
    const { name, wrapS, wrapT, rotation, minFilter, magFilter, colorSpace, flipY } = this;
    Object.assign(copy, { name, wrapS, wrapT, rotation, minFilter, magFilter, colorSpace, flipY });
    copy.anisotropy = this.anisotropy;
    copy.channel = this.channel;
    copy.repeat.copy(this.repeat);
    copy.offset.copy(this.offset);
    return copy;
  }
  /** Forgets the materials sampling it. */
  dispose() {
    this._listeners.clear();
  }
}
