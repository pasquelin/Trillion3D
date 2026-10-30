import { TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { createTaaResolves } from './resolve.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { createTaaHistoryTargets } from './historyTargets.ts'
import type { TaaInputs } from './inputs.ts'
import type { Velocity } from './velocity.ts'
import { createTaaFilterHistory } from './layers.ts'
import { createHistoryUpdate } from './historyUpdate.ts'
import { createHistoryResolve } from './historyResolve.ts'
import { createTaaAnalysis } from './analysis.ts'
import type { AnalysisWork } from './levels.ts'
import { createShapeMemo, isUpscaled, sameShape, type HistoryShape } from './historyShape.ts'
import { createFrameRing, type FrameSlices } from './historyFrames.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { createStandIns } from './frameStandIns.ts'
import { chainReady } from '../../lighting/deferred/fullscreen.ts'
import { defaultExecution, type TaaExecution } from './waveOps.ts'
import { uniformBuffer } from '../../gpu/core/uniformBlock.ts'

/** The view's uniform and the sampler every group of the pass names. */
function createViewResources(device: GPUDevice) {
  const uniform = uniformBuffer(device, 'Trillion3D TAA view v1', TAA_VIEW_BYTES)
  // Bilinear and clamped: the histories' reads and the anti-aliaser's luma reads, which must not
  // wrap across the image's edge.
  const sampler = postSamplers(device).clamped
  return { uniform, sampler }
}

/** The targets of the pass and the passes that write them (`createTargets`). */
interface Targets {
  readonly history: ReturnType<typeof createTaaHistoryTargets>
  readonly filterHistory: ReturnType<typeof createTaaFilterHistory>
  readonly resolve: ReturnType<typeof createHistoryResolve>
  readonly analysis: Awaited<ReturnType<typeof createTaaAnalysis>>
  readonly update: ReturnType<typeof createHistoryUpdate>
  readonly drop: () => void
}

/** Remakes the targets of `targets` for a history of `shape` and the render targets' `rw × rh`, the
 *  largest a frame is drawn at; the frame state `frame` follows the history. Another render size
 *  at the same history keeps every history. True when a history was reallocated — the
 *  render-resolution ones go with the analysis's targets — and so is gone: the frames the history
 *  keeps are those of the new shape (`FrameRing`). */
function resizeTargets(
  { history, resolve, analysis, update, drop }: Targets,
  frame: Velocity['frame'],
  shape: HistoryShape,
  rw: number,
  rh: number,
): boolean {
  const kept = !!history.shape && sameShape(history.shape, shape)
  if (kept && rw === analysis.width && rh === analysis.height) return false
  // The groups name the render-resolution targets: made again with them.
  update.regroup()
  if (!kept) {
    drop()
    history.allocate(shape)
    update.ask(!isUpscaled(shape))
    if (isUpscaled(shape)) {
      resolve.allocate(shape.displayWidth, shape.displayHeight, shape.formats.color)
      resolve.ask()
    }
    frame.ring = createFrameRing(shape.sequence)
    frame.historyScale = shape.width / shape.displayWidth
  }
  analysis.allocate(rw, rh, {
    sequence: shape.sequence,
    field: shape.field,
    antiAlias: shape.antiAlias,
    formats: shape.formats,
  })
  return true
}

/** The targets of the pass and the passes that write them: the history's frames, their display
 *  layers, the resolve that brings a larger history down, the analysis's render-resolution targets
 *  and the history update, which `execution` runs. */
async function createTargets(
  device: GPUDevice,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  frame: Velocity['frame'],
  execution: TaaExecution,
  packed: boolean,
) {
  const resolves = await createTaaResolves(device, execution, packed)
  const filterHistory = createTaaFilterHistory(device, loadOnlyUsage())
  const analysis = await createTaaAnalysis(device, sampler, uniform, packed)
  const history = createTaaHistoryTargets(device)
  const resolve = createHistoryResolve(device, uniform)
  const update = createHistoryUpdate(device, {
    resolves,
    history,
    filterHistory,
    analysis,
    resolve,
    sampler,
    uniform,
  })
  /** The size the render-resolution histories are allocated at, the uniform's analysis grid. */
  const analysisSize = [0, 0]
  const drop = () => {
    history.drop()
    update.drop()
    filterHistory.drop()
    resolve.drop()
    analysis.release()
  }
  const targets = {
    history,
    filterHistory,
    resolve,
    analysis,
    update,
    drop,
    /** The size the analysis's targets and render-resolution histories are made at. */
    get analysisSize(): readonly number[] {
      analysisSize[0] = analysis.width
      analysisSize[1] = analysis.height
      return analysisSize
    },
    /** Bytes of the targets as allocated: what a capture must count beside its own. */
    get bytes() {
      return history.bytes + filterHistory.bytes + analysis.bytes + resolve.bytes
    },
    /** Remakes the targets for a history of `shape` and the render targets' `rw × rh`: true when a
     *  history was reallocated (`resizeTargets`). */
    resize: (shape: HistoryShape, rw: number, rh: number): boolean =>
      resizeTargets(targets, frame, shape, rw, rh),
  }
  return targets
}

/**
 * The encoding of the pass, its uniform written first: the analysis of `inputs` drawn at `render`
 * (`[width, height]`), in the frames of `slices` (`planFrame`), through an `orthographic`
 * projection or not, then the history update, which reads it and the history, writes the frame of
 * `slices.current` and, where the history is the display's size, the half-size image when `half`,
 * as `run` executes it (the pass's `execution` by default), and the resolve where the history is
 * larger than the display, which writes the half-size image when `half`. Returns the image
 * composition reads: the written colour, half-size image and display layers. A frame whose blends
 * carry no responsiveness or translucency reads the `standIns`.
 */
function createTaaEncoding(
  { analysis, update, history }: Pick<Targets, 'analysis' | 'update' | 'history'>,
  execution: TaaExecution,
  standIns: { responsive: GPUTextureView; translucency: GPUTextureView },
) {
  // The analysis, the update and the resolve follow one another: one compute pass unless timed.
  const steps = new ComputeRun()
  return (
    encoder: GPUCommandEncoder,
    inputs: TaaInputs,
    render: readonly [number, number],
    slices: FrameSlices,
    orthographic = false,
    work?: AnalysisWork,
    half = false,
    run: TaaExecution = execution,
  ) => {
    if (!history.shape) throw new Error('TAA_TARGETS_MISSING')
    inputs.translucency ??= standIns.translucency
    inputs.responsive ??= standIns.responsive
    steps.begin(encoder)
    analysis.encode(steps, inputs, render, orthographic, slices, work, run)
    const output = update.encode(steps, inputs, slices, half, run)
    steps.end()
    return output
  }
}

/** The display layers' targets: the history of the filtering blends' layers and what the resolve
 *  writes of them. */
const layersOf = ({ filterHistory, resolve }: Targets) => ({
  get bytes() {
    return filterHistory.bytes + resolve.layerBytes
  },
  /** The bytes made since last asked: what the frame's target bytes add. */
  uncounted: () => filterHistory.uncounted() + resolve.uncounted(),
  drop() {
    filterHistory.drop()
    resolve.dropLayers()
  },
})

/** The pass's members that are values or functions: the uniform, the histories' views, the shape
 *  memo, the frame inputs and state, and the encodings. */
function passMembers(
  device: GPUDevice,
  velocity: Velocity,
  execution: TaaExecution,
  packed: boolean,
  targets: Awaited<ReturnType<typeof createTargets>>,
  uniform: GPUBuffer,
  standIns: ReturnType<typeof createStandIns>,
) {
  const { analysis, update, history } = targets
  return {
    uniform,
    /** Whether the pass was made with the packed history formats (`temporalHistoryPacked`). */
    packed,
    filterHistory: targets.filterHistory,
    layers: layersOf(targets),
    /** The shape the history of a display `width × height` is to have at the level of `knobs` and
     *  with `settings` (`historyShapeOf`), the last one asked returned while they stand. */
    wanted: createShapeMemo(device),
    /** Draft of the frame inputs, filled by `encodeTaaPass`: nothing is allocated per frame. */
    inputs: {} as TaaInputs,
    /** What the pass keeps from frame to frame on the CPU: jitter, history, motion; the velocity
     *  stage keeps the view's last image with it (`velocity.frame`). */
    frame: velocity.frame,
    resize: targets.resize,
    /** Encodes the measures taken on the scene before the translucency is composed onto it
     *  (`TaaAnalysis.measure`): the flicker luma and, where the thin geometry detection runs, the
     *  material's coverage. */
    measure: analysis.measure,
    /** Whether every program of the pass's chain is compiled — the analysis of `work`, the update
     *  and the resolve (`encode`'s arguments) —, each missing one asked: a pass whose steps read
     *  what the ones before wrote runs whole or not at all. */
    ready: (
      inputs: TaaInputs,
      slices: FrameSlices,
      work: AnalysisWork,
      half: boolean,
      run: TaaExecution = execution,
    ) =>
      chainReady(
        ...analysis.stages(work, slices.resurrects, run, !!inputs.reducedTranslucency),
        ...update.stages(inputs, half, run),
      ),
    encode: createTaaEncoding({ analysis, update, history }, execution, standIns),
    /** Releases the targets with the frame targets, history gone, until the next `resize`. */
    release: targets.drop,
  }
}

/**
 * Temporal antialiasing pass: the history's frames, each a colour and its validity at the
 * history's size (`historyTargets.ts`, `historyFrames.ts`), one read as the last image's — and,
 * with the resurrection, another as the frame a pixel may be resurrected from — and one written
 * each frame, and, where the history is larger than the display's, the resolve that brings it down
 * to the colour composition reads (`historyResolve.ts`); and the render-resolution
 * histories of the analysis (`analysis.ts`) — the shading history of each frame, the flicker
 * measure —, one of each, read first and written last. The histories follow the display size and
 * the level's percent, the analysis the render targets' (`resize`). The analysis runs over the
 * rendered size, then the history update (`historyUpdate.ts`), a compute dispatch over the history,
 * one program for every render scale (`resolveWgsl.ts`), as `execution` runs it (`waveOps.ts`): the
 * device's wave variants at the reference's defaults where none is given.
 */
export async function createTemporalAntialiasing(
  device: GPUDevice,
  velocity: Velocity,
  execution = defaultExecution(device),
  packed = true,
) {
  const { uniform, sampler } = createViewResources(device)
  const targets = await createTargets(device, sampler, uniform, velocity.frame, execution, packed)
  const standIns = createStandIns(device)
  return {
    ...passMembers(device, velocity, execution, packed, targets, uniform, standIns),
    get analysisSize() {
      return targets.analysisSize
    },
    get historyBytes() {
      return targets.bytes
    },
    /** The shape the history was made as, none before `resize`. */
    get shape() {
      return targets.history.shape
    },
    dispose() {
      targets.drop()
      targets.resolve.dispose()
      uniform.destroy()
      standIns.destroy()
      this.inputs = {} as TaaInputs
    },
  }
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>
