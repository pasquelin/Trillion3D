import type { DepthOfField } from '../../../../sdk-core/src/world/effect/depthOfField.ts'
import type { DepthOfFieldValues } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
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
import { markDrawn, takeHistory } from './depthOfField/dofHistory.ts'
import { createDofPrograms } from './depthOfField/dofPrograms.ts'
import { createDofOutputs } from './depthOfField/dofTargets.ts'
import type { WebgpuResolveKind } from './webgpuKinds.ts'

/**
 * The WebGPU depth of field (`depthOfField/`): the passes of each depth of field of the chain, which run one
 * after the other — the output of one is the next one's input, two images taking turns
 * (`depthOfField/dofTargets.ts`) — and, for each, its uniforms, its plan, its images, its history and its
 * groups, made as the chain asks (`resize`) and kept while what they name holds
 * (`depthOfField/dofHeld.ts`). It runs on the lit image, at the size it is drawn, before the temporal pass:
 * where that pass accumulates the image, the setup is accumulated in time first at the display's size over
 * the divisor, from the motion the velocity stage measured (`ResolveFrame.temporal`), its history the setup
 * the image before wrote. The pipelines are compiled off the frame as each is first asked, the frame
 * waiting for them. `resolve` blurs the image it is handed with the nth depth of field, and returns the
 * image after it, the input itself where nothing is to be drawn — the blur is smaller than a pixel — and
 * the images of a plan that draws nothing given back. Nothing exists before the first depth of field that
 * draws.
 */
export async function createWebgpuDepthOfField(
  device: GPUDevice,
): Promise<WebgpuResolveKind<DepthOfField, DepthOfFieldValues>> {
  const programs = await createDofPrograms(device)
  const outputs = createDofOutputs(device)
  const kit = { device, programs }
  const held: Held[] = []
  let passes = 0,
    drew = false
  const release = () => {
    for (const mine of held) dropHeld(device, mine)
    held.length = 0
    outputs.release()
  }
  return {
    get bytes() {
      let bytes = outputs.bytes
      for (const mine of held) bytes += heldBytes(mine)
      return bytes
    },
    get passes() {
      return passes
    },
    resize(_width: number, _height: number, count: number) {
      if (!count) return release()
      while (held.length < count) held.push(newHeld(device))
      while (held.length > count) dropHeld(device, held.pop()!)
    },
    resolve(encoder, pass, nth, input, frame, settings) {
      passes = 0
      if (!nth) drew = false
      const mine = held[nth]
      const { targets } = mine
      const plan = planOf(mine, pass, frame, settings)
      if (plan.idle) {
        // One that draws nothing gives its images and its history back, and the output images go with the
        // last of a chain where none drew.
        takeHistory(device, mine, plan)
        targets.release()
        if (nth === held.length - 1 && !drew) outputs.release()
        return input
      }
      targets.ensure(plan)
      const cut = frame.temporal.cut || !takeHistory(device, mine, plan)
      writeUniforms(device, mine, frame, pass, settings, cut)
      const output = outputs.view(nth % 2, frame.extent)
      const made = stepsOf(kit, mine, frame, input, output)
      let ready = true
      for (const pipeline of made.steps.pipelines) ready = pipeline.ask().ready && ready
      if (!ready) return input
      passes = encodeDof(encoder, made.steps, targets.buffers.drawArguments, plan.gather)
      if (made.stale) targets.tablesBuilt(plan.bokeh)
      drew = true
      markDrawn(mine, plan, frame)
      return output
    },
    dispose: release,
  }
}
