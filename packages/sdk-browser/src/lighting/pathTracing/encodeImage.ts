import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import type { SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'
import { PT_ACCUMULATE_BINDINGS } from './accumulateProgram.ts'
import {
  compactionDepthOf,
  writeBlock,
  type PathTracingBlockImage,
  type PathTracingBlocks,
  type PathTracingTile,
} from './blocks.ts'
import type { PathTracingFrame, PathTracingSettings } from './framePlan.ts'
import type { PathTracingGpu } from './gpuState.ts'
import type { PathTracingLights } from './lightRecords.ts'
import type { PathTracingPipelines } from './pipelines.ts'
import { encodeLightGrid, encodeSkyTable } from './tables.ts'
import type { PathTracingCounters } from './restart.ts'
import type { PathTracingGroups, createPathTracingGroups } from './encodeGroups.ts'
import type { hitShadePipelinesOf } from './shadeHitPipelines.ts'
import { queueListBase } from './queueWgsl.ts'
import { PT_STEPS, PT_VIEW, PT_VIEW_STRIDE } from './viewWgsl.ts'

/** Everything an image of the path tracer is encoded from. */
export interface PathTracingImageContext {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly pipelines: PathTracingPipelines
  readonly gpu: PathTracingGpu
  readonly settings: PathTracingSettings
  readonly frame: PathTracingFrame
  readonly counters: PathTracingCounters
  readonly baseExposure: number
  readonly blocks: PathTracingBlocks
  readonly tiles: readonly PathTracingTile[]
  /** The last bounce (`pathTracingMaxBounces`): every bounce is traced, shaded and finished in dispatches of its own. */
  readonly depth: number
  /** The lights of a restart, none while the run goes on, and how many the run has. */
  readonly lights: PathTracingLights | undefined
  readonly lightCount: number
  /** The sky light's cube, none without a sky light; the table is made again at a restart, or at every image with the caching off. */
  readonly sky: SkyLightReadSet | undefined
  readonly rays: SceneRays
  /** The bind groups of the bounces, and what the hits' shade is made of: its pipelines, the entries of the resolve's group it keeps and the class keys the scene's hits are shaded as. */
  readonly groups: ReturnType<typeof createPathTracingGroups>
  readonly resolve: GPUBindGroupEntry[]
  readonly shade: ReturnType<typeof hitShadePipelinesOf>
  readonly classes: ReadonlySet<number>
  /** The rounds a bounce takes after its own (`HitPlacements.passRounds`). */
  readonly passRounds: number
  readonly viewInverse: Float64Array
  readonly viewProjection: Float64Array
  readonly eye: readonly [number, number, number]
  readonly size: readonly [number, number]
  /** The image of the ping-pong that holds the latest accumulation, none at a restart. */
  readonly latest: 0 | 1 | undefined
}

/** The blocks of an image's dispatches: round `r` of bounce `b` of tile `t` is block `(t * (depth + 2) + b) * PT_STEPS + r`. */
export const blockOf = (tile: number, depth: number, bounce: number, round = 0) =>
  (tile * (depth + 2) + bounce) * PT_STEPS + round

/** The parameters every block of the image shares (`PathTracingBlockImage`). */
function blockImage(context: PathTracingImageContext): PathTracingBlockImage {
  const { settings, counters, gpu, size, eye, viewInverse, baseExposure } = context
  return {
    inverseViewProjection: viewInverse,
    viewProjection: context.viewProjection,
    eye,
    baseExposure,
    size,
    maxSamples: Math.max(settings.pathTracingSamplesPerPixel, 1),
    iteration: counters.iteration,
    temporalSeed: settings.pathTracingFrameIndependentTemporalSeed
      ? counters.frameIndex
      : counters.iteration,
    maxBounces: settings.pathTracingMaxBounces,
    misMode: settings.pathTracingMISMode,
    samplerType: settings.pathTracingSamplerType,
    maxPathIntensity: settings.pathTracingMaxPathIntensity,
    approximateCaustics: settings.pathTracingApproximateCaustics,
    backgroundAlpha: settings.pathTracingBackgroundAlpha,
    emissive: settings.pathTracingEnableEmissive,
    visibleLights: settings.pathTracingVisibleLights,
    adaptive: context.frame.adaptive,
    lights: context.lightCount,
    pathCapacity: gpu.tile * gpu.tile,
    bounceLevels: gpu.bounceLevels,
    compactionDepth: compactionDepthOf(
      settings.pathTracingCompactionDepth,
      settings.pathTracingMaxBounces,
    ),
    errorThreshold: settings.pathTracingAdaptiveSamplingErrorThreshold,
    filterWidth: settings.pathTracingFilterWidth,
    passRounds: context.passRounds,
  }
}

/** The group of the accumulation programs: the paths, the images before (read) and this image's (written). */
function accumulateGroup(context: PathTracingImageContext, read: number, write: number) {
  const { device, gpu, pipelines } = context
  const B = PT_ACCUMULATE_BINDINGS
  const before = gpu.images[read]!
  const after = gpu.images[write]!
  return device.createBindGroup({
    layout: pipelines.accumulateLayout,
    entries: [
      { binding: B.view, resource: { buffer: gpu.blocks, size: PT_VIEW.words * 4 } },
      { binding: B.states, resource: { buffer: gpu.states } },
      { binding: B.queue, resource: { buffer: gpu.queue } },
      { binding: B.radianceIn, resource: before.radiance.createView() },
      { binding: B.albedoIn, resource: before.albedo.createView() },
      { binding: B.normalIn, resource: before.normal.createView() },
      { binding: B.radianceOut, resource: after.radiance.createView() },
      { binding: B.albedoOut, resource: after.albedo.createView() },
      { binding: B.normalOut, resource: after.normal.createView() },
      { binding: B.varianceIn, resource: before.variance.createView() },
      {
        binding: B.varianceOut,
        resource: after.variance.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
      },
      { binding: B.varianceDims, resource: { buffer: gpu.varianceDims } },
      { binding: B.depthIn, resource: before.depth.createView() },
      { binding: B.depthOut, resource: after.depth.createView() },
    ],
  })
}

/** The paths of a tile traced, bounce by bounce: the trace of the bounce's rays, the shade of what they hit (a dispatch for each class of surfaces), and the rest of the bounce, each over the list of the paths the one
 *  before kept (`ptArgs` sets the arguments of its indirect dispatch); then the accumulation of the pixels the sample traced. */
function encodeTile(
  context: PathTracingImageContext,
  tile: number,
  groups: PathTracingGroups,
  accumulate: GPUBindGroup,
) {
  const { encoder, pipelines, gpu, settings, frame, counters, depth } = context
  const rect = context.tiles[tile]!
  const offset = (bounce: number, round = 0) => blockOf(tile, depth, bounce, round) * PT_VIEW_STRIDE
  encoder.clearBuffer(gpu.queue, 0, queueListBase(gpu.bounceLevels) * 4)
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer sample' })
  const indirect = settings.pathTracingIndirectDispatch
  // Sets the arguments of a round's dispatches and empties the list the round sends paths back to; it runs whether or not the dispatches are indirect.
  const arguments_ = (bounce: number, round = 0) => {
    pass.setPipeline(pipelines.args.get()!)
    pass.setBindGroup(0, groups.argsView, [offset(bounce, round)])
    pass.setBindGroup(1, groups.argsOut)
    pass.dispatchWorkgroups(1)
  }
  // The paths of a bounce: over the count the bounce before wrote (indirect), or over every path of the tile, the threads past the count ending at once (`ptFlat` lays the groups the same way).
  const dispatchPaths = (bounce: number, round = 0) => {
    if (indirect) pass.dispatchWorkgroupsIndirect(gpu.args, (bounce * PT_STEPS + round) * 12)
    else {
      const all = ceilDiv(gpu.tile * gpu.tile, 64)
      pass.dispatchWorkgroups(Math.min(all, 65535), Math.max(ceilDiv(all, 65535), 1))
    }
  }
  const trace = (name: keyof PathTracingPipelines['trace'], bounce: number, round = 0) => {
    pass.setPipeline(pipelines.trace[name].get()!)
    pass.setBindGroup(0, groups.trace0, [offset(bounce, round)])
    pass.setBindGroup(1, groups.trace1)
  }
  // The hits of each class of surfaces are given their material, then the rest of the round.
  const shadeAndFinish = (bounce: number, round: number) => {
    for (const key of context.classes) {
      const shade = context.shade.of(key).get()
      if (!shade) continue
      pass.setPipeline(shade)
      pass.setBindGroup(0, groups.shade0)
      pass.setBindGroup(1, groups.shade1, [offset(bounce, round)])
      dispatchPaths(bounce, round)
    }
    pass.setPipeline(pipelines.finish.get()!)
    pass.setBindGroup(0, groups.finish0, [offset(bounce, round)])
    pass.setBindGroup(1, groups.finish1)
    dispatchPaths(bounce, round)
  }
  const adaptive = frame.adaptive && counters.iteration > 0
  for (let bounce = 0; bounce <= depth; bounce++) {
    if (bounce === 0 && !adaptive) {
      // The camera's bounce over the tile puts every path in the list the rest of the bounce reads.
      trace('cameraGrid', 0)
      pass.dispatchWorkgroups(ceilDiv(rect[2], 8), ceilDiv(rect[3], 8))
      arguments_(0)
    } else {
      if (bounce === 0) {
        pass.setPipeline(pipelines.accumulate.adaptiveStart.get()!)
        pass.setBindGroup(0, accumulate, [offset(0)])
        pass.dispatchWorkgroups(ceilDiv(rect[2], 8), ceilDiv(rect[3], 8))
      }
      arguments_(bounce)
      trace(bounce === 0 ? 'cameraList' : 'inner', bounce)
      dispatchPaths(bounce)
    }
    shadeAndFinish(bounce, 0)
    // The rays that went through a surface that did not cover them are traced again in the same bounce, each round over the paths the round before sent back.
    for (let round = 1; round <= context.passRounds; round++) {
      arguments_(bounce, round)
      trace('inner', bounce, round)
      dispatchPaths(bounce, round)
      shadeAndFinish(bounce, round)
    }
  }
  if (frame.adaptive) {
    pass.setPipeline(pipelines.accumulate.variance.get()!)
    pass.setBindGroup(0, accumulate, [offset(0)])
    pass.dispatchWorkgroups(ceilDiv(rect[2], 8), ceilDiv(rect[3], 8))
  }
  pass.setPipeline(pipelines.accumulate.resolve.get()!)
  pass.setBindGroup(0, accumulate, [offset(0)])
  pass.dispatchWorkgroups(ceilDiv(rect[2], 8), ceilDiv(rect[3], 8))
  pass.end()
}

/** The images of the sample before copied into this sample's, so that the pixels adaptive sampling did not trace keep what they had. */
function copyUntraced(context: PathTracingImageContext, read: number, write: number) {
  const { encoder, gpu, size } = context
  const before = gpu.images[read]!
  const after = gpu.images[write]!
  for (const name of ['radiance', 'albedo', 'normal', 'variance', 'depth'] as const)
    encoder.copyTextureToTexture({ texture: before[name] }, { texture: after[name] }, size)
}

/**
 * The compute work of an image of the path tracer, in the order the plan gives (`planPathTracingFrame`): at a restart the lights' buffer, the light grid and the sky's table; the
 * parameters of every dispatch written at once; then for each tile of the view the queue cleared, the sample traced bounce by bounce and accumulated; the error chain's mips when
 * adaptive sampling is on. Returns the image of the ping-pong this sample wrote, none when no sample was traced (the accumulation has stopped).
 */
export function encodePathTracingImage(context: PathTracingImageContext): 0 | 1 | undefined {
  const { device, encoder, pipelines, gpu, frame, settings, counters, tiles, depth, latest } =
    context
  if (context.lights) {
    encodeLightGrid(
      device,
      encoder,
      pipelines,
      gpu,
      context.lights,
      Math.min(settings.pathTracingLightGridMaxCount, gpu.gridCapacity),
      settings.pathTracingLightGridAxis,
    )
  }
  if (context.sky && (context.lights || !settings.pathTracingSkylightCaching))
    encodeSkyTable(
      device,
      encoder,
      pipelines,
      gpu,
      context.sky,
      settings.pathTracingMISCompensation && settings.pathTracingMISMode === 2,
    )
  if (!frame.needsMoreRays) return undefined
  // At a restart nothing is read (the first sample blends with nothing), but the image read must not be the one written: a texture is not sampled and stored to in one dispatch.
  const read = latest ?? 1
  const write: 0 | 1 = latest === undefined ? 0 : latest === 0 ? 1 : 0
  const image = blockImage(context)
  const blocks: PathTracingBlocks = context.blocks
  tiles.forEach((tile, at) => {
    for (let bounce = 0; bounce < depth + 2; bounce++)
      for (let round = 0; round <= context.passRounds; round++)
        writeBlock(blocks, blockOf(at, depth, bounce, round), image, tile, bounce, round)
  })
  device.queue.writeBuffer(
    gpu.blocks,
    0,
    blocks.floats,
    0,
    (tiles.length * (depth + 2) * PT_STEPS * PT_VIEW_STRIDE) / 4,
  )
  if (frame.adaptive && counters.iteration > 0) copyUntraced(context, read, write)
  const groups = context.groups({
    device,
    gpu,
    pipelines,
    rays: context.rays,
    variance: gpu.images[read]!.varianceTop,
    resolve: context.resolve,
    shade: context.shade,
  })
  const accumulate = accumulateGroup(context, read, write)
  tiles.forEach((_, at) => encodeTile(context, at, groups, accumulate))
  return write
}
