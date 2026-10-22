import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { TAA_PASS } from '../../diagnostic/stage/passLabels.ts'
import { FULL_ANALYSIS, type AnalysisWork } from './levels.ts'
import type { TaaInputs } from './inputs.ts'
import { createAnalysisGroups } from './analysisGroups.ts'
import { createAnalysisLayouts } from './analysisLayouts.ts'
import { FLICKER_DISPATCH, THIN_DISPATCH, createAnalysisPipelines } from './analysisPipelines.ts'
import { createAnalysisTargets, type AnalysisTargetViews } from './analysisTargets.ts'

/** The compute pass the dispatches share. */
const COMPUTE_PASS: GPUComputePassDescriptor = { label: TAA_PASS }

/** The analysis's pipelines (`createAnalysisPipelines`). */
type Pipelines = Awaited<ReturnType<typeof createAnalysisPipelines>>

/** The dispatches of the analysis over `render` texels in one compute pass, the `work` the level
 *  runs (`AnalysisWork`), each over its group of `set`. */
function dispatchAnalysis(
  encoder: GPUCommandEncoder,
  { pipelines, tiles }: Pipelines,
  set: GPUBindGroup[],
  render: readonly [number, number],
  work: AnalysisWork,
) {
  const pass = encoder.beginComputePass(COMPUTE_PASS)
  for (let s = 0; s < tiles.length; s++) {
    if (s === THIN_DISPATCH && !work.thin) continue
    if (s === FLICKER_DISPATCH && !work.flicker) continue
    pass.setPipeline(pipelines[s])
    pass.setBindGroup(0, set[s])
    pass.dispatchWorkgroups(ceilDiv(render[0], tiles[s][0]), ceilDiv(render[1], tiles[s][1]))
  }
  pass.end()
}

/** The spatial anti-aliaser's draw, or, without it, the clear of its target to its neutral word
 *  once, until it draws again. */
function drawAntiAlias(
  encoder: GPUCommandEncoder,
  { antiAlias }: Pipelines,
  t: AnalysisTargetViews,
  render: readonly [number, number],
  drawn: boolean,
) {
  if (!drawn) {
    if (!t.aaNeutralHeld) encoder.beginRenderPass(t.aaNeutral).end()
    t.aaNeutralHeld = true
    return
  }
  t.aaNeutralHeld = false
  const pass = encoder.beginRenderPass(t.aaPass)
  pass.setViewport(0, 0, render[0], render[1], 0, 1)
  pass.setPipeline(antiAlias)
  pass.setBindGroup(0, t.aaGroup)
  pass.draw(3)
  pass.end()
}

/**
 * The temporal pass's render-resolution analysis, before the history update, each pass a dispatch
 * of one compute pass over the rendered size of targets made at the render targets' size
 * (`allocate`), the largest a frame is drawn at:
 * 1. the nearest velocity (`nearestVelocityWgsl.ts`), which finds each texel's closest surface and
 *    scatters the occluder words;
 * 2. the history reprojection (`reprojectWgsl.ts`), which dilates the velocity stage's vectors by it,
 *    and reads the render-resolution histories the last image wrote into this image's targets, and
 *    the occluder words;
 * 3. the thin geometry detection (`thinGeometryWgsl.ts`), which writes the thin geometry history
 *    and this image's mask, where the level runs it (`AnalysisWork`);
 * 4. the flicker measure (`flickerWgsl.ts`), which writes the flicker history, where the level
 *    runs it (`AnalysisWork`);
 * 5. the held measure (`rejectionWgsl.ts`), the filtered input and history the rejection clamps,
 *    which empties the occluder words for the next image — none before the first, made empty;
 * 6. the shading rejection (`rejectionWgsl.ts`), which writes the shading history;
 * 7. the spatial anti-aliaser (`spatialAntiAliasingWgsl.ts`), a fullscreen draw.
 * Its layouts, programs, targets and groups are `analysisLayouts.ts`, `analysisPipelines.ts`,
 * `analysisTargets.ts` and `analysisGroups.ts`.
 */
export async function createTaaAnalysis(
  device: GPUDevice,
  sampler: GPUSampler,
  uniform: GPUBuffer,
) {
  const layouts = createAnalysisLayouts(device)
  const programs = await createAnalysisPipelines(device, layouts)
  const groups = createAnalysisGroups(device, layouts, uniform, sampler)
  const targets = createAnalysisTargets(device, sampler, uniform, layouts.antiAlias, groups.clear)
  return {
    /** Bytes of the targets as allocated. */
    get bytes() {
      return targets.bytes
    },
    /** The size the targets are made at, 0 × 0 before `allocate`. */
    get width() {
      return targets.width
    },
    get height() {
      return targets.height
    },
    /** Makes the targets at `w × h`, the former ones dropped: the render-resolution histories start
     *  empty. */
    allocate: targets.allocate,
    /** Each render texel's hole-filled reprojection vector (`TAA_BINDINGS.vectors`). */
    get vectors() {
      return targets.views.filled
    },
    /** Each render texel's shading rejection (`TAA_BINDINGS.rejection`). */
    get rejection() {
      return targets.views.rejection
    },
    /** The anti-aliaser's offset and noise filtering (`TAA_BINDINGS.antiAliasing`). */
    get antiAliasing() {
      return targets.views.antiAliasing
    },
    /** Encodes the analysis of the frame's `inputs` over the `render` size, drawn through an
     *  `orthographic` projection or not: the dispatches in one compute pass, then the anti-aliaser's
     *  draw — the `work` the level runs (`AnalysisWork`). Without the flicker measure, its
     *  dispatch is left out: the rejection reads no flicker error (`view.quality.x`), its history
     *  waits unwritten — an image running it again drops the history (`encodeTaaPass`); likewise
     *  the thin geometry detection, which the passes that read its mask then read none of
     *  (`view.quality.w`). The held measure, which runs at every level, empties the occluder
     *  words. Without the anti-aliaser, its target is cleared to its neutral word once, no draw,
     *  until it draws again. */
    encode(
      encoder: GPUCommandEncoder,
      inputs: TaaInputs,
      render: readonly [number, number],
      orthographic: boolean,
      work: AnalysisWork = FULL_ANALYSIS,
    ) {
      const t = targets.views
      if ((orthographic ? 2 : 1) > t.occluderSlices) targets.addOccluderSlice(t)
      dispatchAnalysis(encoder, programs, groups.of(inputs, t), render, work)
      drawAntiAlias(encoder, programs, t, render, work.antiAlias)
    },
    release: targets.release,
  }
}
