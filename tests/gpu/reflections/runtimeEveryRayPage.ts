// The page of the proof that every ray of the run-time proxy is cast in its frame: case 25 of the family drawn
// at a size whose rays once outnumbered a frame's budget, the temporal accumulation off so that the image
// holds; each frame's work read (`traceCounters`) until the image holds.
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { listenToWorldDevices } from '../kit/worldErrors.ts'
import { familyCase } from './runtimeFamilyCases.ts'
import { familyWorld, traceCounters } from './runtimeFamilyWorld.ts'

/** What the proof reads: each frame's work spent, and whether the world holds its image at the end. */
export type EveryRayReading = {
  trail: { spent: number }[]
  held: boolean
  worldErrors: string[]
}

/** The case the proof draws: one whose floor reflects many shapes. */
const EVERY_RAY_CASE = 25

export const run = (size: readonly [number, number]) =>
  runOnDevice<EveryRayReading>(async (_device, _events, result) => {
    const { errors, made } = listenToWorldDevices()
    const canvas = proofCanvas('runtime-every-ray') as unknown as HTMLCanvasElement & {
      readable: boolean
      css: { width: number; height: number }
    }
    canvas.readable = true
    Object.assign(canvas.css, { width: size[0], height: size[1] })
    canvas.width = size[0]
    canvas.height = size[1]
    const { world } = familyWorld(canvas, familyCase(EVERY_RAY_CASE))
    await world.ready
    world.temporalAntialiasing = false
    let held = 0
    world.onFrame(({ metrics }) => {
      held = metrics.frameHeld ? held + 1 : 0
    })
    const context = canvas.getContext('webgpu') as unknown as {
      current: GPUTexture | null
      getConfiguration(): { device: GPUDevice }
    }
    const trail: EveryRayReading['trail'] = []
    for (
      let frame = 0;
      frame < 900 &&
      !(
        held > 0 &&
        trail.some((t) => t.spent > 0) &&
        trail.length > 3 + trail.findIndex((t) => t.spent > 0)
      );
      frame++
    ) {
      await animationFrame()
      if (!context.current) continue
      const counters = await traceCounters(context.getConfiguration().device, made)
      if (counters) trail.push(counters)
    }
    Object.assign(result, { trail, held: held > 0, worldErrors: errors })
    world.dispose()
    canvas.remove()
  })
