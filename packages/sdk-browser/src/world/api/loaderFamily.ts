import { checked } from '../../cluster/checked.ts'
import { decodeRaw, imageElement } from '../../texture/decode.ts'
import { texture } from '../texture/index.ts'

/** The picture at `url`, fetched and decoded by the engine's one decoder. */
const rawBitmap = async (url: string) => decodeRaw(await (await checked(url)).blob())

/**
 * The `loader` family: files fetched and turned into what a scene uses. A file is read through
 * the engine's checked fetch (`cluster/checked.ts`), which refuses a failed response by its status;
 * a picture (`texture`, `cubeTexture`) is fetched by an image element, which refuses one by
 * failing to decode.
 */
export const loader = {
  /**
   * Fetches a picture and makes a colour texture of it.
   * @param url - Where the picture is.
   */
  texture: async (url: string) => texture.image(await imageElement(url)),
  /**
   * Fetches six pictures and makes a cube texture: faces `+x, -x, +y, -y, +z, -z`.
   * @param urls - Where the six pictures are.
   */
  cubeTexture: async (urls: string[]) => texture.cube(await Promise.all(urls.map(imageElement))),
  /**
   * Fetches a picture and decodes it into an `ImageBitmap`, by the engine's one decoder
   * (`texture/decode.ts`): the pixels the file stores, neither colour-converted nor premultiplied.
   * @param url - Where the picture is.
   */
  imageBitmap: rawBitmap,
  /**
   * Fetches a file as text, bytes or JSON.
   * @param url - Where the file is.
   * @param as - How to read it: text, bytes or JSON.
   */
  async file(url: string, as: 'text' | 'arraybuffer' | 'json' = 'text') {
    const response = await checked(url)
    return as === 'json'
      ? response.json()
      : as === 'arraybuffer'
        ? response.arrayBuffer()
        : response.text()
  },
  /**
   * An image file read as linear RGBA numbers: a data texture. Its picture is the bitmap the
   * engine's one decoder gives (`imageBitmap`), copied to the GPU as the file stores it — no canvas
   * between, which would premultiply it and lose the colour of a transparent pixel: a normal,
   * roughness or packed mask map keeps every number, its alpha too.
   * @param url - Where the picture is.
   */
  async data(url: string) {
    const map = texture.image(await rawBitmap(url))
    map.colorSpace = 'linear'
    map.flipY = false
    return map
  },
}
