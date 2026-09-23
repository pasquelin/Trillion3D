import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';

/** Pixels held in memory, with the size they span: what a data texture samples. */
export type PixelImage = {
  /** The pixel values, row after row. */
  data: ArrayBufferView;
  /** Pixels in one row. */
  width: number;
  /** Rows in one layer. */
  height: number;
  /** Layers, for a stack of images. */
  depth?: number;
};

/** A texture whose image is `image`, the sampling words left at their defaults. */
const of = (image: unknown, layout?: string, format?: string) => new Texture(image, layout, format);

/**
 * The `texture` family: an image and how it is sampled. Colour images are sRGB, data images are
 * linear; `needsUpdate` after writing the pixels makes the samplers read them again.
 */
export const texture = {
  /**
   * A colour texture from a picture already in the page: an image, a bitmap or a video frame.
   * @param source - An image, a bitmap or a video frame already in the page.
   */
  image: (source: TexImageSource) => of(source),
  /**
   * A texture from raw pixels in memory, read as plain numbers rather than colours.
   * @param pixels - The pixel values, row after row.
   * @param width - Pixels in a row.
   * @param height - Rows.
   * @param format - Which channels each pixel has.
   */
  data(
    pixels: ArrayBufferView,
    width: number,
    height: number,
    format: 'rgba' | 'rgb' | 'r' = 'rgba',
  ) {
    const t = of({ data: pixels, width, height } satisfies PixelImage, 'data', format);
    t.colorSpace = 'linear';
    t.flipY = false;
    return t;
  },
  /**
   * A texture that shows what a canvas holds.
   * @param c - The canvas to show.
   */
  canvas: (c: HTMLCanvasElement | OffscreenCanvas) => of(c),
  /**
   * A texture that shows a playing video.
   * @param v - The video to show.
   */
  video: (v: HTMLVideoElement) => of(v),
  /**
   * A texture that keeps depth instead of colour.
   * @param width - Pixels in a row.
   * @param height - Rows.
   */
  depth: (width: number, height: number) => of({ data: null, width, height }, 'depth', 'depth'),
  /**
   * A cube texture from six pictures already loaded, in the order `+x, -x, +y, -y, +z, -z`.
   * @param faces - The six pictures.
   */
  cube: (faces: TexImageSource[]) => of(faces, 'cube'),
  /**
   * A stack of same-size images in one texture, one layer each.
   * @param pixels - The pixel values of every layer, one after the other.
   * @param width - Pixels in a row.
   * @param height - Rows in a layer.
   * @param depth - Layers.
   */
  array: (pixels: ArrayBufferView, width: number, height: number, depth: number) =>
    of({ data: pixels, width, height, depth } satisfies PixelImage, 'array'),
  /**
   * A texture already compressed, with its smaller copies given by hand.
   * @param mipmaps - The compressed picture at each size, largest first.
   * @param width - Pixels in a row.
   * @param height - Rows.
   * @param format - The compression format.
   */
  compressed: (
    mipmaps: { data: ArrayBufferView; width: number; height: number }[],
    width: number,
    height: number,
    format: string,
  ) => of({ mipmaps, width, height }, 'compressed', format),
};

export { Texture };
