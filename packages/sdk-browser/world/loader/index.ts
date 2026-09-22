import { checked } from '../../clusterPages.ts';
import { texture } from '../texture/index.ts';

/** An image element holding the picture at `url`, decoded. */
async function picture(url: string) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  return image;
}

/**
 * The `loader` family: files fetched and turned into what a scene uses. A file is read through
 * the engine's checked fetch (`clusterPages.ts`), which refuses a failed response by its status;
 * a picture (`texture`, `cubeTexture`) is fetched by an image element, which refuses one by
 * failing to decode.
 */
export const loader = {
  texture: async (url: string) => texture.image(await picture(url)),
  /** Six faces, in the order `+x, -x, +y, -y, +z, -z`. */
  cubeTexture: async (urls: string[]) => texture.cube(await Promise.all(urls.map(picture))),
  imageBitmap: async (url: string) => createImageBitmap(await (await checked(url)).blob()),
  async file(url: string, as: 'text' | 'arraybuffer' | 'json' = 'text') {
    const response = await checked(url);
    return as === 'json'
      ? response.json()
      : as === 'arraybuffer'
        ? response.arrayBuffer()
        : response.text();
  },
  /** An image file read as linear RGBA pixels: a data texture. */
  async data(url: string) {
    const bitmap = await loader.imageBitmap(url);
    const page = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = page.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return texture.data(new Uint8Array(data.buffer), bitmap.width, bitmap.height);
  },
};
