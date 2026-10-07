// Reading a rendered frame back: pixels, the frame-held wait, and the pixel comparisons the
// engine proofs share. Split from `sharedSceneProof.ts` (scene construction and mounting)
// to keep each file under the line gate.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { MIN_RENDER_SCALE } from '../../../packages/sdk-browser/src/frame/renderScaleOption.ts'
import { taaStillFrames, upscalePhases } from '../../../packages/sdk-browser/src/taa/jitter.ts'
import { VIEWPORT } from './sharedSceneProof.ts'
import { project } from './cameraRig.ts'
import { animationFrame } from './frame.ts'
import type { Engine } from '../../../packages/sdk-browser/src/engine/types.ts'

/** Renders a frame in an animation frame of the page (`animationFrame`), as a page draws, and
 *  rereads its pixels and public counters. The frame bound is closed as a host does: that is what
 *  publishes the per-stage counters. */
export async function image(
  backend: Engine,
  camera: G.Camera,
): Promise<{ pixels: Uint8Array; metrics: ReturnType<Engine['metrics']> }> {
  await animationFrame()
  backend.render(camera)
  backend.cpuFrameEnd()
  await backend.flush()
  return { pixels: await backend.capture(), metrics: backend.metrics() }
}

/**
 * The most images a still view is rendered before giving up on its hold: the engine's longest
 * still average — temporal accumulation at the lowest render scale (`taaStillFrames`) —, and as
 * many again for what lands while the view settles (a page, a tile, its targets), which restarts
 * that average.
 */
export const PLAFOND = 2 * taaStillFrames(upscalePhases(MIN_RENDER_SCALE, 1))

/** Renders until the image is held; returns the last RENDERED image, the held one, and the count
 *  rendered before it. `onFrame` sees every image, the held one included, before the hold ends the
 *  wait. */
export async function untilHeld(
  backend: Engine,
  camera: G.Camera,
  onFrame?: (frame: Awaited<ReturnType<typeof image>>) => void,
): Promise<{ rendered: number[] | undefined; held: number[] | null; count: number }> {
  let rendered: number[] | undefined,
    count = 0
  for (let i = 0; i < PLAFOND; i++) {
    const frame = await image(backend, camera)
    onFrame?.(frame)
    if (frame.metrics.frameHeld) return { rendered, held: Array.from(frame.pixels), count }
    rendered = Array.from(frame.pixels)
    count++
  }
  return { rendered, held: null, count }
}

/** How many RGBA quadruplets differ between two images of the same size. */
export function difference(a: Uint8Array | number[], b: Uint8Array | number[]): number {
  let n = 0
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      n++
  return n
}

/** Pixels of an image that differ from its corner pixel, the cleared background: an image where
 *  the scene appears has many of them, an empty canvas none. */
export function drawnPixels(pixels: ArrayLike<number>) {
  let drawn = 0
  for (let index = 0; index < pixels.length; index += 4)
    for (let channel = 0; channel < 4; channel += 1)
      if (pixels[index + channel] !== pixels[channel]) {
        drawn += 1
        break
      }
  return drawn
}

/** True when the pixel at `i` carries the tile's red and not the background's blue. */
export const estRouge = (pixels: Uint8Array | number[], i: number): boolean =>
  pixels[i] > 110 && pixels[i] > pixels[i + 2] + 40

/** The number of pixels that carry the tile's red rather than the background's blue. */
export function redCount(pixels: Uint8Array | number[]): number {
  let n = 0
  for (let i = 0; i < pixels.length; i += 4) if (estRouge(pixels, i)) n++
  return n
}

const point = new G.Vector3()

/** RGB read where world point `(x, y, z)` projects in an image of `viewport`, clamped to it.
 *  Bottom-left origin, like `capture`. */
export function colorAt(
  pixels: Uint8Array,
  camera: G.Camera,
  x: number,
  y: number,
  z = 0,
  [w, h]: readonly [number, number] = VIEWPORT,
) {
  project(point.set(x, y, z), camera)
  const px = Math.min(w - 1, Math.max(0, Math.round(((point.x + 1) / 2) * (w - 1)))),
    py = Math.min(h - 1, Math.max(0, Math.round(((point.y + 1) / 2) * (h - 1)))),
    i = (py * w + px) * 4
  return [pixels[i], pixels[i + 1], pixels[i + 2]]
}
