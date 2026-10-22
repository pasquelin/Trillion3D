import { cloudHazeInSecondPass } from './traceOptions.ts'
import { DEPTH_RANGE_VIEW, type DepthRangePass } from './depthRangeWgsl.ts'
import { depthRangeSizes, writeDepthRangeView } from './depthRange.ts'
import type { Size } from './reconstructLayout.ts'
import { cloudHazeDispatch, CLOUD_HAZE_BINDING as H } from './traceHaze.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT, writeCloudTrace } from './traceLayout.ts'
import { cloudTraceDispatch } from './trace.ts'
import { hazeAirGroup, traceAirGroup, traceExtraGroup, type CloudViewFrame } from './viewGroups.ts'
import type { CloudDepthRange, CloudImages } from './viewTargets.ts'

/**
 * THE FIRST HALF OF AN IMAGE OF A VIEW'S CLOUDS, in the order the clouds are drawn: the scene's
 * depth range (`encodeDepthRange`), the tracing into the traced images (`encodeTrace`) and, where
 * the haze is laid per pixel, the haze pass over them (`encodeHaze`). The second half, the
 * reconstruction and the composition, is `viewResolve.ts`.
 */

const rangeWords = new Float32Array(new ArrayBuffer(DEPTH_RANGE_VIEW.words * 4))
const traceWords = new Float32Array(new ArrayBuffer(CLOUD_TRACE_LAYOUT.words * 4))

/** A fullscreen triangle over the first `viewport` pixels of `targets`, `groups` bound in order;
 *  the targets are loaded where `load`, else cleared. */
export function drawFullscreen(
  f: Pick<CloudViewFrame, 'encoder'>,
  label: string,
  pipeline: GPURenderPipeline,
  groups: readonly GPUBindGroup[],
  targets: readonly GPUTextureView[],
  viewport: Size,
  load = false,
) {
  const pass = f.encoder.beginRenderPass({
    label,
    colorAttachments: targets.map((view) => ({
      view,
      loadOp: load ? ('load' as const) : ('clear' as const),
      storeOp: 'store' as const,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    })),
  })
  pass.setPipeline(pipeline)
  groups.forEach((group, at) => pass.setBindGroup(at, group))
  pass.setViewport(0, 0, viewport.width, viewport.height, 0, 1)
  pass.draw(3)
  pass.end()
}

/** The scene's depth range textures of the image, none where the trace reads the depth itself: the
 *  half-size texture from the depth and, with two surfaces, the quarter-size one from that (or the
 *  half-size checkerboard alone). */
export function encodeDepthRange(f: CloudViewFrame): CloudDepthRange | undefined {
  const { setup, gpu, programs } = f
  if (setup.depth === 'scene') return undefined
  const range = gpu.depthRange(f.allocated, f.view, setup.depth === 'range')
  const sizes = depthRangeSizes(f.allocated, f.view)
  const passes: DepthRangePass[] = setup.depth === 'range' ? ['depth', 'range'] : ['checkerboard']
  for (const name of passes) {
    const drawn = programs.depthRange(name)
    const source = name === 'range' ? range.views.half : f.sceneDepth
    const block = gpu.block(`depth ${name}`, DEPTH_RANGE_VIEW.words)
    writeDepthRangeView(rangeWords, name, f.allocated, f.view)
    f.device.queue.writeBuffer(block, 0, rangeWords)
    const group = gpu.group(`depth ${name}`, drawn.layout, [block, source], () => [
      { binding: 0, resource: { buffer: block } },
      { binding: 1, resource: source },
    ])
    const to = name === 'range' ? range.views.quarter! : range.views.half
    const size = name === 'range' ? sizes.quarter.view : sizes.half.view
    drawFullscreen(f, 'Trillion3D cloud depth range', drawn.pipeline.get(), [group], [to], size)
  }
  return range
}

/** The view's tracing of the image into the traced images (`CloudViewGpu.traced`), or, where the
 *  haze is laid in a second pass, the colour it writes before it (`raw`). */
export function encodeTrace(f: CloudViewFrame, range: CloudDepthRange | undefined) {
  const { gpu, plan, setup, programs, device } = f
  const pass = programs.trace(f.key)
  const texture = plan.sizes.traced.texture
  const traced = gpu.traced(texture, setup.minMaxDepth)
  const hazed = cloudHazeInSecondPass(f.part.quality, f.image.airPresent)
  const raw = hazed ? gpu.raw(texture, setup.minMaxDepth) : undefined
  const out = raw ?? traced
  const block = gpu.block('trace', CLOUD_TRACE_LAYOUT.words)
  writeCloudTrace(traceWords, f.image, plan, f.part)
  device.queue.writeBuffer(block, 0, traceWords)
  const depthRange =
    setup.depth === 'scene'
      ? f.sceneDepth
      : setup.depth === 'range'
        ? range!.views.quarter!
        : range!.views.half
  const names = [f.material, block, f.noise, depthRange, out.views.colour, out.views.secondary]
  const cloud = gpu.group('trace cloud', pass.cloud, [...names, traced.views.depth], () => [
    ...f.material,
    { binding: B.block, resource: { buffer: block } },
    { binding: B.blueNoise, resource: f.noise },
    { binding: B.depthRange, resource: depthRange },
    { binding: B.colour, resource: out.views.colour },
    ...(setup.minMaxDepth ? [{ binding: B.secondary, resource: out.views.secondary! }] : []),
    { binding: B.depth, resource: traced.views.depth },
  ])
  const compute = f.encoder.beginComputePass({ label: 'Trillion3D cloud trace' })
  compute.setPipeline(pass.pipeline.get())
  compute.setBindGroup(0, traceAirGroup(f, pass.air))
  compute.setBindGroup(1, cloud)
  if (pass.extra) compute.setBindGroup(2, traceExtraGroup(f, pass.extra))
  const { x, y, z } = cloudTraceDispatch(plan.sizes.traced)
  compute.dispatchWorkgroups(x, y, z)
  compute.end()
  return { traced, raw }
}

/** The haze pass over the unhazed colour of each surface the trace made (the second with the same
 *  depth), into the traced images. */
export function encodeHaze(f: CloudViewFrame, traced: CloudImages, raw: CloudImages) {
  const { gpu, programs } = f
  const pass = programs.haze
  const block = gpu.block('trace', CLOUD_TRACE_LAYOUT.words)
  const compute = f.encoder.beginComputePass({ label: 'Trillion3D cloud haze' })
  compute.setPipeline(pass.pipeline.get())
  compute.setBindGroup(0, hazeAirGroup(f, pass.air))
  const { x, y, z } = cloudHazeDispatch(f.plan.sizes.traced)
  for (const surface of ['colour', 'secondary'] as const) {
    const from = raw.views[surface],
      to = traced.views[surface]
    if (!from || !to) continue
    const group = gpu.group(
      `haze ${surface}`,
      pass.cloud,
      [block, from, traced.views.depth, to],
      () => [
        { binding: H.block, resource: { buffer: block } },
        { binding: H.colour, resource: from },
        { binding: H.depth, resource: traced.views.depth },
        { binding: H.out, resource: to },
      ],
    )
    compute.setBindGroup(1, group)
    compute.dispatchWorkgroups(x, y, z)
  }
  compute.end()
}
