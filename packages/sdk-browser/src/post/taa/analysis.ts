import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { FULL_ANALYSIS, type AnalysisWork } from './levels.ts'
import type { TaaInputs } from './inputs.ts'
import { createAnalysisGroups } from './analysisGroups.ts'
import { createAnalysisLayouts, fusedVelocityFits } from './analysisLayouts.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { DISPATCHES, FUSED_TILE, createAnalysisPipelines, variantOf } from './analysisPipelines.ts'
import type { FrameSlices } from './historyFrames.ts'
import type { TaaExecution } from './waveOps.ts'
import {
  createAnalysisTargets,
  type AnalysisShape,
  type AnalysisTargetViews,
} from './analysisTargets.ts'
import { historyFormatsOf } from './historyShape.ts'
import { MEASURE_BINDINGS, MEASURE_TILE, MEASURE_VIEW_BYTES } from './flickerLumaWgsl.ts'
import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import {
  TAA_MEASURE_FLICKERING_LUMA_PASS,
  TAA_MEASURE_THIN_COVERAGE_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import type { AnalysisLayouts } from './analysisLayouts.ts'

/** The analysis's pipelines (`createAnalysisPipelines`). */
type Pipelines = Awaited<ReturnType<typeof createAnalysisPipelines>>
type AnalysisGroups = ReturnType<typeof createAnalysisGroups>
type AnalysisTargets = ReturnType<typeof createAnalysisTargets>

/** The nearest velocity's pipeline and group when it flattens the motion blur's motion too. */
type FusedDispatch = { pipeline: GPUComputePipeline; group: GPUBindGroup }
/** The dispatches of `DISPATCHES` the `work` runs, each with its place `at` among them — its
 *  group's among the groups of an image (`createAnalysisGroups`) — and its program: the nearest
 *  velocity of an image that draws displaced surfaces where `tessellated`, otherwise the one of
 *  `stages` for a history that `resurrects` where it does, as `run` executes it (`variantOf`): the 16-bit ones of
 *  the shading rejection, the flicker measure and the anti-aliaser where it asks them and the
 *  device has them, their wave ones where the wave is the tile's width. The flicker measure is
 *  left out where the level does not run it (`work.flicker`), which is where neither
 *  `view.quality.x` nor an analysis view asks the shading rejection for it (`flickerMeasured`). */
function* stagesOf(
  { stages, displaced }: Pipelines,
  work: AnalysisWork,
  tessellated: boolean,
  resurrects: boolean,
  run: TaaExecution,
) {
  const variant = variantOf(run)
  for (const [at, dispatch] of DISPATCHES.entries()) {
    const { name } = dispatch
    if ((name === 'thin' || name === 'relaxation') && !work.thin) continue
    if (name === 'flicker' && !work.flicker) continue
    if (name === 'antiAlias' && !work.antiAlias) continue
    const varied = stages[at][Number(resurrects)][variant]
    yield { at, dispatch, stage: name === 'nearest' && tessellated ? displaced : varied }
  }
}

/** The dispatches of the analysis over `render` texels, each in its compute pass of
 *  `DISPATCHES`, each over its group of `set` at its place (`stagesOf` for the programs); the nearest velocity's
 *  pipeline is `fused`, the one that flattens the motion blur's motion, where it is given. */
function dispatchAnalysis(
  steps: ComputeRun,
  programs: Pipelines,
  set: GPUBindGroup[],
  render: readonly [number, number],
  work: AnalysisWork,
  tessellated: boolean,
  resurrects: boolean,
  run: TaaExecution,
  fused?: FusedDispatch,
) {
  for (const { at, dispatch, stage } of stagesOf(programs, work, tessellated, resurrects, run)) {
    const { name, pass: descriptor, tile } = dispatch
    const pipeline = fused && name === 'nearest' ? fused.pipeline : stage.get()
    if (!pipeline) continue
    const pass = steps.pass(descriptor)
    if (name === 'nearest' && fused) {
      // The nearest velocity that flattens the motion blur's motion too: a tile of the blur's.
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, fused.group)
      pass.dispatchWorkgroups(ceilDiv(render[0], FUSED_TILE), ceilDiv(render[1], FUSED_TILE))
      continue
    }
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, set[at])
    pass.dispatchWorkgroups(ceilDiv(render[0], tile[0]), ceilDiv(render[1], tile[1]))
  }
}

