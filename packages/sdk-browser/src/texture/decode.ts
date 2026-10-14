/**
 * The engine's one image decoder: every image it samples — a source image of a prepared scene, a
 * lossless baked level, a picture the loader reads as data — is decoded by `decodeRaw`, so the
 * bytes that reach the atlas by one path are those that reach it by another. A platform without
 * `createImageBitmap` decodes through an image element (`imageElement`). An image at an address is
 * fetched and decoded by `fetchDecoded`, the one path of both.
 */
import { type ByteMeter, unmetered } from '../cluster/byteMeter.ts'
import { checked } from '../cluster/checked.ts'

/** Decode options of every image the engine samples: pixels as the file stores them, neither
 *  premultiplied nor colour-converted. */
const RAW_BITMAP: ImageBitmapOptions = {
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
}

/** `blob` decoded by the browser, off the main thread, as the file stores its pixels. */
export const decodeRaw = (blob: Blob) => createImageBitmap(blob, RAW_BITMAP)

/** The image at `url`, fetched (`checked`, at most `attempts` requests), its body counted by
 *  `meter` once accepted — a refused body is never read, so its length never joins the total —,
 *  and decoded raw. */
export async function fetchDecoded(
  url: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter = unmetered,
  attempts?: number,
) {
  const response = await checked(url, signal, attempts)
  return decodeRaw(await meter.read(response, url).blob())
}

/** An image element holding `url`, decoded: fetched across origins anonymously, unless the
 *  address carries its own bytes (`data:`). */
export async function imageElement(url: string) {
  const image = new Image()
  if (!url.startsWith('data:')) image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  return image
}
