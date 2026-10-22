import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import type { createTaaAnalysis } from './analysis.ts'
import type { createTaaHistoryTargets } from './historyTargets.ts'
import { INPUTS, taaGroupEntries, type TaaInputs } from './inputs.ts'
import { type createTaaFilterHistory, type DisplayLayers } from './layers.ts'
import { type createTaaResolves, taaPass } from './resolve.ts'

/** What the history update names and writes: the resolves, the display-size histories, the display
 *  layers' history, the analysis whose targets it reads, and the sampler and view uniform every
 *  group names. */
export interface HistoryUpdateParts {
  resolves: Awaited<ReturnType<typeof createTaaResolves>>
  history: ReturnType<typeof createTaaHistoryTargets>
  filterHistory: ReturnType<typeof createTaaFilterHistory>
  analysis: Awaited<ReturnType<typeof createTaaAnalysis>>
  sampler: GPUSampler
  uniform: GPUBuffer
}

/** Each history's update pass, made once its targets are: without the display layers, and with the
 *  layers it was last made for. */
function createUpdatePasses(images: ReturnType<typeof createTaaHistoryTargets>['images']) {
  const passes: {
    plain?: GPURenderPassDescriptor
    filter?: DisplayLayers
    layered?: GPURenderPassDescriptor
  }[] = []
  return {
    /** The pass that writes history `write`, with the display layers `filter` when it has them. */
    of(write: number, filter: DisplayLayers | undefined) {
      const made = (passes[write] ??= {}),
        { color, share } = images[write]
      const base = [color, share]
      if (!filter) return (made.plain ??= taaPass(base))
      if (made.filter !== filter) {
        made.filter = filter
        made.layered = taaPass([...base, ...filter])
      }
      return made.layered!
    },
    drop: () => void (passes.length = 0),
  }
}

/**
 * The history update of the temporal pass: a fullscreen draw into the display-size history that is
 * not read, composing the image from the one that is (`resolveWgsl.ts`, one program for every render
 * scale), then the two swap roles. The bind groups are made once for each identity the inputs were
 * seen with, never per frame.
 */
export function createHistoryUpdate(device: GPUDevice, parts: HistoryUpdateParts) {
  const { resolves, history, filterHistory, analysis, sampler, uniform } = parts
  const { images } = history
  const passes = createUpdatePasses(images)
  /** The update's two groups, one per history read, for each identity the inputs were seen with: the
   *  lit image is one of two HDR targets that take turns (`lighting/reflections/radiance/radiance.ts`). */
  const held: (GPUBindGroup | undefined)[][] = []
  /** What the groups name: the layout, then each of `INPUTS` (`bindIdentity.ts`); two held, the HDR
   *  targets' turns. */
  const identity = createWebgpuBindIdentity(2)
  /** History read on the next frame: the other is written. */
  let read = 0
  return {
    /** Makes the groups again: they name the analysis's targets. */
    regroup: () => void (held.length = 0),
    /** Forgets the groups and the passes, which name the targets that are gone. */
    drop() {
      held.length = 0
      passes.drop()
    },
    /** Encodes the update of `inputs`, then swaps the histories' roles. Returns the written colour,
     *  share and display layers. */
    encode(encoder: GPUCommandEncoder, inputs: TaaInputs) {
      const kind = inputs.share ? 'blended' : inputs.flags ? 'asIs' : 'flagless'
      const layered = inputs.filter && resolves.filtered(kind)
      // Until the layered resolve is compiled, the image resolves no layer: composition reads the raw ones.
      if (!layered) inputs.filter = undefined
      const resolve = layered || resolves[kind]
      filterHistory.follow(inputs.filter, history.width, history.height)
      const { layout } = resolve
      const { next } = identity
      next[0] = layout
      for (let i = 0; i < INPUTS.length; i++) next[1 + i] = inputs[INPUTS[i]]
      const moved = identity.moved(),
        groups = (held[identity.slot] ??= [undefined, undefined])
      if (moved || !groups[0])
        for (let i = 0; i < 2; i++) {
          const entries = taaGroupEntries(inputs, images[i], sampler, uniform, analysis)
          entries.push(...filterHistory.entries(inputs.filter, i))
          groups[i] = device.createBindGroup({ layout, entries })
        }
      const write = 1 - read,
        filter = inputs.filter && filterHistory.target(write)
      const pass = encoder.beginRenderPass(passes.of(write, filter))
      pass.setPipeline(resolve.pipeline)
      pass.setBindGroup(0, groups[read]!)
      pass.draw(3)
      pass.end()
      read = write
      filterHistory.written = !!filter
      images[write].filter = filter
      return images[write]
    },
  }
}
