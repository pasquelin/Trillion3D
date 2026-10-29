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
import { fitHistory, markDrawn } from './depthOfField/dofHistory.ts'
import { createDofPrograms } from './depthOfField/dofPrograms.ts'
import { createDofOutputs } from './depthOfField/dofTargets.ts'
import { noLayers } from '../../blend/translucencyLayers.ts'
import type { WebgpuResolveKind } from './webgpuKinds.ts'
import { dropHolds, resizeHolds } from './holds.ts'

type Outputs = ReturnType<typeof createDofOutputs>
type Kit = Parameters<typeof stepsOf>[0]
type ResolveArgs = Parameters<WebgpuResolveKind<DepthOfField, DepthOfFieldValues>['resolve']>

/** What the last `resolve` left: the passes it encoded, and whether any depth of field of the
 *  chain has drawn this frame. */
type DofState = { passes: number; drew: boolean }

/** Frees every hold and the output images. */
function releaseDof(device: GPUDevice, held: Held[], outputs: Outputs) {
  dropHolds(held, (mine) => dropHeld(device, mine))
  outputs.release()
}

/** Bytes of the output images and of every hold. */
function dofBytes(held: Held[], outputs: Outputs) {
  let bytes = outputs.bytes
  for (const mine of held) bytes += heldBytes(mine)
  return bytes
}

/** Draws the nth depth of field, whose plan draws something, into the next output image; the
 *  input itself while a pipeline is still compiling. */
function drawDof(
  device: GPUDevice,
  kit: Kit,
  outputs: Outputs,
  state: DofState,
  mine: Held,
  plan: ReturnType<typeof planOf>,
  last: boolean,
  [encoder, pass, nth, input, frame, settings]: ResolveArgs,
) {
  const { targets } = mine
  targets.ensure(plan)
  const cut = frame.temporal.cut || !fitHistory(device, mine, plan)
  writeUniforms(device, mine, frame, pass, settings, cut)
  const output = outputs.view(nth % 2, frame.extent)
  const made = stepsOf(kit, mine, frame, input, output)
  let ready = true
  for (const pipeline of made.steps.pipelines) ready = pipeline.ask().ready && ready
  if (!ready) return input
  // The last depth of field of the chain composes the layers drawn after it, where there are some.
  const layers = last ? frame.layers : undefined
  state.passes = encodeDof(
    encoder,
    made.steps,
    targets.buffers.drawArguments,
    plan.gather,
    layers ?? noLayers(device),
  )
  frame.layersComposed ||= !!layers
  if (made.stale) targets.tablesBuilt(plan.bokeh)
  state.drew = true
  markDrawn(mine, plan, frame)
  return output
}

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
  const make = () => newHeld(device)
  const drop = (mine: Held) => dropHeld(device, mine)
  const state: DofState = { passes: 0, drew: false }
  const release = () => releaseDof(device, held, outputs)
  return {
    get bytes() {
      return dofBytes(held, outputs)
    },
    get passes() {
      return state.passes
    },
    resize(_width: number, _height: number, count: number) {
      if (!count) return release()
      resizeHolds(held, count, make, drop)
    },
    resolve(...args) {
      const [, pass, nth, input, frame, settings] = args
      state.passes = 0
      if (!nth) state.drew = false
      const mine = held[nth]
      const plan = planOf(mine, pass, frame, settings)
      if (plan.idle) {
        // One that draws nothing gives its images and its history back, and the output images go with the
        // last of a chain where none drew.
        fitHistory(device, mine, plan)
        mine.targets.release()
        if (nth === held.length - 1 && !state.drew) outputs.release()
        return input
      }
      return drawDof(device, kit, outputs, state, mine, plan, nth === held.length - 1, args)
    },
    dispose: release,
  }
}
