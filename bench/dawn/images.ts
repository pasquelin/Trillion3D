// The browser's image decoding in the bench's Node process: `createImageBitmap`, `Image` and a 2D
// `OffscreenCanvas` that reads pixels back, as the engine's loaders use them. PNG is decoded by the
// bench's reader (`pngRead.ts`); JPEG, WebP and the rest by macOS's `sips`, once per file content. The
// pixels are the file's, with no colour conversion and no premultiplication unless asked.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { measureOutput } from '../core/paths.ts'
import { readPng } from './pngRead.ts'

/** A decoded image: its size and its RGBA rows, top row first. */
export class BenchBitmap {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
  constructor(width: number, height: number, rgba: Uint8Array) {
    this.width = width
    this.height = height
    this.rgba = rgba
  }
  close() {}
}

const PNG = [137, 80, 78, 71]

/** `bytes` decoded: PNG at once, anything else through `sips` to a PNG kept by its content. */
function decode(bytes: Uint8Array) {
  if (PNG.every((byte, i) => bytes[i] === byte)) return readPng(bytes)
  const dir = measureOutput('bench-gpu', 'images')
  mkdirSync(dir, { recursive: true })
  const name = createHash('sha256').update(bytes).digest('hex').slice(0, 24)
  const png = join(dir, `${name}.png`)
  if (!existsSync(png)) {
    const source = join(dir, `${name}.source`)
    writeFileSync(source, bytes)
    execFileSync('sips', ['-s', 'format', 'png', source, '--out', png], { stdio: 'ignore' })
  }
  return readPng(readFileSync(png))
}

/** A bitmap's pixels as a copy or a decode asks them — rows bottom up, alpha multiplied in, red
 *  and blue swapped (a BGRA texture) — made once per bitmap and asking: a texture's tiles copy one
 *  bitmap region by region. The bitmap's own rows when nothing is asked. */
const shaped = new WeakMap<BenchBitmap, Map<number, Uint8Array>>()
export function shapedPixels(
  bitmap: BenchBitmap,
  flip: boolean,
  premultiply: boolean,
  swap: boolean,
) {
  const key = +flip | (+premultiply << 1) | (+swap << 2)
  if (!key) return bitmap.rgba
  const held = shaped.get(bitmap) ?? new Map<number, Uint8Array>()
  shaped.set(bitmap, held)
  const known = held.get(key)
  if (known) return known
  const { width, height, rgba } = bitmap
  const row = width * 4,
    out = new Uint8Array(rgba.length)
  for (let y = 0; y < height; y++)
    out.set(rgba.subarray(y * row, (y + 1) * row), (flip ? height - 1 - y : y) * row)
  if (premultiply || swap)
    for (let i = 0; i < out.length; i += 4) {
      const a = premultiply ? out[i + 3] : 255,
        r = out[i],
        b = out[i + 2]
      out[i] = Math.round(((swap ? b : r) * a) / 255)
      out[i + 1] = Math.round((out[i + 1] * a) / 255)
      out[i + 2] = Math.round(((swap ? r : b) * a) / 255)
    }
  held.set(key, out)
  return out
}

/** The browser's `createImageBitmap(source, options)` for a blob, bytes or another bitmap. */
export async function createImageBitmap(source: unknown, options: ImageBitmapOptions = {}) {
  let bitmap: BenchBitmap
  if (source instanceof BenchBitmap) bitmap = source
  else if (source instanceof BenchImage) bitmap = await source.bitmap()
  else {
    const bytes =
      source instanceof Blob
        ? new Uint8Array(await source.arrayBuffer())
        : source instanceof ArrayBuffer
          ? new Uint8Array(source)
          : (source as Uint8Array)
    const { width, height, rgba } = decode(bytes)
    bitmap = new BenchBitmap(width, height, rgba)
  }
  const flip = options.imageOrientation === 'flipY',
    premultiply = options.premultiplyAlpha === 'premultiply'
  return flip || premultiply
    ? new BenchBitmap(bitmap.width, bitmap.height, shapedPixels(bitmap, flip, premultiply, false))
    : bitmap
}

/** The browser's `Image`: `src` set, then `decode()` or `onload`. */
export class BenchImage {
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  crossOrigin: string | null = null
  decoding = 'async'
  width = 0
  height = 0
  #src = ''
  #decoded: Promise<BenchBitmap> | null = null
  get src() {
    return this.#src
  }
  set src(url: string) {
    this.#src = url
    this.#decoded = fetch(url)
      .then((response) => response.arrayBuffer())
      .then((bytes) => createImageBitmap(bytes))
      .then((bitmap) => {
        this.width = bitmap.width
        this.height = bitmap.height
        this.onload?.()
        return bitmap
      })
    this.#decoded.catch((error: unknown) => this.onerror?.(error))
  }
  get naturalWidth() {
    return this.width
  }
  get naturalHeight() {
    return this.height
  }
  bitmap() {
    if (!this.#decoded) throw new Error('BENCH_IMAGE: no src')
    return this.#decoded
  }
  async decode() {
    await this.bitmap()
  }
}

/** A 2D canvas that only holds the last bitmap drawn, so a loader reads its pixels back. */
export class BenchOffscreenCanvas {
  readonly width: number
  readonly height: number
  #drawn: BenchBitmap | null = null
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  getContext() {
    return {
      drawImage: (bitmap: BenchBitmap) => void (this.#drawn = bitmap),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(this.#drawn?.rgba ?? new Uint8Array(width * height * 4)),
      }),
    }
  }
}
