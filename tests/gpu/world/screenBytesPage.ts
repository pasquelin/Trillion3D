// The page of the screen-memory proof: the same generated worlds drawn at two sizes, the engine's
// allocation ledger read by label once their image is drawn, in bytes per pixel. A target that
// follows the screen holds the same bytes a pixel at both; the shadows' pools and tables do not.
import { backdropScene } from '../kit/backdropScene.ts'
import { sunlitEngine } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

const SIZES = [
  [640, 400],
  [1280, 800],
] as const
/** What stands before the backdrop. */
export const KINDS = ['opaque', 'glass', 'mirror', 'temporal'] as const
export type Kind = (typeof KINDS)[number]

const scene = (kind: Kind) =>
  backdropScene({ glass: kind === 'glass' ? {} : undefined, mirror: kind === 'mirror' })

/** Bytes a pixel, by label, at each size, for each kind. */
export type ScreenReading = Record<Kind, Record<string, number>[]>

export const run = () =>
  runOnDevice<{ perPixel: ScreenReading }>(async (device, events, result) => {
    const perPixel = (result.perPixel = {} as ScreenReading)
    for (const kind of KINDS)
      for (const [width, height] of SIZES) {
        const { backend, release } = await sunlitEngine(scene(kind), device, events, {
          viewport: [width, height],
          temporalAntialiasing: kind === 'temporal',
          images: 4,
        })
        const bytes: Record<string, number> = {}
        for (const [label, held] of Object.entries(backend.metrics().gpuAllocatedByLabel ?? {}))
          bytes[label] = held / (width * height)
        ;(perPixel[kind] ??= []).push(bytes)
        await release()
        await device.queue.onSubmittedWorkDone()
      }
  })
