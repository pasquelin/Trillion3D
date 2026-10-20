/**
 * The engine's one image decoder: every image it samples — a source image of a prepared scene, a
 * lossless baked level, a picture the loader reads as data — is decoded by `decodeRaw`, so the
 * bytes that reach the atlas by one path are those that reach it by another. An image at an
 * address is fetched and decoded by `fetchDecoded`, the one path of both. The engine needs
 * `createImageBitmap`, which every browser that runs WebGPU has: no other decoder stands in.
 */
import { type ByteMeter, unmetered } from '../cluster/byteMeter.ts'
import { checked } from '../cluster/checked.ts'

/** Decode options of every image the engine samples: pixels as the file stores them, neither
 *  premultiplied nor colour-converted. */
const RAW_BITMAP: ImageBitmapOptions = {
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
}

/** `blob` decoded by the browser, off the main thread, as the file stores its pixels. A vector
 *  picture has no pixels stored: `createImageBitmap` refuses an SVG file, so an image element draws
 *  it at its own size first, and that drawing is the bitmap's source. */
export async function decodeRaw(blob: Blob) {
  if (!blob.type.startsWith('image/svg+xml')) return createImageBitmap(blob, RAW_BITMAP)
  const url = URL.createObjectURL(blob)
  try {
    const drawing = new Image()
    drawing.src = url
    await drawing.decode()
    return await createImageBitmap(drawing, RAW_BITMAP)
  } finally {
    URL.revokeObjectURL(url)
  }
}

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
