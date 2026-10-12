// The page of the screen-memory proof: the same generated worlds drawn at two sizes, the engine's
// allocation ledger read by label once their image is drawn, in bytes per pixel. A target that
// follows the screen holds the same bytes a pixel at both; the shadows' pools and tables do not.
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { cameraFace, engine, release } from '../kit/sharedSceneProof.ts'
import { backdropScene } from '../kit/backdropScene.ts'
import { image } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

const SIZES = [
  [640, 400],
  [1280, 800],
] as const
/** What stands before the backdrop. */
export const KINDS = ['opaque', 'glass', 'mirror', 'temporal'] as const
type Kind = (typeof KINDS)[number]

const scene = (kind: Kind) => backdropScene(kind === 'glass' || kind === 'mirror' ? kind : 'none')

/** Bytes a pixel, by label, at each size, for each kind. */
export type ScreenReading = Record<string, Record<string, number>[]>

export const run = () =>
  runOnDevice<{ perPixel: ScreenReading }>(async (device, events, result) => {
    const perPixel: ScreenReading = (result.perPixel = {})
    const camera = cameraFace()
    for (const kind of KINDS)
      for (const [width, height] of SIZES) {
        const prepared = scene(kind),
          sceneLights = createSceneLightStore()
        sceneLights.add(SUN)
        const { backend, canvas } = engine(prepared, device, (e) => events.push(e), {
          sceneLights,
          viewport: [width, height],
          temporalAntialiasing: kind === 'temporal',
        })
        await backend.prepare()
        for (let i = 0; i < 4; i++) await image(backend, camera)
        const bytes: Record<string, number> = {}
        for (const [label, held] of Object.entries(backend.metrics().gpuAllocatedByLabel ?? {}))
          bytes[label] = held / (width * height)
        ;(perPixel[kind] ??= []).push(bytes)
        release(backend, canvas, prepared)
        await device.queue.onSubmittedWorkDone()
      }
  })
