import { Vector2 } from '../math/vector2.ts';
import { listen } from '../math/observed.ts';
import type { ColorSpace, Filter, Wrap } from '../constants/index.ts';

let nextTexture = 1;

/**
 * An image and how it is sampled, in a page's words (`wrap`, `filter`, `colorSpace`). Any write
 * reaches the materials that sample it.
 */
export class Texture {
  /** Always `true`: tells a texture apart from anything else. */
  readonly isTexture = true as const;
  /** A name unique to this texture. */
  readonly id = `texture-${nextTexture++}`;
  /** A name for the page's own use. */
  name = '';
  /** How the picture repeats left to right. */
  wrapS: Wrap = 'clamp';
  /** How the picture repeats bottom to top. */
  wrapT: Wrap = 'clamp';
  /** How many times the picture fits across and up. */
  readonly repeat = new Vector2(1, 1);
  /** How far the picture is slid, across and up. */
  readonly offset = new Vector2(0, 0);
  /** How far the picture is turned, in radians. */
  rotation = 0;
  /** How pixels are picked when the picture looks smaller than it is. */
  minFilter: Filter = 'linearMipLinear';
  /** How pixels are picked when the picture looks bigger than it is. */
  magFilter: Filter = 'linear';
  /** Whether the numbers are colours (`'srgb'`) or plain values (`'linear'`). */
  colorSpace: ColorSpace = 'srgb';
  /** Whether the picture is turned upside down when read. */
  flipY = true;
  /** How sharp the picture stays when seen at a slant. */
  anisotropy = 1;
  /** Which set of UVs of the geometry the texture follows. */
  channel = 0;
  /** Bumped by every write: what a material compares to resample. */
  version = 0;
  readonly _listeners = new Set<() => void>();

  /** The picture itself: an image, a canvas, a video or raw pixels. */
  image: unknown;
  /** What the image holds beyond its pixels: `'cube'`, `'array'`, `'depth'`, `'compressed'`. */
  readonly layout: string;
  /** How each pixel is stored: `'rgba'`, `'rgb'`, `'r'`, `'depth'`… */
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
  /** Width of the picture, in pixels. */
  get width(): number {
    return (this.image as { width?: number } | null)?.width ?? 0;
  }
  /** Height of the picture, in pixels. */
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
  /** A new texture showing the same picture with the same settings. */
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
