// Reading a rendered frame back: pixels, the frame-held wait, and the pixel counts the engine
// proofs share; two images are compared by `compareImages`. Split from `sharedSceneProof.ts`
// (scene construction and mounting) to keep each file under the line gate.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { MIN_RENDER_SCALE } from '../../../packages/sdk-browser/src/frame/renderScaleOption.ts'
import { taaStillFrames, upscalePhases } from '../../../packages/sdk-browser/src/taa/jitter.ts'
import { VIEWPORT, cameraFace, engine, release, type ScenePreparee } from './sharedSceneProof.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { project } from './cameraRig.ts'
import { animationFrame } from './frame.ts'
import type { Engine, EngineContext } from '../../../packages/sdk-browser/src/engine/types.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'

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
const PLAFOND = 2 * taaStillFrames(upscalePhases(MIN_RENDER_SCALE, 1))

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
  const px = clamp(Math.round(((point.x + 1) / 2) * (w - 1)), 0, w - 1),
    py = clamp(Math.round(((point.y + 1) / 2) * (h - 1)), 0, h - 1),
    i = (py * w + px) * 4
  return [pixels[i], pixels[i + 1], pixels[i + 2]]
}

/** Public counters of a profile stage, or `null` when the host did not ask for it. */
export function countsStep(
  backend: Engine,
  stage: string,
): Readonly<Record<string, number>> | null {
  const profile = backend.stageProfile?.()
  return profile?.stages?.find((input) => input.stage === stage)?.counts ?? null
}

/**
 * The real engine on `scene` (`engine`) lit by the bench sun alone, prepared, then `images` images
 * drawn from the face-on camera (`image`); `options` complete the host context, its diagnostics go
 * to `events`. `release` gives back the engine, its canvas and the scene, and resolves with the
 * dispose; a preparation that fails releases them before it throws.
 */
export async function sunlitEngine(
  scene: ScenePreparee,
  device: GPUDevice,
  events: unknown[],
  { images = 0, ...options }: Partial<EngineContext> & { images?: number } = {},
) {
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const { backend, canvas } = engine(scene, device, (e) => events.push(e), {
    sceneLights,
    ...options,
  })
  const released = () => release(backend, canvas, scene)
  try {
    await backend.prepare()
    for (let i = 0, camera = cameraFace(); i < images; i++) await image(backend, camera)
  } catch (error) {
    await released()
    throw error
  }
  return { backend, canvas, release: released }
}
