import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { TAA_UPDATE_HISTORY_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import type { AccumulatedImage } from '../../lighting/deferred/program.ts'
import type { createTaaAnalysis } from './analysis.ts'
import { TAA_BINDINGS } from './bindingsWgsl.ts'
import type { FrameSlices } from './historyFrames.ts'
import { isUpscaled } from './historyShape.ts'
import type { createTaaHistoryTargets } from './historyTargets.ts'
import type { HistoryResolve } from './historyResolve.ts'
import { INPUTS, taaGroupEntries, type TaaInputs } from './inputs.ts'
import type { createTaaFilterHistory } from './layers.ts'
import type { TaaResolves, Update } from './resolve.ts'
import type { TaaExecution } from './waveOps.ts'

/** What the history update names and writes: the resolves, the history's frames, the display
 *  layers' history, the analysis whose targets it reads, the resolve that brings a larger history
 *  down to the display's size, and the sampler and view uniform every group names. */
export interface HistoryUpdateParts {
  resolves: TaaResolves
  history: ReturnType<typeof createTaaHistoryTargets>
  filterHistory: ReturnType<typeof createTaaFilterHistory>
  analysis: Awaited<ReturnType<typeof createTaaAnalysis>>
  resolve: HistoryResolve
  sampler: GPUSampler
  uniform: GPUBuffer
}

/** The update program an image runs, and what it writes: whether the history is larger than the
 *  display (`upscaled`) and whether the update writes the half-size image (`wrote`). */
function chooseUpdate(
  { resolves, history, filterHistory }: HistoryUpdateParts,
  inputs: TaaInputs,
  half: boolean,
  execution: TaaExecution,
) {
  const { shape } = history
  const upscaled = !!shape && isUpscaled(shape)
  // The update writes the half-size image where the history is the display's size and the
  // device binds the storage textures it takes; else the resolve does, or the chain draws it.
  const writing = half && !upscaled
  // Until the layered update is compiled, the image resolves no layer: composition reads the raw ones.
  const layered = inputs.filter
    ? resolves.of(true, writing && resolves.fits(true, true), execution)
    : undefined
  if (!layered) inputs.filter = undefined
  const wrote = writing && resolves.fits(!!layered, true)
  const update = layered ?? resolves.of(false, wrote, execution)!
  filterHistory.follow(inputs.filter, history.width, history.height)
  return { update, upscaled, wrote }
}

/** The update's dispatch over the history. */
function dispatchUpdate(
  steps: ComputeRun,
  pass: GPUComputePassDescriptor,
  update: Update,
  group: GPUBindGroup,
  history: { width: number; height: number },
) {
  const pipeline = update.stage.get()
  if (!pipeline) return
  const compute = steps.pass(pass)
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, group)
  compute.dispatchWorkgroups(
    ceilDiv(history.width, update.tile[0]),
    ceilDiv(history.height, update.tile[1]),
  )
}

/** The group of the update `update` over the frames of `slices` and the layers' history read
 *  (`layersRead`), kept in `groups` by them. */
function updateGroup(
  device: GPUDevice,
  parts: HistoryUpdateParts,
  groups: Map<number, GPUBindGroup>,
  inputs: TaaInputs,
  slices: FrameSlices,
  update: Update,
  wrote: boolean,
  layersRead: number,
) {
  const { history, filterHistory, analysis, sampler, uniform } = parts
  const frames = history.frames.length
  const key =
    (((slices.previous * frames + slices.resurrection) * frames + slices.current) << 1) | layersRead
  let group = groups.get(key)
  if (!group) {
    const frame = history.frames[slices.current]
    const entries = taaGroupEntries(
      inputs,
      history.frames[slices.previous],
      history.frames[slices.resurrection],
      sampler,
      uniform,
      analysis.views,
    )
    entries.push(
      ...filterHistory.entries(inputs.filter, layersRead),
      ...namedEntries(TAA_BINDINGS, {
        historyOut: frame.color,
        validityOut: frame.validity,
        ...(wrote && { halfOut: history.half! }),
      }),
    )
    group = device.createBindGroup({ layout: update.layout, entries })
    groups.set(key, group)
  }
  return group
}