const LUMA_PASS: GPUComputePassDescriptor = { label: TAA_MEASURE_FLICKERING_LUMA_PASS }
const COVERAGE_PASS: GPUComputePassDescriptor = { label: TAA_MEASURE_THIN_COVERAGE_PASS }
/** The measures' dispatches, one compute pass but on a frame timed per pass. */
const measureRun = new ComputeRun()

/** A dispatch of a measure over the `render` texels. */
function measurePass(
  descriptor: GPUComputePassDescriptor,
  pipeline: GPUComputePipeline | undefined,
  group: GPUBindGroup,
  render: readonly number[],
) {
  if (!pipeline) return
  const compute = measureRun.pass(descriptor)
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, group)
  compute.dispatchWorkgroups(ceilDiv(render[0], MEASURE_TILE), ceilDiv(render[1], MEASURE_TILE))
}

/** What the thin coverage measure reads of the frame: the visibility buffer and its pages, the
 *  surfaces' flags word, and the index of the thin geometry shading range
 *  (`THIN_GEOMETRY_SHADING_RANGES`). */
export interface MeasuredScene {
  ids: GPUTextureView
  pages: GPUBuffer
  flags: GPUTextureView
  range: number
}

/** The groups of the two measures, over the `image` and the visibility buffer. */
function measureGroups(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  uniform: GPUBuffer,
  image: GPUTextureView,
  visibility: MeasuredScene,
  t: AnalysisTargetViews,
) {
  return {
    luma: device.createBindGroup({
      layout: layouts.measure.luma,
      entries: namedEntries(MEASURE_BINDINGS, {
        view: { buffer: uniform },
        image,
        out: t.measureLuma,
      }),
    }),
    coverage: device.createBindGroup({
      layout: layouts.measure.coverage,
      entries: namedEntries(MEASURE_BINDINGS, {
        view: { buffer: uniform },
        ids: visibility.ids,
        pages: { buffer: visibility.pages },
        out: t.measureCoverage,
        flags: visibility.flags,
      }),
    }),
  }
}

/** The measures' pipelines, the flicker luma's and the thin coverage's. */
type MeasurePipelines = Record<'luma' | 'coverage', { get(): GPUComputePipeline | undefined }>

/** Whether the measures' uniform already holds `scale`, the `render` size and the shading `range`. */
function measureViewHeld(
  written: { scale: number; width: number; height: number; range: number } | undefined,
  scale: number,
  render: readonly number[],
  range: number,
): boolean {
  return (
    !!written &&
    written.scale === scale &&
    written.range === range &&
    written.width === render[0] &&
    written.height === render[1]
  )
}

/** The measures' dispatches over `render` texels: the flicker luma, then the thin coverage where
 *  the thin geometry detection runs. */
function encodeMeasures(
  encoder: GPUCommandEncoder,
  pipelines: MeasurePipelines,
  groups: { luma: GPUBindGroup; coverage: GPUBindGroup },
  render: readonly number[],
  thin: boolean,
) {
  measureRun.begin(encoder)
  measurePass(LUMA_PASS, pipelines.luma.get(), groups.luma, render)
  if (thin) measurePass(COVERAGE_PASS, pipelines.coverage.get(), groups.coverage, render)
  measureRun.end()
}

/**
 * THE MEASURES TAKEN BEFORE THE TRANSLUCENCY, each a dispatch in a compute pass of its own over the
 * `render` texels, on the scene the transparent layers are not yet composed onto: the flicker luma of
 * `image` (`measureFlickerLumaShader`), exposed by `scale`, and where the thin geometry detection runs
 * this image (`thin`) the material's coverage of the visibility buffer (`measureThinCoverageShader`),
 * each into its layer of the measures (`MEASURE_LAYERS`). Their uniform written at the call; their
 * groups made again where what they name moved, two held — the image is one of two targets taking
 * turns.
 */
