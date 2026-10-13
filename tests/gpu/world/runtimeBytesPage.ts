// The page of the run-time proxy's memory proof: the generated world of the reflection proof's first case
// (`../reflections/runtimeFamilyWorld.ts`) drawn at two sizes, the engine's allocation ledger read by label once it
// is held, in bytes per pixel. The proxy's store follows the screen: eight bytes a pixel, asked of the
// frame's allocation when the first placement that wears a proxy is drawn.
import { familyCase } from '../reflections/runtimeFamilyCases.ts'
import { familyWorld } from '../reflections/runtimeFamilyWorld.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

const SIZES = [
  [320, 200],
  [640, 400],
] as const

/** Bytes a pixel, by label, at each size. */
export type RuntimeBytes = { perPixel: Record<string, number>[] }

export const run = () =>
  runOnDevice<RuntimeBytes>(async (_device, _events, result) => {
    result.perPixel = []
    for (const [width, height] of SIZES) {
      const canvas = proofCanvas(`runtime-bytes-${width}`) as unknown as HTMLCanvasElement & {
        css: { width: number; height: number }
      }
      Object.assign(canvas.css, { width, height })
      canvas.width = width
      canvas.height = height
      const { world } = familyWorld(canvas, familyCase(0))
      await world.ready
      let held = 0,
        labels: Record<string, number> = {}
      world.onFrame(({ metrics }) => {
        held = metrics.frameHeld ? held + 1 : 0
        labels = (metrics.gpuAllocatedByLabel as Record<string, number> | null) ?? labels
      })
      for (let frame = 0; frame < 400 && held < 3; frame++) await animationFrame()
      result.perPixel.push(
        Object.fromEntries(
          Object.entries(labels).map(([label, bytes]) => [label, bytes / (width * height)]),
        ),
      )
      world.dispose()
      canvas.remove()
    }
  })
