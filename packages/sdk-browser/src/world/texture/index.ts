import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';

/** Pixels held in memory, with the size they span: what a data texture samples. */
export type PixelImage = { data: ArrayBufferView; width: number; height: number; depth?: number };

/** A texture whose image is `image`, the sampling words left at their defaults. */
const of = (image: unknown, layout?: string, format?: string) => new Texture(image, layout, format);

/**
 * The `texture` family: an image and how it is sampled. Colour images are sRGB, data images are
 * linear; `needsUpdate` after writing the pixels makes the samplers read them again.
 */
export const texture = {
  image: (source: TexImageSource) => of(source),
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
  canvas: (c: HTMLCanvasElement | OffscreenCanvas) => of(c),
  video: (v: HTMLVideoElement) => of(v),
  depth: (width: number, height: number) => of({ data: null, width, height }, 'depth', 'depth'),
  /** Six faces, in the order `+x, -x, +y, -y, +z, -z`. */
  cube: (faces: TexImageSource[]) => of(faces, 'cube'),
  array: (pixels: ArrayBufferView, width: number, height: number, depth: number) =>
    of({ data: pixels, width, height, depth } satisfies PixelImage, 'array'),
  compressed: (
    mipmaps: { data: ArrayBufferView; width: number; height: number }[],
    width: number,
    height: number,
    format: string,
  ) => of({ mipmaps, width, height }, 'compressed', format),
};

export { Texture };
