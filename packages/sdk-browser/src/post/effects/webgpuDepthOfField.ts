import type { DepthOfField } from '../../../../sdk-core/src/world/effect/depthOfField.ts'
import { encodeDof } from './depthOfField/dofEncode.ts'
import {
  dropHeld,
  heldBytes,
  newHeld,
  planOf,
  stepsOf,
  writeUniforms,
  type Held,
} from './depthOfField/dofHeld.ts'
import { createDofPrograms } from './depthOfField/dofPrograms.ts'
import { createDofTargets } from './depthOfField/dofTargets.ts'
import type { WebgpuResolveKind } from './webgpuKinds.ts'

/**
 * The WebGPU depth of field (`depthOfField/`): the passes of each depth of field of the chain, which run one
 * after the other on the images they share (`depthOfField/dofTargets.ts`) — the output of one is the
 * next one's input, two images taking turns — and, for each, its uniforms, its plan and its groups, made as
 * the chain asks (`resize`) and kept while what they name holds (`depthOfField/dofHeld.ts`). The pipelines
 * are compiled off the frame as each is first asked, the frame waiting for them. `resolve` blurs the
 * image it is handed with the nth depth of field, and returns the image after it, the input itself
 * where nothing is to be drawn — the blur is smaller than a pixel. Nothing exists before the first
 * depth of field that draws.
 */
export async function createWebgpuDepthOfField(
  device: GPUDevice,
): Promise<WebgpuResolveKind<DepthOfField>> {
  const programs = await createDofPrograms(device)
  const targets = createDofTargets(device)
  const kit = { device, programs, targets }
  const held: Held[] = []
  let passes = 0,
    rank = 0
  const release = () => {
    for (const mine of held) dropHeld(device, mine)
    held.length = 0
    targets.release()
  }
  return {
    get bytes() {
      return held.reduce((sum, mine) => sum + heldBytes(mine), targets.bytes)
    },
    get passes() {
      return passes
    },
    resize(_width: number, _height: number, count: number) {
      if (!count) return release()
      while (held.length < count) held.push(newHeld(device))
      while (held.length > count) dropHeld(device, held.pop()!)
    },
    resolve(encoder, pass, nth, input, frame) {
      passes = 0
      const mine = held[nth]
      const plan = planOf(mine, pass, frame)
      if (plan.idle) return input
      targets.ensure(plan, frame.extent)
      writeUniforms(device, mine, frame, pass, rank++ % 8)
      const output = targets.output(nth % 2, frame.extent).view
      const steps = stepsOf(kit, mine, frame, input, output)
      let ready = true
      for (const pipeline of steps.pipelines) ready = pipeline.ask().ready && ready
      if (!ready) return input
      passes = encodeDof(encoder, steps, {
        drawArguments: targets.buffers.drawArguments,
        viewport: plan.gather,
      })
      if (mine.madeStale) targets.tablesBuilt(plan.bokeh)
      return output
    },
    dispose: release,
  }
}