/**
 * The history update of the temporal pass: a compute dispatch over the history, composing the image
 * from the last image's frame and, where a pixel is resurrected, the frame it is resurrected from,
 * and storing it to the frame the image is kept in, with its validity and the display layers
 * (`resolveWgsl.ts`, one program for every render scale and history size); where the history is the
 * display's size, the half-size image beside it; where the history is larger than the display, then
 * the resolve that brings it down (`historyResolve.ts`), which writes the half-size image. The bind
 * groups are made once for each identity the inputs were seen with and each frames read and
 * written, never per frame.
 */
export function createHistoryUpdate(device: GPUDevice, parts: HistoryUpdateParts) {
  const { resolves, history, filterHistory, resolve } = parts
  const pass = { label: TAA_UPDATE_HISTORY_PASS }
  /** The update's groups, for each identity the inputs were seen with — the lit image is one of two
   *  HDR targets that take turns, references traded (`lighting/reflections/litImage.ts`) —, by the frames read
   *  and written and the layers' history read. */
  const held: Map<number, GPUBindGroup>[] = []
  /** What the groups name: the layout, then each of `INPUTS` (`bindIdentity.ts`); two held, the HDR
   *  targets' turns. */
  const identity = createWebgpuBindIdentity(2)
  /** The layers' history read on the next frame: the other is written. */
  let layersRead = 0
  /** The image the composition reads where the history needs no resolve: rewritten at each image. */
  const image = {} as AccumulatedImage
  return {
    /** The programs the update of `inputs` runs, then its resolve where the history is larger than
     *  the display (`half`, `execution` as `encode`): the chain, run whole or not at all. As
     *  `encode`, drops the layers `inputs` carries while their program is not compiled. */
    stages(inputs: TaaInputs, half: boolean, execution: TaaExecution) {
      const { update, upscaled } = chooseUpdate(parts, inputs, half, execution)
      return upscaled ? [update.stage, ...resolve.stages(!!inputs.filter, half)] : [update.stage]
    },
    /** Asks the programs a history of the display's size (`half`) or a larger one runs. */
    ask: (half: boolean) => resolves.ask(half),
    /** Makes the groups again: they name the analysis's targets. */
    regroup: () => void (held.length = 0),
    /** Forgets the groups, which name the targets that are gone. */
    drop: () => void (held.length = 0),
    /**
     * Encodes the update of `inputs` into the frame `slices.current`, reading the frames
     * `slices.previous` and `slices.resurrection`, as `execution` runs it, then, where the history is
     * larger than the display, its resolve. Both write the half-size image when `half`, if the
     * device binds it. Returns the image the composition reads: the frame's colour or the resolved
     * one, and the display layers.
     */
    encode(
      steps: ComputeRun,
      inputs: TaaInputs,
      slices: FrameSlices,
      half: boolean,
      execution: TaaExecution,
    ): AccumulatedImage {
      const { update, upscaled, wrote } = chooseUpdate(parts, inputs, half, execution)
      const { next } = identity
      next[0] = update.layout
      for (let i = 0; i < INPUTS.length; i++) next[1 + i] = inputs[INPUTS[i]]
      const moved = identity.moved(),
        groups = (held[identity.slot] ??= new Map())
      if (moved) groups.clear()
      const group = updateGroup(device, parts, groups, inputs, slices, update, wrote, layersRead)
      const frame = history.frames[slices.current]
      const write = 1 - layersRead,
        filter = inputs.filter && filterHistory.target(write)
      dispatchUpdate(steps, pass, update, group, history)
      layersRead = write
      filterHistory.written = !!filter
      if (upscaled) return resolve.encode(steps, frame, filter, history.half!, half)
      image.color = frame.color
      image.filter = filter
      image.half = wrote ? history.half : undefined
      return image
    },
  }
}
