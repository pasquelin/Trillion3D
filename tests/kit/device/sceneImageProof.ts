// Reading a rendered frame back: pixels, the settled-image wait, and the pixel counts the engine
// proofs share; two images are compared by `compareImages`. Split from `sharedSceneProof.ts`
// (scene construction and mounting) to keep each file under the line gate.
import type { Camera } from '../../../packages/sdk-core/src/world/camera/camera.ts'
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts'
import { VIEWPORT, cameraFace, engine, release, type ScenePreparee } from './sharedSceneProof.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { project } from './cameraRig.ts'
import { animationFrame } from './frame.ts'
import type {
  Engine,
  EngineContext,
} from '../../../packages/sdk-browser/src/session/engine/types.ts'
import type { SceneEnvironment } from '../../../packages/sdk-core/src/scene/core/environment.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'

/** Renders a frame in an animation frame of the page (`animationFrame`), as a page draws, and
 *  rereads its pixels and public counters. The frame bound is closed as a host does: that is what
 *  publishes the per-stage counters. */
export async function image(
  backend: Engine,
  camera: Camera,
): Promise<{ pixels: Uint8Array; metrics: ReturnType<Engine['metrics']> }> {
  await animationFrame()
  backend.render(camera)
  backend.cpuFrameEnd()
  await backend.flush()
  return { pixels: await backend.capture(), metrics: backend.metrics() }
}

/** Images a still view is drawn before it counts as settled: four times the temporal history's
 *  sixteen samples, which the temporal pass, running every frame, then holds whole. A view without
 *  temporal accumulation holds its image earlier. */
const SETTLE_FRAMES = 64

/** Renders until the image is settled: held — nothing changing —, or `limit` drawn (`SETTLE_FRAMES`
 *  by default), for a view that draws every image and never holds. Returns the image before the
 *  last, the settled one, the count rendered before it, and whether the engine held it (`held`): a
 *  proof that compares images to the bit asks for a `limit` past the longest history to forget
 *  (the screen probes' and the occlusion's take about sixty images after the last change) and
 *  fails when `held` is false, since an image cut off at the limit depends on when the view's
 *  last change fell. `onFrame` sees every image, the settled one included. */
export async function untilHeld(
  backend: Engine,
  camera: Camera,
  onFrame?: (frame: Awaited<ReturnType<typeof image>>) => void,
  limit = SETTLE_FRAMES,
): Promise<{ rendered: number[] | undefined; settled: number[]; count: number; held: boolean }> {
  let rendered: number[] | undefined,
    count = 0
  for (;;) {
    const frame = await image(backend, camera)
    onFrame?.(frame)
    const held = !!frame.metrics.frameHeld
    if (held || count === limit - 1)
      return { rendered, settled: Array.from(frame.pixels), count, held }
    rendered = Array.from(frame.pixels)
    count++
  }
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
export const isRed = (pixels: Uint8Array | number[], i: number): boolean =>
  pixels[i] > 110 && pixels[i] > pixels[i + 2] + 40

/** The number of pixels that carry the tile's red rather than the background's blue. */
export function redCount(pixels: Uint8Array | number[]): number {
  let n = 0
  for (let i = 0; i < pixels.length; i += 4) if (isRed(pixels, i)) n++
  return n
}

const point = new Vector3()

/** RGB read where world point `(x, y, z)` projects in an image of `viewport`, clamped to it.
 *  Bottom-left origin, like `capture`. */
export function colorAt(
  pixels: Uint8Array,
  camera: Camera,
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
 * dispose; a preparation that fails releases them before it throws. `environment` is the scene's
 * (an exposure of one to read a pixel at the light it is lit with, not at the image's mean).
 */
export async function sunlitEngine(
  scene: ScenePreparee,
  device: GPUDevice,
  events: unknown[],
  {
    images = 0,
    environment,
    ...options
  }: Partial<EngineContext> & { images?: number; environment?: SceneEnvironment } = {},
) {
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  if (environment) sceneLights.setEnvironment(environment)
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
