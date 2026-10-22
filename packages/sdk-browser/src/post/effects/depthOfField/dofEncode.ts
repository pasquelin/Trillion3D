import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { PreparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { DRAW_ARGUMENT_WORDS, GROUP } from './dofLayout.ts'
import { GATHER_LAYERS } from './dofLayerWgsl.ts'
import type { DofGroups } from './dofGroups.ts'
import type { DofImages } from './dofImages.ts'
import { reducePasses, type DofPlan } from './dofPlan.ts'
import { dilateConstants, type Constants, type DofPrograms } from './dofPrograms.ts'
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

/** The workgroups of a dispatch over `w × h` texels. */
const over = (w: number, h: number) => ({ across: ceilDiv(w, GROUP), down: ceilDiv(h, GROUP) })

/** The tables of a plan that are to be built, each its kind and its group. */
function lutSteps(plan: DofPlan, groups: DofGroups, programs: DofPrograms, stale: boolean) {
  if (!stale) return []
  const rounded = plan.bokeh.shape === 'rounded' ? 1 : 0
  const table = (format: number, group: GPUBindGroup | undefined): Step[] =>
    group
      ? [
          {
            pipeline: programs.compute('lut', { FORMAT: format, ROUNDED: rounded }),
            group,
            across: 4,
            down: 4,
          },
        ]
      : []
  return [
    ...table(LUT_FORMATS.gather, groups.luts.gather),
    ...table(LUT_FORMATS.edge, groups.luts.scatter),
    ...table(LUT_FORMATS.fullSize, groups.luts.recombine),
  ]
}

/** The setup, tiles, reduction and tables: what the gathers read. */
function prepareSteps(plan: DofPlan, groups: DofGroups, programs: DofPrograms, lutsStale: boolean) {
  const [gx, gy] = plan.gather
  const scatters = plan.foregroundScatter || plan.backgroundScatter
  const compute = (pass: Parameters<DofPrograms['compute']>[0], constants?: Constants) =>
    programs.compute(pass, constants)
  const steps: Step[] = [
    plan.divisor === 2
      ? { pipeline: compute('setupHalf'), group: groups.setup, ...over(gx, gy) }
      : {
          pipeline: compute('setupFull'),
          group: groups.setup,
          ...over(plan.full[0], plan.full[1]),
        },
    { pipeline: compute('flatten'), group: groups.flatten, ...over(gx, gy) },
    ...plan.dilations.map((d, at) => ({
      pipeline: compute('dilate', dilateConstants(d.mode, d.radius)),
      group: groups.dilates[at],
      ...over(plan.tiles[0], plan.tiles[1]),
    })),
  ]
  if (groups.downsample)
    steps.push({
      pipeline: compute('downsample'),
      group: groups.downsample,
      ...over(ceilDiv(gx, 2), ceilDiv(gy, 2)),
    })
  reducePasses(plan.mips).forEach(({ first, from, count }, at) =>
    steps.push({
      pipeline: compute('reduce', {
        FIRST: first ? 1 : 0,
        REDUCTIONS: first ? count - 1 : count,
        SCATTER_FG: first && plan.foregroundScatter ? 1 : 0,
        SCATTER_BG: first && plan.backgroundScatter ? 1 : 0,
      }),
      group: groups.reduces[at],
      ...over(ceilDiv(gx, 2 ** from), ceilDiv(gy, 2 ** from)),
    }),
  )
  if (scatters && groups.pack)
    steps.push({
      pipeline: compute('pack', {
        SCATTER_FG: plan.foregroundScatter ? 1 : 0,
        SCATTER_BG: plan.backgroundScatter ? 1 : 0,
      }),
      group: groups.pack,
      across: 2,
      down: 1,
    })
  return [...steps, ...lutSteps(plan, groups, programs, lutsStale)]
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
    gathers.push({
      pipeline: programs.compute('gather', {
        LAYER: GATHER_LAYERS[conv.layer],
        RINGS: conv.rings,
        QUALITY: conv.quality,
        BOKEH: conv.bokeh ? 1 : 0,
      }),
      group: groups.gathers[at],
      ...over(gx, gy),
    })
    const filter = groups.postfilters[at]
    if (filter)
      filters.push({
        pipeline: programs.compute('postfilter', {
          LAYER: GATHER_LAYERS[conv.layer],
          METHOD: POSTFILTER_METHODS[plan.postfilter === 2 ? 'max' : 'median'],
          TILE: plan.postfilter === 2 ? 1 : 0,
        }),
        group: filter,
        ...over(gx, gy),
      })
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
  const recombine: Step = {
    pipeline: programs.compute('recombine', {
      QUALITY: plan.recombine,
      HAS_FG: plan.gatherForeground ? 1 : 0,
      HAS_BG: plan.gatherBackground ? 1 : 0,
      BOKEH: plan.recombineLut ? 1 : 0,
    }),
    group: groups.recombine,
    ...over(plan.full[0], plan.full[1]),
  }
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
function run(pass: GPUComputePassEncoder, { pipeline, group, across, down }: Step) {
  pass.setPipeline(pipeline.get())
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(across, down)
}

/**
 * Encodes one image's depth of field: the draw's arguments cleared; the compute pass of the setup, the
 * tiles, the reduction, the tables and every layer's gather and post-filter; one render pass a layer
 * that scatters, its sprites drawn additively over the layer's colour by the arguments the reduction
 * counted; the recombine's compute pass. Returns the passes encoded.
 */
export function encodeDof(
  encoder: GPUCommandEncoder,
  steps: DofSteps,
  params: { drawArguments: GPUBuffer; viewport: readonly [number, number] },
) {
  const label = { label: DEPTH_OF_FIELD_PASS }
  let passes = 1
  if (steps.sprites.length) encoder.clearBuffer(params.drawArguments)
  const compute = encoder.beginComputePass(label)
  for (const step of steps.before) run(compute, step)
  compute.end()
  for (const sprite of steps.sprites) {
    const pass = encoder.beginRenderPass({
      ...label,
      colorAttachments: [{ view: sprite.target, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setViewport(0, 0, params.viewport[0], params.viewport[1], 0, 1)
    pass.setPipeline(sprite.pipeline.get())
    pass.setBindGroup(0, sprite.group)
    pass.drawIndirect(params.drawArguments, sprite.slot * DRAW_ARGUMENT_WORDS * 4)
    pass.end()
    passes++
  }
  const last = encoder.beginComputePass(label)
  run(last, steps.recombine)
  last.end()
  return passes + 1
}
