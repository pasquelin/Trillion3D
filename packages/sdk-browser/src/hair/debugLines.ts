import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { transformPointRow } from '../../../math/src/vector/vector.ts'
import { textSegments } from './debugFont.ts'

/** The floats of a line (`DEBUG_LINES_WGSL`): the first end and its colour (the bytes r, g, b, a of a word), the second end and the space the ends are in. */
export const DEBUG_LINE_FLOATS = 8
/** The lines the host writes in an image, at most. */
export const DEBUG_CPU_LINES = 16384
/** The space of a line's ends: the world, relative to the eye, or the pixels of the display. */
const SPACE = { world: 0, pixel: 1 } as const

/** A colour of linear components in [0, 1] as the bytes r, g, b, a of a word. */
export const debugColor = (r: number, g: number, b: number) =>
  (Math.round(r * 255) | (Math.round(g * 255) << 8) | (Math.round(b * 255) << 16) | (255 << 24)) >>>
  0

/** The colours of the views: the console's palette the reference prints and draws with. */
export const DEBUG_COLORS = {
  white: debugColor(1, 1, 1),
  red: debugColor(1, 0, 0),
  green: debugColor(0, 1, 0),
  blue: debugColor(0, 0, 1),
  yellow: debugColor(1, 1, 0),
  orange: debugColor(243 / 255, 156 / 255, 18 / 255),
  purple: debugColor(169 / 255, 7 / 255, 228 / 255),
  silver: debugColor(189 / 255, 195 / 255, 199 / 255),
  emerald: debugColor(46 / 255, 204 / 255, 113 / 255),
  frustum: debugColor(0.5, 1, 0),
  lightRed: debugColor(0.75, 0.5, 0.5),
  cyan: debugColor(0, 1, 1),
} as const

/** The corners of a box as its low and high ends' choices, in the order the edges below name them. */
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const

/** The corners of a box (`corners`, eight points of three numbers) from its low and high ends, in the frame whose axes are the rows of `axes` (nine numbers; the world's where none). */
function fillCorners(
  corners: Float64Array,
  low: ArrayLike<number>,
  high: ArrayLike<number>,
  axes: ArrayLike<number> | undefined,
) {
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? high[0]! : low[0]!,
      y = corner & 2 ? high[1]! : low[1]!,
      z = corner & 4 ? high[2]! : low[2]!
    for (let k = 0; k < 3; k++)
      corners[corner * 3 + k] = axes
        ? axes[k]! * x + axes[3 + k]! * y + axes[6 + k]! * z
        : [x, y, z][k]!
  }
}

/**
 * THE LINES A VIEW DRAWS ITSELF, kept for an image: segments between two points of the world (relative to the eye
 * `begin` was given) or of the display's pixels, each a colour, and the text written as segments (`debugFont.ts`).
 * `data` holds `count` lines of `DEBUG_LINE_FLOATS`; the lines past `DEBUG_CPU_LINES` are dropped.
 */
export class DebugLines {
  readonly data = new Float32Array(DEBUG_CPU_LINES * DEBUG_LINE_FLOATS)
  count = 0
  private readonly words = new Uint32Array(this.data.buffer)
  private readonly eye = new Float64Array(3)
  private readonly corners = new Float64Array(24)
  private readonly inverse = new Float64Array(16)

  /** Empties the list for an image seen from `from` (the world's points are written relative to it). */
  begin(from: ArrayLike<number>) {
    this.count = 0
    this.eye.set([from[0]!, from[1]!, from[2]!])
  }

  private put(a: ArrayLike<number>, b: ArrayLike<number>, color: number, space: number) {
    if (this.count >= DEBUG_CPU_LINES) return
    const at = this.count++ * DEBUG_LINE_FLOATS
    this.data.set([a[0]!, a[1]!, a[2]!], at)
    this.words[at + 3] = color
    this.data.set([b[0]!, b[1]!, b[2]!, space], at + 4)
  }

  /** A segment between two points of the world. */
  world(a: ArrayLike<number>, b: ArrayLike<number>, color: number) {
    const { eye } = this
    this.put(
      [a[0]! - eye[0]!, a[1]! - eye[1]!, a[2]! - eye[2]!],
      [b[0]! - eye[0]!, b[1]! - eye[1]!, b[2]! - eye[2]!],
      color,
      SPACE.world,
    )
  }

  /** A segment between two pixels of the display. */
  pixel(x0: number, y0: number, x1: number, y1: number, color: number) {
    this.put([x0, y0, 0], [x1, y1, 0], color, SPACE.pixel)
  }

  /** The edges of the quad of the pixels (`x0`, `y0`) to (`x1`, `y1`). */
  rect(x0: number, y0: number, x1: number, y1: number, color: number) {
    this.pixel(x0, y0, x1, y0, color)
    this.pixel(x1, y0, x1, y1, color)
    this.pixel(x1, y1, x0, y1, color)
    this.pixel(x0, y1, x0, y0, color)
  }

  /** `text` from the pixel (`x`, `y`), cells of `cell` pixels. */
  text(text: string, x: number, y: number, color: number, cell = 2) {
    textSegments(text, x, y, cell, (x0, y0, x1, y1) => this.pixel(x0, y0, x1, y1, color))
  }

  /** The twelve edges of the eight `corners` already placed. */
  private edges(color: number) {
    const { corners } = this
    for (const [a, b] of EDGES)
      this.world(corners.subarray(a * 3, a * 3 + 3), corners.subarray(b * 3, b * 3 + 3), color)
  }

  /**
   * The twelve edges of the box of the corners `low` and `high`, written in the frame whose axes are the rows of
   * `axes` (nine numbers, the box's own coordinates then taken to the world); the world's axes where none.
   */
  box(low: ArrayLike<number>, high: ArrayLike<number>, color: number, axes?: ArrayLike<number>) {
    fillCorners(this.corners, low, high, axes)
    this.edges(color)
  }

  /** The edges of the volume of the clip box between the depths `near` and `far`, seen through `viewProjection` (clip from the world). */
  frustum(viewProjection: ArrayLike<number>, near: number, far: number, color: number) {
    invertMatrix4(this.inverse, viewProjection)
    this.frustumFrom(this.inverse, near, far, color)
  }

  /** The same edges, from the matrix `inverse` that takes clip space back to the world. */
  frustumFrom(inverse: ArrayLike<number>, near: number, far: number, color: number) {
    const { corners } = this
    for (let corner = 0; corner < 8; corner++) {
      const x = corner & 1 ? 1 : -1,
        y = corner & 2 ? 1 : -1,
        z = corner & 4 ? far : near
      const w = transformPointRow(inverse, 3, x, y, z)
      for (let k = 0; k < 3; k++)
        corners[corner * 3 + k] = transformPointRow(inverse, k, x, y, z) / w
    }
    this.edges(color)
  }
}

/** The lines of a view, none yet. */
export const createDebugLines = () => new DebugLines()
