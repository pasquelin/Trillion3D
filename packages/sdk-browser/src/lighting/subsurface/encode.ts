import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { SUBSURFACE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { subsurfaceGroups } from './groups.ts'
import { SSS_ARGS, SSS_TILE, SSS_TILE_TYPE as T } from './layout.ts'
import type { SubsurfaceImage } from './params.ts'
import type { ShapePipelines as Pipelines } from './pipelines.ts'
import type { SubsurfaceView } from './view.ts'

const PASS: GPUComputePassDescriptor = { label: SUBSURFACE_PASS }
/** The tile draws' descriptor, held: the target they draw into is rewritten in place. */
const drawTarget = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
const DRAW: GPURenderPassDescriptor = { label: SUBSURFACE_PASS, colorAttachments: [drawTarget] }

/** The compute passes: classification, clears, setup, mips, the scatterings and the variance update. */
export function encodeKernels(
  encoder: GPUCommandEncoder,
  view: SubsurfaceView,
  g: ReturnType<typeof subsurfaceGroups>,
  p: Pipelines,
  shape: { forceSeparable: boolean; half: boolean },
  history: number,
  image: SubsurfaceImage,
) {
  const pass = encoder.beginComputePass(PASS)
  const common = g.common
  const run = (
    stage: { get(): GPUComputePipeline | undefined },
    textures: GPUBindGroup,
    args?: { slot: number } | { x: number; y: number },
  ) => {
    const pipeline = stage.get()
    // Not compiled: the step is skipped, the frame is held for it (`pipelinesCompiling`).
    if (!pipeline) return
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, common)
    pass.setBindGroup(1, textures)
    pass.setBindGroup(2, g.tiles)
    if (args && 'slot' in args)
      pass.dispatchWorkgroupsIndirect(view.buffers.dispatch, args.slot * 12)
    else if (args) pass.dispatchWorkgroups(args.x, args.y)
  }
  const build = (stage: { get(): GPUComputePipeline | undefined }) => {
    const pipeline = stage.get()
    if (!pipeline) return
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, common)
    pass.setBindGroup(1, g.none)
    pass.setBindGroup(2, g.tiles)
    pass.setBindGroup(3, g.arguments)
    pass.dispatchWorkgroups(1)
  }
  const [tilesX, tilesY] = image.tiles
  run(p.mark, g.clearSetup, { x: tilesX, y: tilesY })
  run(p.lists, g.clearSetup, { x: ceilDiv(tilesX, SSS_TILE), y: ceilDiv(tilesY, SSS_TILE) })
  build(p.argsTiles)
  run(p.clear, g.clearSetup, { x: tilesX, y: tilesY })
  if (shape.half) run(p.clear, g.clearPassTwo, { slot: SSS_ARGS.clearPassTwo })
  run(p.setupMain, g.setupMain, { slot: T.nonPassthrough })
  run(p.setupPass, g.setupPass, { slot: T.passthrough })
  if (!shape.forceSeparable) {
    build(p.argsScatter)
    g.mips.forEach((mip, at) => run(p.mip, mip, { slot: SSS_ARGS.mip + at }))
  }
  run(p.clear, g.clearPassOne, { slot: SSS_ARGS.clearPassOne })
  const separable = shape.forceSeparable ? T.nonPassthrough : T.separable
  if (!shape.forceSeparable) run(p.sampled, g.sampled[history], { slot: T.sampled })
  run(p.horizontal, g.horizontal, { slot: separable })
  run(p.vertical, g.vertical, { slot: separable })
  if (!shape.forceSeparable) run(p.variance, g.variance[history], { slot: T.sampled })
  pass.end()
}

/** The recombine into the view's own image, then the copy back onto the lit image: tile quads drawn indirect over the `all` list. */
export function drawRecombine(
  encoder: GPUCommandEncoder,
  view: SubsurfaceView,
  g: ReturnType<typeof subsurfaceGroups>,
  p: Pipelines,
  lit: GPUTextureView,
) {
  const draw = (
    target: GPUTextureView,
    stage: { get(): GPURenderPipeline | undefined },
    textures: GPUBindGroup,
  ) => {
    const pipeline = stage.get()
    if (!pipeline) return
    drawTarget.view = target
    const pass = encoder.beginRenderPass(DRAW)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, g.common)
    pass.setBindGroup(1, textures)
    pass.setBindGroup(2, g.rasterLists)
    pass.drawIndirect(view.buffers.draw, T.all * 16)
    pass.end()
  }
  draw(view.textures.recombined, p.recombineTile, g.recombine)
  draw(lit, p.copyTile, g.copy)
}
