import { namedGroup, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { DOF_PARAMS_BINDING, DOF_STEP_BINDING } from './dofCommonWgsl.ts'
import type {
  DofImages,
  Image,
  LutImages,
  SetupImages,
  SpriteBuffers,
  TilePair,
} from './dofImages.ts'
import type { DofPrograms } from './dofPrograms.ts'
import { scattersOver, type Convolution } from './dofConvolutions.ts'
import { reducePasses, type DofPlan } from './dofPlan.ts'
import { DILATE_BINDINGS, FLATTEN_BINDINGS } from './dofTilesWgsl.ts'
import { DOWNSAMPLE_BINDINGS, SETUP_BINDINGS } from './dofSetupWgsl.ts'
import { TEMPORAL_BINDINGS } from './dofTemporalWgsl.ts'
import { REDUCE_BINDINGS } from './dofReduceWgsl.ts'
import { LUT_BINDINGS } from './dofLutWgsl.ts'
import { GATHER_BINDINGS } from './dofGatherStateWgsl.ts'
import { POSTFILTER_BINDINGS } from './dofPostfilterWgsl.ts'
import { PACK_BINDINGS, SPRITE_BINDINGS } from './dofScatterWgsl.ts'
import { RECOMBINE_BINDINGS } from './dofRecombineWgsl.ts'

/** What the groups name: the resources of a plan and the image's input and depth. */
interface GroupSources {
  readonly device: GPUDevice
  readonly programs: DofPrograms
  readonly plan: DofPlan
  readonly images: DofImages
  /** The setup accumulated in time, the pair this depth of field keeps, where the plan accumulates it. */
  readonly stable: readonly [SetupImages, SetupImages] | undefined
  readonly luts: LutImages | undefined
  readonly buffers: SpriteBuffers
  /** The uniform, and the uniforms of the dilations and of the reductions, one each. */
  readonly params: GPUBuffer
  readonly dilations: readonly GPUBuffer[]
  readonly reductions: readonly GPUBuffer[]
  /** The image drawn on, its depth, the motion of its texels (where the setup is accumulated in time)
   *  and the image the recombine writes. */
  readonly input: GPUTextureView
  readonly depth: GPUTextureView
  readonly vectors: GPUTextureView | undefined
  readonly output: GPUTextureView
  /** Which of the two accumulated setups this image writes (0 or 1). */
  readonly parity: number
}

/** The groups of the passes of one plan. */
export interface DofGroups {
  readonly setup: GPUBindGroup
  readonly temporal: GPUBindGroup | undefined
  readonly flatten: GPUBindGroup
  readonly dilates: readonly GPUBindGroup[]
  readonly downsample: GPUBindGroup | undefined
  readonly reduces: readonly GPUBindGroup[]
  readonly pack: GPUBindGroup | undefined
  /** The tables' groups, by kind. */
  readonly luts: { gather?: GPUBindGroup; scatter?: GPUBindGroup; recombine?: GPUBindGroup }
  /** One per convolution of the plan: its gather, its post-filter, its scattered sprites. */
  readonly gathers: readonly GPUBindGroup[]
  readonly postfilters: readonly (GPUBindGroup | undefined)[]
  readonly sprites: readonly (GPUBindGroup | undefined)[]
  readonly recombine: GPUBindGroup
}

/** A group of `layout` with the resources `entries` named by `bindings`, the uniform first. */
function groupOf(
  { device, params }: GroupSources,
  layout: GPUBindGroupLayout,
  bindings: Record<string, number>,
  resources: Record<string, GPUBindingResource>,
  extra: GPUBindGroupEntry[] = [],
) {
  return namedGroup(device, layout, bindings, resources, DEPTH_OF_FIELD_PASS, [
    { binding: DOF_PARAMS_BINDING, resource: wholeBuffer(params) },
    ...extra,
  ])
}

/** The setup the passes after its accumulation read: the setup itself, or where the plan accumulates
 *  it in time, what this image wrote of the two (`parity`) — at a divisor of 1 the setup's colour is
 *  the image itself. */
function setupOf({ plan, images, stable, input, parity }: GroupSources) {
  const written = stable?.[parity]
  if (written) return { color: written.color.view, coc: written.coc.view }
  const { setup } = images
  return { color: plan.divisor === 2 ? setup.color.view : input, coc: setup.coc.view }
}

/** The group of the setup's accumulation in time, where the plan has one: the setup this image made and
 *  the history, the other of the two. */
function temporalGroup(io: GroupSources) {
  const { programs, plan, images, stable, input, depth, vectors, parity } = io
  if (!stable || !vectors) return undefined
  const current = plan.divisor === 2 ? images.setup.color.view : input
  return groupOf(io, programs.layouts.temporal, TEMPORAL_BINDINGS, {
    color: current,
    coc: images.setup.coc.view,
    depth,
    vectors,
    historyColor: stable[1 - parity].color.view,
    historyCoc: stable[1 - parity].coc.view,
    sampler: programs.samplers.clamped,
    outColor: stable[parity].color.view,
    outCoc: stable[parity].coc.view,
  })
}

/** The dilations' groups and the tiles the gathers read. Each pass reads the one before: the first
 *  the flattened tiles; the minimum-maximum chain and the other take turns between two images. */
function dilateGroups(io: GroupSources) {
  const { programs, plan, images, dilations } = io
  const { flat, minMax, dilated } = images
  const spreads = plan.dilations.filter((d) => d.mode === 'minMax').length
  const count = plan.dilations.length - spreads
  const heldMinMax = spreads ? minMax[(spreads - 1) % 2] : flat
  const counts = { minMax: 0, minAbs: 0, standalone: 0 }
  const groups = plan.dilations.map((dilation, at) => {
    const rank = counts[dilation.mode]++
    const chain = dilation.mode === 'minMax' ? minMax : dilated
    const input = rank === 0 ? flat : chain[(rank - 1) % 2]
    const output = chain[rank % 2]
    return groupOf(
      io,
      programs.layouts.dilate,
      DILATE_BINDINGS,
      {
        fg: input.fg.view,
        bg: input.bg.view,
        minMaxFg: heldMinMax.fg.view,
        minMaxBg: heldMinMax.bg.view,
        outFg: output.fg.view,
        outBg: output.bg.view,
      },
      [{ binding: DOF_STEP_BINDING, resource: wholeBuffer(dilations[at]) }],
    )
  })
  return { groups, tiles: dilated[(count - 1) % 2] }
}

/** The reductions' groups: the first from the setup, each next one from the last level the one before
 *  wrote; each writes two levels, the second a dummy where the chain ends. */
function reduceGroups(io: GroupSources) {
  const { programs, plan, images, buffers, reductions } = io
  const { reducedColor, reducedCoc, dummyColors, dummyCoc } = images
  const setup = setupOf(io)
  return reducePasses(plan.mips).map(({ from, to, count }, at) => {
    const source = at === 0
    return groupOf(
      io,
      programs.layouts.reduce,
      REDUCE_BINDINGS,
      {
        color: source ? setup.color : reducedColor.levels[from],
        coc: source ? setup.coc : reducedCoc.levels[from],
        quarter: source && scattersOver(plan) ? images.quarterColor.view : dummyColors[0].view,
        outColorA: reducedColor.levels[to],
        outCocA: reducedCoc.levels[to],
        outColorB: count > 1 ? reducedColor.levels[to + 1] : dummyColors[1].view,
        outCocB: count > 1 ? reducedCoc.levels[to + 1] : dummyCoc.view,
        arguments: wholeBuffer(buffers.drawArguments),
        foregroundList: wholeBuffer(buffers.foreground),
        backgroundList: wholeBuffer(buffers.background),
      },
      [{ binding: DOF_STEP_BINDING, resource: wholeBuffer(reductions[at]) }],
    )
  })
}

/** What a layer's gather reads for its table: the shape's table where it takes the diaphragm's shape. */
function tableOf(io: GroupSources, conv: Convolution) {
  const { luts, images } = io
  if (!conv.bokeh || !luts) return images.dummyColors[0]
  return conv.layer === 'slight' ? luts.scatter : luts.gather
}

/** The gather's group of a convolution, and its post-filter's. */
function layerGroups(io: GroupSources, conv: Convolution, tiles: TilePair) {
  const { programs, images, plan } = io
  const layer = images.layers[conv.layer]!
  const occluded = conv.quality >= 2
  const gather = groupOf(io, programs.layouts.gather, GATHER_BINDINGS, {
    color: images.reducedColor.view,
    coc: images.reducedCoc.view,
    tileFg: tiles.fg.view,
    tileBg: tiles.bg.view,
    lut: tableOf(io, conv).view,
    point: programs.samplers.point,
    linear: programs.samplers.clamped,
    wrapped: programs.samplers.wrapped,
    outColor: layer.color.view,
    outAlpha: layer.alpha.view,
    outOcclusion: (occluded ? images.occlusion : images.dummyCoc).view,
  })
  const filtered = layer.filtered
  const postfilter =
    filtered &&
    groupOf(io, programs.layouts.postfilter, POSTFILTER_BINDINGS, {
      color: layer.color.view,
      alpha: layer.alpha.view,
      tileFg: tiles.fg.view,
      tileBg: tiles.bg.view,
      outColor: filtered.color.view,
      outAlpha: filtered.alpha.view,
    })
  const list = conv.layer === 'foreground' ? io.buffers.foreground : io.buffers.background
  const sprites =
    conv.scatter &&
    groupOf(io, programs.layouts.sprites, SPRITE_BINDINGS, {
      list: wholeBuffer(list),
      lut: (plan.scatterLut && io.luts ? io.luts.scatter : images.dummyColors[0]).view,
      occlusion: (occluded ? images.occlusion : images.dummyCoc).view,
      sampler: programs.samplers.wrapped,
    })
  return { gather, postfilter, sprites }
}

/** The recombine's group: the image and its depth, each layer as it is after its last pass, a dummy for
 *  one that was not gathered. */
function recombineGroup(io: GroupSources) {
  const { programs, plan, images, luts } = io
  const color = (layer: 'foreground' | 'hole' | 'slight' | 'background') => {
    const held = images.layers[layer]
    return (held?.filtered?.color ?? held?.color ?? images.dummyColors[0]).view
  }
  const alpha = (layer: 'foreground' | 'hole' | 'background') => {
    const held = images.layers[layer]
    return (held?.filtered?.alpha ?? held?.alpha ?? images.dummyCoc).view
  }
  return groupOf(io, programs.layouts.recombine, RECOMBINE_BINDINGS, {
    scene: io.input,
    depth: io.depth,
    fgColor: color('foreground'),
    fgAlpha: alpha('foreground'),
    holeColor: color('hole'),
    holeAlpha: alpha('hole'),
    slightColor: color('slight'),
    bgColor: color('background'),
    bgAlpha: alpha('background'),
    lut: (plan.recombineLut && luts ? luts.recombine : images.dummyColors[0]).view,
    linear: programs.samplers.clamped,
    point: programs.samplers.point,
    out: io.output,
  })
}

/** The groups of the plan over `io`'s resources, made again whenever a resource they name moves. */
export function makeGroups(io: GroupSources): DofGroups {
  const { programs, plan, images, luts } = io
  const dilation = dilateGroups(io)
  const gathered = plan.convolutions.map((conv) => layerGroups(io, conv, dilation.tiles))
  const setup = setupOf(io)
  const lut = (image: Image | undefined) =>
    image && groupOf(io, programs.layouts.lut, LUT_BINDINGS, { lut: image.view })
  return {
    setup: groupOf(io, programs.layouts.setup, SETUP_BINDINGS, {
      scene: io.input,
      depth: io.depth,
      color: (plan.divisor === 2 ? images.setup.color : images.dummyColors[0]).view,
      coc: images.setup.coc.view,
    }),
    temporal: temporalGroup(io),
    flatten: groupOf(io, programs.layouts.flatten, FLATTEN_BINDINGS, {
      coc: setup.coc,
      fg: images.flat.fg.view,
      bg: images.flat.bg.view,
    }),
    dilates: dilation.groups,
    downsample: scattersOver(plan)
      ? groupOf(io, programs.layouts.downsample, DOWNSAMPLE_BINDINGS, {
          color: setup.color,
          coc: setup.coc,
          outColor: images.quarterColor.view,
          outCoc: images.quarterCoc.view,
        })
      : undefined,
    reduces: reduceGroups(io),
    pack: scattersOver(plan)
      ? groupOf(io, programs.layouts.pack, PACK_BINDINGS, {
          arguments: wholeBuffer(io.buffers.drawArguments),
          foregroundList: wholeBuffer(io.buffers.foreground),
          backgroundList: wholeBuffer(io.buffers.background),
        })
      : undefined,
    luts: {
      gather: plan.gatherLut ? lut(luts?.gather) : undefined,
      scatter: plan.scatterLut ? lut(luts?.scatter) : undefined,
      recombine: plan.recombineLut ? lut(luts?.recombine) : undefined,
    },
    gathers: gathered.map((g) => g.gather),
    postfilters: gathered.map((g) => g.postfilter),
    sprites: gathered.map((g) => g.sprites || undefined),
    recombine: recombineGroup(io),
  }
}