function createMeasures(device: GPUDevice, layouts: AnalysisLayouts, pipelines: MeasurePipelines) {
  const uniform = device.createBuffer({
    label: 'Trillion3D TAA measures view',
    size: MEASURE_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Float32Array(MEASURE_VIEW_BYTES / 4)
  const identity = createWebgpuBindIdentity(2)
  const held: ({ luma: GPUBindGroup; coverage: GPUBindGroup } | undefined)[] = []
  // What the uniform holds: written again only where one of its words changed.
  let written: { scale: number; width: number; height: number; range: number } | undefined
  return {
    encode(
      encoder: GPUCommandEncoder,
      image: GPUTextureView,
      visibility: MeasuredScene,
      t: AnalysisTargetViews,
      render: readonly number[],
      scale: number,
      thin: boolean,
    ) {
      if (!measureViewHeld(written, scale, render, visibility.range)) {
        words[0] = scale
        words[1] = render[0]
        words[2] = render[1]
        words[3] = visibility.range
        device.queue.writeBuffer(uniform, 0, words)
        written = { scale, width: render[0], height: render[1], range: visibility.range }
      }
      const { next } = identity
      next[0] = image
      next[1] = visibility.ids
      next[2] = visibility.pages
      next[3] = t.measureLuma
      next[4] = t.measureCoverage
      next[5] = visibility.flags
      if (identity.moved() || !held[identity.slot])
        held[identity.slot] = measureGroups(device, layouts, uniform, image, visibility, t)
      encodeMeasures(encoder, pipelines, held[identity.slot]!, render, thin)
    },
    clear() {
      identity.clear()
      held.length = 0
      written = undefined
    },
  }
}

/** The nearest velocity that flattens the motion blur's motion into `inputs.flatten`, marked
 *  written: once its program has compiled — asked off the frame until then, the blur flattening its
 *  motion itself — and the device binds the textures it writes. */
function fusedDispatch(
  device: GPUDevice,
  programs: Pipelines,
  groups: AnalysisGroups,
  inputs: TaaInputs,
  t: AnalysisTargetViews,
  tessellated: boolean,
): FusedDispatch | undefined {
  const { flatten } = inputs
  if (!flatten || !fusedVelocityFits(device.limits, flatten.variant)) return undefined
  const stages = programs.fused(flatten.variant)
  const stage = tessellated ? stages.displaced : stages.flat
  const pipeline = stage.get()
  if (!pipeline) return undefined
  flatten.written = true
  return { pipeline, group: groups.fused(inputs, t, flatten) }
}

/**
 * The encoding of the analysis of the frame's `inputs` over the `render` size, drawn through an
 * `orthographic` projection or not: each dispatch in its compute pass, the anti-aliaser's last —
 * the `work` the level runs (`AnalysisWork`), the nearest velocity solving the flat points of
 * displaced texels where `tessellated` (`TaaFrameState.tessellated`). The flicker measure runs
 * where the level rejects by it or an analysis view is shown
 * (`view.quality.x`, `view.params.w`); elsewhere the flicker history waits unwritten — an image
 * running it again drops the history (`encodeTaaPass`); the thin geometry detection is left out
 * where the level runs none, the passes that read its mask then reading none (`view.quality.w`).
 * The frames of `slices` are those the image reads, resurrects from and writes; the reprojection
 * and the shading rejection resurrect where they say the history `resurrects`. Without the
 * anti-aliaser, its target is left as it is: the history update, which takes the neutral offset
 * where the level runs none, reads none (`view.quality.y`). The programs are those `run` executes
 * (`variantOf`): in 16 bits where it asks and the device grants them, the shading rejection and
 * the flicker measure as a subgroup where their wave is the tile's width.
 */
function createAnalysisEncoding(
  device: GPUDevice,
  programs: Pipelines,
  groups: AnalysisGroups,
  targets: AnalysisTargets,
) {
  return (
    steps: ComputeRun,
    inputs: TaaInputs,
    render: readonly [number, number],
    orthographic: boolean,
    slices: FrameSlices,
    work: AnalysisWork = FULL_ANALYSIS,
    tessellated = false,
    run: TaaExecution,
  ) => {
    const t = targets.views
    if ((orthographic ? 2 : 1) > t.occluderSlices) targets.addOccluderSlice(t)
    // The flicker count is held while an analysis view is shown, the work `workOf` gives them all.
    targets.countFlicker(t, work.shown)
    // The groups first: the nearest velocity's that flattens the blur's motion follows their inputs.
    const set = groups.of(inputs, t, slices)
    const fused = fusedDispatch(device, programs, groups, inputs, t, tessellated)
    const { resurrects } = slices
    dispatchAnalysis(steps, programs, set, render, work, tessellated, resurrects, run, fused)
  }
}

/** The encoding of the measures taken before the translucency is composed onto an image: false, none
 *  encoded, before the targets are made. */
function createMeasureEncoding(
  targets: AnalysisTargets,
  measures: ReturnType<typeof createMeasures>,
) {
  return (
    encoder: GPUCommandEncoder,
    image: GPUTextureView,
    visibility: MeasuredScene,
    render: readonly number[],
    scale: number,
    thin: boolean,
  ) => {
    if (!targets.shape) return false
    measures.encode(encoder, image, visibility, targets.views, render, scale, thin)
    return true
  }
}

/**
 * The temporal pass's render-resolution analysis, before the history update, each step a dispatch
 * in a compute pass of its own (`DISPATCHES`), over the rendered size of targets made at the
 * render targets' size (`allocate`), the largest a frame is drawn at:
 * 1. the nearest velocity (`nearestVelocityWgsl.ts`), which finds each texel's closest surface,
 *    scatters the occluder words and, where the level reprojects by the field, writes each
 *    texel's jacobian and boundary;
 * 2. the history reprojection (`reprojectWgsl.ts`), which dilates the velocity stage's vectors by it,
 *    and reads the render-resolution histories the last image wrote into this image's targets — the
 *    shading history of the last image's frame and, where the history resurrects, of the frame a
 *    pixel may be resurrected from — and the occluder words;
 * 3. the thin geometry detection (`thinGeometryWgsl.ts`), which writes the thin geometry history
 *    and this image's mask, where the level runs it (`AnalysisWork`);
 * 4. the flicker measure (`flickerMeasureWgsl.ts`), where the level rejects by it, which writes
 *    the flicker history of this image's frame and the errors the shading rejection widens by;
 * 5. the shading rejection (`rejectionWgsl.ts`), which rejects each frame's history, decides the
 *    frame each pixel keeps, writes the rejection the history update reads, the shading history
 *    of this image's frame, the LDR luma, the reprojection of the pixels resurrected, and empties
 *    the occluder words for the next image;
 * 6. the spatial anti-aliaser (`spatialAntiAliasingWgsl.ts`), where the level runs one.
 * Its layouts, programs, targets and groups are `analysisLayouts.ts`, `analysisPipelines.ts`,
 * `analysisTargets.ts` and `analysisGroups.ts`.
 */
export async function createTaaAnalysis(
  device: GPUDevice,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  wpo: WpoSet = NO_WPO,
  packed = true,
) {
  const formats = historyFormatsOf(device.features, packed, device.limits)
  const layouts = createAnalysisLayouts(device, formats)
  const programs = await createAnalysisPipelines(device, layouts, formats, wpo)
  const groups = createAnalysisGroups(device, layouts, uniform, sampler)
  const measures = createMeasures(device, layouts, programs.measures)
  const targets = createAnalysisTargets(device, () => {
    groups.clear()
    measures.clear()
  })
  return {
    get bytes() {
      return targets.bytes
    },
    /** The shape the targets were made for, none before `allocate`. */
    get shape() {
      return targets.shape
    },
    /** The size the targets are made at, 0 × 0 before `allocate`. */
    get width() {
      return targets.width
    },
    get height() {
      return targets.height
    },
    /** The views of the targets the history update reads (`TAA_BINDINGS`). */
    get views() {
      return targets.views
    },
    /** Makes the targets at `w × h` for the history `shape`, the former ones dropped (the histories
     *  start empty), and asks the programs of a history that resurrects where it has frames to. */
    allocate(w: number, h: number, shape: AnalysisShape) {
      targets.allocate(w, h, shape)
      if (shape.sequence.storage > 1) programs.askResurrection()
    },
    /** Asks, off the thread, the nearest velocity of an image that draws displaced surfaces. */
    askDisplaced: () => programs.displaced.ask(),
    /** The programs the analysis of `work` runs for an image (`stagesOf`): the chain's, each step
     *  reading what the one before wrote. */
    stages: (work: AnalysisWork, tessellated: boolean, resurrects: boolean, run: TaaExecution) =>
      Array.from(stagesOf(programs, work, tessellated, resurrects, run), ({ stage }) => stage),
    /** Encodes the measures taken before the translucency is composed onto `image` (`measures`). */
    measure: createMeasureEncoding(targets, measures),
    encode: createAnalysisEncoding(device, programs, groups, targets),
    release: targets.release,
  }
}
