// The page of the run-time proxy's budget proof: the first case of the family drawn at a size whose rays outnumber
// the frame's budget, the temporal accumulation off so that the image holds; each frame's counters read
// (`HISTORY`) until the image holds,
import { HISTORY } from '../../../packages/sdk-browser/src/reflections/proxyHistory.ts'
import { proofCanvas } from '../kit/renderHarness.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { listenToWorldDevices, readWords } from '../kit/worldErrors.ts'
import { familyCase } from './runtimeFamilyCases.ts'
import { familyWorld } from './runtimeFamilyWorld.ts'

/** What the proof reads: each frame's work spent and pixels left from the first that casts a ray, and the
 *  image the world holds at the end. */
export type BudgetReading = {
  trail: { spent: number; left: number }[]
  held: boolean
  worldErrors: string[]
}

/** The case the budget proof draws: one whose floor reflects many shapes. */
export const BUDGET_CASE = 25

export const run = (size: readonly [number, number]) =>
  runOnDevice<BudgetReading>(async (_device, _events, result) => {
    const { errors, made } = listenToWorldDevices()
    const canvas = proofCanvas('runtime-budget') as unknown as HTMLCanvasElement & {
      readable: boolean
      css: { width: number; height: number }
    }
    canvas.readable = true
    Object.assign(canvas.css, { width: size[0], height: size[1] })
    canvas.width = size[0]
    canvas.height = size[1]
    const { world } = familyWorld(canvas, familyCase(BUDGET_CASE))
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
    const trail: BudgetReading['trail'] = []
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
      const history = [...made]
        .reverse()
        .find(([label]) => label.startsWith('Trillion3D run-time proxy history'))?.[1]
      if (!history || !context.current) continue
      const counters = await readWords(context.getConfiguration().device, history, 4)
      trail.push({
        spent: counters[HISTORY.spent],
        left: counters[HISTORY.left],
      })
    }
    Object.assign(result, { trail, held: held > 0, worldErrors: errors })
    world.dispose()
    canvas.remove()
  })
