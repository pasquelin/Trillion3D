import { heldColour } from '../../../gpu/core/heldAttachment.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { drawFullscreenTriangle } from '../../../gpu/shader/fullscreenTriangle.ts'
import { cloudHazeInSecondPass } from './traceOptions.ts'
import { DEPTH_RANGE_VIEW, type DepthRangePass } from './depthRangeWgsl.ts'
import { depthRangeSizes, writeDepthRangeView } from './depthRange.ts'
import { CLOUD_HAZE_BINDING as H } from './traceHazeProgram.ts'
import { CLOUD_TRACE_LAYOUT, cloudTraceEntries, writeCloudTrace } from './traceLayout.ts'
import { cloudTraceDispatch } from './trace.ts'
import { CLOUD_EMPTY_SPACE_DISPATCH } from './emptySpace.ts'
import { CLOUD_EMPTY_SPACE_BINDING as E } from './emptySpaceWgsl.ts'
import { hazeAirGroup, traceAirGroup, traceExtraGroup, type CloudViewFrame } from './viewGroups.ts'
import type { CloudDepthRange, CloudImages } from './viewTargets.ts'

/**
 * THE FIRST HALF OF AN IMAGE OF A VIEW'S CLOUDS, in the order the clouds are drawn: the scene's
 * depth range (`encodeDepthRange`), the tracing into the traced images (`encodeTrace`), preceded
 * by the empty-space table's pass where the setting asks (`encodeEmptySpace`), and, where the haze
 * is laid per pixel, the haze pass over them (`encodeHaze`). The second half, the reconstruction
 * and the composition, is `viewResolve.ts`.
 */

const rangeWords = new Float32Array(new ArrayBuffer(DEPTH_RANGE_VIEW.words * 4))
const traceWords = new Float32Array(new ArrayBuffer(CLOUD_TRACE_LAYOUT.words * 4))

/** The descriptor of each cloud pass by label, held: its attachments are rewritten in place. */
const cloudPasses = new Map<
  string,
  GPURenderPassDescriptor & { colorAttachments: GPURenderPassColorAttachment[] }
>()

/** The pass over `targets`, loaded where `load`, else cleared: the one descriptor of its `label`,
 *  rewritten at each call — a pass reads it when it begins. */
export function cloudPass(
  label: string,
  targets: readonly GPUTextureView[],
  load = false,
): GPURenderPassDescriptor {
  let held = cloudPasses.get(label)
  if (!held) cloudPasses.set(label, (held = { label, colorAttachments: [] }))
  const attachments = held.colorAttachments
  attachments.length = targets.length
  for (let at = 0; at < targets.length; at++) {
    const attachment = (attachments[at] ??= heldColour({
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }))
    attachment.view = targets[at]
    attachment.loadOp = load ? 'load' : 'clear'
  }
  return held
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
    drawFullscreenTriangle(
      f.encoder,
      cloudPass('Trillion3D cloud depth range', [to]),
      drawn.pipeline.get(),
      group,
      size.width,
      size.height,
    )
  }
  return range
}

const EMPTY_SPACE_PASS: GPUComputePassDescriptor = { label: 'Trillion3D cloud empty space' }
const TRACE_PASS: GPUComputePassDescriptor = { label: 'Trillion3D cloud trace' }
const HAZE_PASS: GPUComputePassDescriptor = { label: 'Trillion3D cloud haze' }
/** The image's compute passes, the empty space, the trace and the haze, which follow one another:
 *  one pass but on a frame timed per pass. Begun and ended by `encodeCloudView`. */
export const cloudSteps = new ComputeRun()

/** The empty-space table written from the trace's block `block`, which the tracing of the same image
 *  reads next. */
function encodeEmptySpace(f: CloudViewFrame, block: GPUBuffer) {
  const pass = f.programs.emptySpace(f.part.quality.cloudEmptySpaceSkippingCorners)
  const pipeline = pass.pipeline.get()
  if (!pipeline) return
  const table = f.gpu.emptySpaceTable.view
  const cloud = f.gpu.group('empty space cloud', pass.cloud, [f.material, block, table], () => [
    ...f.material,
    { binding: E.block, resource: { buffer: block } },
    { binding: E.table, resource: table },
  ])
  const compute = cloudSteps.pass(EMPTY_SPACE_PASS)
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, traceAirGroup(f, pass.air, 'empty space air'))
  compute.setBindGroup(1, cloud)
  const { x, y, z } = CLOUD_EMPTY_SPACE_DISPATCH
  compute.dispatchWorkgroups(x, y, z)
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
  if (f.key.emptySpace) encodeEmptySpace(f, block)
  const depthRange =
    setup.depth === 'scene'
      ? f.sceneDepth
      : setup.depth === 'range'
        ? range!.views.quarter!
        : range!.views.half
  const names = [f.material, block, f.noise, depthRange, out.views.colour, out.views.secondary]
  const closest = f.key.closestDepth ? raw?.views.depth : undefined
  const holdout = f.key.holdout ? gpu.holdout(texture).views.colour : undefined
  const cloud = gpu.group(
    'trace cloud',
    pass.cloud,
    [...names, traced.views.depth, closest, holdout],
    () =>
      cloudTraceEntries(f.material, {
        block: { buffer: block },
        blueNoise: f.noise,
        depthRange,
        colour: out.views.colour,
        secondary: setup.minMaxDepth ? out.views.secondary : undefined,
        depth: traced.views.depth,
        closest,
        holdout,
      }),
  )
  const compute = cloudSteps.pass(TRACE_PASS)
  const pipeline = pass.pipeline.get()
  if (!pipeline) return { traced, raw }
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, traceAirGroup(f, pass.air))
  compute.setBindGroup(1, cloud)
  if (pass.extra) compute.setBindGroup(2, traceExtraGroup(f, pass.extra))
  const { x, y, z } = cloudTraceDispatch(plan.sizes.traced)
  compute.dispatchWorkgroups(x, y, z)
  return { traced, raw }
}

/** The haze pass over the unhazed colour of each surface the trace made, each at its own depth —
 *  the colour at the traced depth, the second surface at the closest surface's, which the trace
 *  wrote beside the unhazed images —, into the traced images. */
export function encodeHaze(f: CloudViewFrame, traced: CloudImages, raw: CloudImages) {
  const { gpu, programs } = f
  const pass = programs.haze
  const block = gpu.block('trace', CLOUD_TRACE_LAYOUT.words)
  const compute = cloudSteps.pass(HAZE_PASS)
  const pipeline = pass.pipeline.get()
  if (!pipeline) return
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, hazeAirGroup(f, pass.air))
  const { x, y, z } = cloudTraceDispatch(f.plan.sizes.traced)
  for (const surface of ['colour', 'secondary'] as const) {
    const from = raw.views[surface],
      to = traced.views[surface]
    const depth = surface === 'secondary' ? raw.views.depth : traced.views.depth
    if (!from || !to || !depth) continue
    const group = gpu.group(`haze ${surface}`, pass.cloud, [block, from, depth, to], () => [
      { binding: H.block, resource: { buffer: block } },
      { binding: H.colour, resource: from },
      { binding: H.depth, resource: depth },
      { binding: H.out, resource: to },
    ])
    compute.setBindGroup(1, group)
    compute.dispatchWorkgroups(x, y, z)
  }
}
