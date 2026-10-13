import { Vector2 } from '../math/vector2.ts'
import { listen, unlisten } from '../observed.ts'
import { createListeners } from '../../runtime/listeners.ts'
import type { ColorSpace, Filter, Wrap } from '../constants/index.ts'
import type { Texture as TextureRecord } from '../../texture/contract.ts'
import { textureWritten } from '../../texture/writes.ts'
import { composeUvTransform } from './uvTransform.ts'

let nextTexture = 1

/** What a write moves, by field: its addressing, filters and anisotropy count as `sampling`, its
 *  placement as `placement`; any other field — the picture and how it is read — as `version`. */
const COUNTER: Record<string, 'sampling' | 'placement'> = {
  wrap: 'sampling',
  wrapS: 'sampling',
  wrapT: 'sampling',
  minFilter: 'sampling',
  magFilter: 'sampling',
  anisotropy: 'sampling',
  repeat: 'placement',
  offset: 'placement',
  rotation: 'placement',
}
/** The keys a write never counts: the counters themselves, and `needsUpdate`, whose setter counts. */
const UNCOUNTED = new Set(['version', 'sampling', 'placement', 'needsUpdate'])

/**
 * An image and how it is sampled, in a page's words (`wrap`, `filter`, `colorSpace`): the engine's
 * one texture record (`../../texture/contract.ts`), read in place by every pool, atlas and
 * sampling word. Any write reaches the materials that sample it and the journals of the consumers
 * that read it (`../../texture/writes.ts`).
 */
export class Texture implements TextureRecord {
  /** Always `true`: tells a texture apart from anything else. */
  readonly isTexture = true as const
  /** A name unique to this texture. */
  readonly id = `texture-${nextTexture++}`
  /** A name for the page's own use. */
  name = ''
  /** How the picture repeats left to right. */
  wrapS: Wrap = 'clamp'
  /** How the picture repeats bottom to top. */
  wrapT: Wrap = 'clamp'
  /** How many times the picture fits across and up. */
  repeat = new Vector2(1, 1)
  /** How far the picture is slid, across and up. */
  offset = new Vector2(0, 0)
  /** How far the picture is turned, in radians. */
  rotation = 0
  /** How pixels are picked when the picture looks smaller than it is. */
  minFilter: Filter = 'linearMipLinear'
  /** How pixels are picked when the picture looks bigger than it is. */
  magFilter: Filter = 'linear'
  /** Whether the numbers are colours (`'srgb'`) or plain values (`'linear'`). */
  colorSpace: ColorSpace = 'srgb'
  /** Whether the picture is turned upside down when read. */
  flipY = true
  /** Whether colour is already multiplied by alpha. */
  premultiplyAlpha = false
  /** How sharp the picture stays when seen at a slant. */
  anisotropy = 1
  /** Which set of UVs of the geometry the texture follows. */
  channel = 0
  /** Bumped by a write of the picture or of how it is read: what a material compares to send the
   *  picture again. */
  version = 0
  /** Bumped by a write of the addressing, the filters or the anisotropy: set again, nothing sent. */
  sampling = 0
  /** Bumped by a write of `repeat`, `offset` or `rotation`: placed again, nothing sent. */
  placement = 0
  /** `repeat`, `offset` and `rotation` composed into a 3 × 3 matrix, column-major: written again
   *  by every placement write (`composeUvTransform`). */
  readonly transform = new Float64Array(9)
  readonly _listeners = createListeners()
  /** The record as its holders hold it: the proxy that hears its writes. */
  private record: TextureRecord = this

  /** The picture itself: an image, a canvas, a video or raw pixels. */
  image: unknown
  /** What the image holds beyond its pixels: `'cube'`, `'array'`, `'depth'`, `'compressed'`. */
  readonly layout: string
  /** How each pixel is stored: `'rgba'`, `'rgb'`, `'r'`, `'depth'`… */
  readonly format: string
  constructor(image: unknown = null, layout = '2d', format = 'rgba') {
    this.image = image
    this.layout = layout
    this.format = format
    composeUvTransform(this.transform, this.offset, this.repeat, this.rotation)
    const placed = () => this.touch('placement')
    listen(this.repeat, placed)
    listen(this.offset, placed)
    // A word written after creation reaches the materials that sample this texture; a new vector
    // for `repeat` or `offset` is heard like the one it replaces, and the old one no longer is.
    // The proxy is the record its holders key on: what a journal names.
    return (this.record = new Proxy(this, {
      set(target, key, value) {
        const vector = key === 'repeat' || key === 'offset'
        if (vector && target[key] === value) return true
        if (vector) unlisten(target[key], placed)
        Reflect.set(target, key, value)
        if (typeof key !== 'string' || UNCOUNTED.has(key)) return true
        if (vector) listen(value, placed)
        target.touch(COUNTER[key] ?? 'version')
        return true
      },
    }))
  }
  /** Both wrap modes at once. */
  get wrap(): Wrap {
    return this.wrapS
  }
  set wrap(mode: Wrap) {
    this.wrapS = this.wrapT = mode
  }
  /** Width of the picture, in pixels. */
  get width(): number {
    return (this.image as { width?: number } | null)?.width ?? 0
  }
  /** Height of the picture, in pixels. */
  get height(): number {
    return (this.image as { height?: number } | null)?.height ?? 0
  }
  /** `texture.needsUpdate = true` after changing the image or a field: the samplers re-read it. */
  set needsUpdate(value: boolean) {
    if (value) this.touch()
  }
  get needsUpdate() {
    return false
  }
  private touch(counter: 'version' | 'sampling' | 'placement' = 'version') {
    if (counter === 'placement')
      composeUvTransform(this.transform, this.offset, this.repeat, this.rotation)
    this[counter]++
    textureWritten(this.record)
    this._listeners.emit()
  }
  /** A new texture showing the same picture with the same settings. */
  clone() {
    const copy = new Texture(this.image, this.layout, this.format)
    const { name, wrapS, wrapT, rotation, minFilter, magFilter, colorSpace, flipY } = this
    Object.assign(copy, { name, wrapS, wrapT, rotation, minFilter, magFilter, colorSpace, flipY })
    copy.premultiplyAlpha = this.premultiplyAlpha
    copy.anisotropy = this.anisotropy
    copy.channel = this.channel
    copy.repeat.copy(this.repeat)
    copy.offset.copy(this.offset)
    return copy
  }
  /** Forgets the materials sampling it. */
  dispose() {
    this._listeners.clear()
  }
}
