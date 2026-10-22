import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { dispatchOn } from '../../../gpu/core/computeStages.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { PreparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { BOKEH_LUT_SIZE, DRAW_ARGUMENT_WORDS, GROUP } from './dofLayout.ts'
import { gathersLayer, scattersOver } from './dofConvolutions.ts'
import { GATHER_LAYERS } from './dofLayerWgsl.ts'
import type { DofGroups } from './dofGroups.ts'
import type { DofImages } from './dofImages.ts'
import { reducePasses, tilesOf, type DofPlan } from './dofPlan.ts'
import { dilateConstants, type DofPrograms } from './dofPrograms.ts'
import { LUT_FORMATS } from './dofLutWgsl.ts'
import { POSTFILTER_METHODS } from './dofPostfilterWgsl.ts'

/** One dispatch of a compute pass: its pipeline, its group and the workgroups it runs. */
interface Step {
  readonly pipeline: PreparedPipeline<GPUComputePipeline>
  readonly group: GPUBindGroup
  readonly across: number
  readonly down: number
}

/** What a frame encodes: the compute passes before the scattered sprites and after, and each layer's
 *  sprite draw. */
export interface DofSteps {
  readonly before: readonly Step[]
  readonly sprites: readonly Sprite[]
  readonly recombine: Step
  /** Every pipeline the steps name, to be asked together. */
  readonly pipelines: readonly PreparedPipeline<unknown>[]
}

/** A draw of one layer's sprites over its colour. */
interface Sprite {
  readonly pipeline: PreparedPipeline<GPURenderPipeline>
  readonly group: GPUBindGroup
  readonly target: GPUTextureView
  readonly slot: number
}

/** One dispatch of `pipeline` on `group`, over `w × h` texels: the workgroups a side that cover them. */
const over = (pipeline: Step['pipeline'], group: GPUBindGroup, w: number, h: number): Step => ({
  pipeline,
  group,
  across: ceilDiv(w, GROUP),
  down: ceilDiv(h, GROUP),
})

/** The tables of a plan that are to be built, each its kind and its group. */
function lutSteps(plan: DofPlan, groups: DofGroups, programs: DofPrograms, stale: boolean) {
  if (!stale) return []
  const rounded = plan.bokeh.shape === 'rounded' ? 1 : 0
  const table = (format: number, group: GPUBindGroup | undefined): Step[] =>
    group
      ? [
          over(
            programs.compute('lut', { FORMAT: format, ROUNDED: rounded }),
            group,
            BOKEH_LUT_SIZE,
            BOKEH_LUT_SIZE,
          ),
        ]
      : []
  return [
    ...table(LUT_FORMATS.gather, groups.luts.gather),
    ...table(LUT_FORMATS.edge, groups.luts.scatter),
    ...table(LUT_FORMATS.fullSize, groups.luts.recombine),
  ]
}

/** The reduction of the setup, level by level, and the packing of the sprite lists it filled. */
function reduceSteps(plan: DofPlan, groups: DofGroups, programs: DofPrograms) {
  const [px, py] = plan.pre
  const fg = scattersOver(plan, 'foreground') ? 1 : 0
  const bg = scattersOver(plan, 'background') ? 1 : 0
  const steps = reducePasses(plan.mips).map(({ first, from, count }, at) => {
    const constants = {
      FIRST: first ? 1 : 0,
      REDUCTIONS: first ? count - 1 : count,
      SCATTER_FG: first ? fg : 0,
      SCATTER_BG: first ? bg : 0,
    }
    const size = [ceilDiv(px, 2 ** from), ceilDiv(py, 2 ** from)]
    return over(programs.compute('reduce', constants), groups.reduces[at], size[0], size[1])
  })
  if (groups.pack)
    steps.push({
      pipeline: programs.compute('pack', { SCATTER_FG: fg, SCATTER_BG: bg }),
      group: groups.pack,
      across: 2,
      down: 1,
    })
  return steps
}

/** The setup, its accumulation in time, tiles, reduction and tables: what the gathers read. */
function prepareSteps(plan: DofPlan, groups: DofGroups, programs: DofPrograms, lutsStale: boolean) {
  const [gx, gy] = plan.gather
  const [px, py] = plan.pre
  const tiles = tilesOf(plan)
  const { compute } = programs
  const steps: Step[] = [
    plan.divisor === 2
      ? over(compute('setupHalf'), groups.setup, gx, gy)
      : over(compute('setupFull'), groups.setup, plan.full[0], plan.full[1]),
  ]
  if (groups.temporal) {
    const constants = { HIGH: plan.temporalHigh ? 1 : 0, DIVISOR: plan.divisor }
    steps.push(over(compute('temporal', constants), groups.temporal, px, py))
  }
  steps.push(
    over(compute('flatten', { GATHER4: px === gx && py === gy ? 0 : 1 }), groups.flatten, gx, gy),
  )
  plan.dilations.forEach((d, at) => {
    const pipeline = compute('dilate', dilateConstants(d.mode, d.radius))
    steps.push(over(pipeline, groups.dilates[at], tiles[0], tiles[1]))
  })
  if (groups.downsample)
    steps.push(over(compute('downsample'), groups.downsample, ceilDiv(px, 2), ceilDiv(py, 2)))
  return [
    ...steps,
    ...reduceSteps(plan, groups, programs),
    ...lutSteps(plan, groups, programs, lutsStale),
  ]
}

