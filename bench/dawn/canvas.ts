// The bench's canvas: the display's size, and a `webgpu` context whose current texture is one GPU
// texture of that size — the engine draws into it as into a window's canvas, and nothing is shown.
import { FakeElement } from './elements.ts'

/** A 2D context that draws nothing: the kit's sparklines keep their own numbers. */
const noDrawing = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (held, key) =>
      key in held ? held[key] : key === 'measureText' ? () => ({ width: 0 }) : () => {},
    set: (held, key, value) => ((held[key] = value), true),
  })

/** A `webgpu` canvas context whose current texture is one GPU texture of the canvas's size. */
class TextureContext {
  #config: GPUCanvasConfiguration | null = null
  #texture: GPUTexture | null = null
  readonly canvas: FakeCanvas
  constructor(canvas: FakeCanvas) {
    this.canvas = canvas
  }
  configure(config: GPUCanvasConfiguration) {
    this.#config = config
    this.#texture?.destroy()
    this.#texture = null
  }
  unconfigure() {
    this.#config = null
  }
  getConfiguration() {
    return this.#config
  }
  /** The texture the last image went to, or `null` before one. */
  get current() {
    return this.#texture
  }
  getCurrentTexture() {
    const config = this.#config!,
      { width, height } = this.canvas
    if (this.#texture?.width !== width || this.#texture.height !== height) {
      this.#texture?.destroy()
      this.#texture = config.device.createTexture({
        label: 'bench canvas',
        size: [width, height],
        format: config.format,
        // Readable only when the bench captures: a usage the page did not ask can change how the
        // GPU stores the texture.
        usage:
          (config.usage ?? GPUTextureUsage.RENDER_ATTACHMENT) |
          (this.canvas.readable ? GPUTextureUsage.COPY_SRC : 0),
        viewFormats: config.viewFormats ?? [],
      })
    }
    return this.#texture
  }
}

/** A canvas of the bench's display: `css` pixels laid out, `ratio` image pixels per CSS pixel. */
export class FakeCanvas extends FakeElement {
  width: number
  height: number
  #contexts = new Map<string, unknown>()
  /** Whether the bench reads the canvas's images back (`capture.ts`). */
  readable = false
  readonly css: { width: number; height: number }
  constructor(ownerDocument: unknown, css: { width: number; height: number }, ratio: number) {
    super('CANVAS', ownerDocument)
    this.css = css
    this.width = Math.round(css.width * ratio)
    this.height = Math.round(css.height * ratio)
  }
  override get clientWidth() {
    return this.css.width
  }
  override get clientHeight() {
    return this.css.height
  }
  getContext(kind: string) {
    if (!this.#contexts.has(kind)) {
      // A 2D context draws nothing; a `webgpu` one draws into a GPU texture.
      const made = kind === 'webgpu' ? new TextureContext(this) : kind === '2d' ? noDrawing() : null
      this.#contexts.set(kind, made)
    }
    return this.#contexts.get(kind)
  }
}