/** The layer's gather, then, for every layer that is filtered, its post-filter, and the sprites'
 *  draws. */
function convolutionSteps(
  plan: DofPlan,
  groups: DofGroups,
  images: DofImages,
  programs: DofPrograms,
) {
  const [gx, gy] = plan.gather
  const gathers: Step[] = []
  const filters: Step[] = []
  const sprites: Sprite[] = []
  plan.convolutions.forEach((conv, at) => {
    const layer = images.layers[conv.layer]!
    const gather = programs.compute('gather', {
      LAYER: GATHER_LAYERS[conv.layer],
      RINGS: conv.rings,
      QUALITY: conv.quality,
      BOKEH: conv.bokeh ? 1 : 0,
    })
    gathers.push(over(gather, groups.gathers[at], gx, gy))
    const filter = groups.postfilters[at]
    if (filter) {
      const postfilter = programs.compute('postfilter', {
        LAYER: GATHER_LAYERS[conv.layer],
        METHOD: POSTFILTER_METHODS[plan.postfilter === 2 ? 'max' : 'median'],
        TILE: plan.postfilter === 2 ? 1 : 0,
      })
      filters.push(over(postfilter, filter, gx, gy))
    }
    const sprite = groups.sprites[at]
    if (sprite)
      sprites.push({
        pipeline: programs.sprites({
          BACKGROUND: conv.layer === 'background' ? 1 : 0,
          BOKEH: plan.scatterLut ? 1 : 0,
          OCCLUSION: conv.quality >= 2 ? 1 : 0,
          HIGH: conv.quality >= 1 ? 1 : 0,
        }),
        group: sprite,
        target: (layer.filtered?.color ?? layer.color).view,
        slot: conv.layer === 'foreground' ? 0 : 1,
      })
  })
  return { before: [...gathers, ...filters], sprites }
}

/** The steps of one image's plan: `lutsStale` says the bokeh tables are to be built too. */
export function dofSteps(
  plan: DofPlan,
  groups: DofGroups,
  images: DofImages,
  programs: DofPrograms,
  lutsStale: boolean,
): DofSteps {
  const convolutions = convolutionSteps(plan, groups, images, programs)
  const before = [...prepareSteps(plan, groups, programs, lutsStale), ...convolutions.before]
  const pipeline = programs.compute('recombine', {
    QUALITY: plan.recombine,
    HAS_FG: gathersLayer(plan, 'foreground') ? 1 : 0,
    HAS_BG: gathersLayer(plan, 'background') ? 1 : 0,
    BOKEH: plan.recombineLut ? 1 : 0,
  })
  const recombine = over(pipeline, groups.recombine, plan.full[0], plan.full[1])
  return {
    before,
    sprites: convolutions.sprites,
    recombine,
    pipelines: [
      ...before.map((s) => s.pipeline),
      ...convolutions.sprites.map((s) => s.pipeline),
      recombine.pipeline,
    ],
  }
}

/** Dispatches `step` on `pass`. */
const run = (pass: GPUComputePassEncoder, { pipeline, group, across, down }: Step) =>
  dispatchOn(pass, pipeline, group, across, down)

/**
 * Encodes one image's depth of field: the draw's arguments cleared; the compute pass of the setup, the
 * tiles, the reduction, the tables and every layer's gather and post-filter; one render pass a layer
 * that scatters, its sprites drawn additively over the layer's colour by the arguments the reduction
 * counted; the recombine's compute pass. Returns the passes encoded.
 */
export function encodeDof(
  encoder: GPUCommandEncoder,
  steps: DofSteps,
  drawArguments: GPUBuffer,
  viewport: readonly [number, number],
) {
  const label = { label: DEPTH_OF_FIELD_PASS }
  let passes = 1
  if (steps.sprites.length) encoder.clearBuffer(drawArguments)
  const compute = encoder.beginComputePass(label)
  for (const step of steps.before) run(compute, step)
  compute.end()
  for (const sprite of steps.sprites) {
    const pass = encoder.beginRenderPass({
      ...label,
      colorAttachments: [{ view: sprite.target, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setViewport(0, 0, viewport[0], viewport[1], 0, 1)
    pass.setPipeline(sprite.pipeline.get())
    pass.setBindGroup(0, sprite.group)
    pass.drawIndirect(drawArguments, sprite.slot * DRAW_ARGUMENT_WORDS * 4)
    pass.end()
    passes++
  }
  const last = encoder.beginComputePass(label)
  run(last, steps.recombine)
  last.end()
  return passes + 1
}
