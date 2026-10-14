/**
 * Host side of the translucent casters' transmission (`transmissionShared.ts`): made with the first
 * blended caster, then encoded each frame after the opaque VSM raster and before the projection,
 * in one compute pass, `TRANSMISSION_LABEL`:
 *
 *   the clear (a redrawn slice stamped, a redrawn or freed slice's blocks given back)
 *   → the bin (candidates, then per chunk of blended rows the opaque raster's cull, each command's
 *   redrawn pages, each command's triangles projected once and recorded in its pages)
 *   → the resolve (the slices numbered, the records placed, each slice's cells built in its group
 *   and written with its records into blocks, the page headers of the slices that changed).
 *
 * The blended candidates take the same static / dynamic rule as every caster (engine mobility),
 * into the same slice of the page as the depth would: a slice is rebuilt exactly when the VSM
 * redraws that slice, and a still scene rebuilds none. Every dispatch past the clear is indirect
 * on what the GPU counted: a still frame dispatches no group of them.
 *
 * A row is decoded and projected once per command (one level of one map), not once per page it
 * reaches, and no global atomic is issued per cell: a sea strip's command reaches ~80–120 pages
 * of which it touches ~10, so the old group per (row, page) decoded every triangle ~10 times for
 * nothing, and each covered cell took a node by an atomic on one counter, ~1 M a frame on a
 * moving sea.
 *
 * Capacities (`VsmTransmissionCaps`) start from the pool's pages: 64 records a page (a sea page
 * holds ~10–40 triangles, a page covered with 10-pixel triangles ~52), one block a page (a sea
 * page's slice takes one), and a page-sized textured pane's patch (130² words, a power of two up).
 * A frame that wanted more says so through the feedback a few frames late; the owner grows once to
 * the power of two that holds it.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { vsmBufferGroup } from './passKit.ts'
import {
  vsmBindGroupEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmResources,
} from './resources.ts'
import type { VsmBoundLight } from './rowPageBound.ts'
import type { VsmRenderScene } from './renderPass.ts'
import { VSM_TRANSMISSION_CLEAR_SPECS } from './transmissionClearWgsl.ts'
import { VSM_TRANSMISSION_PAGE_GROUP } from './transmissionShared.ts'
import {
  VSM_TRANSMISSION_ARGS_AT,
  VSM_TRANSMISSION_COUNTER_WORDS,
  VSM_TRANSMISSION_UNIFORM_BYTES,
  vsmTransmissionRegions,
} from './transmissionLayout.ts'
import { TRANSMISSION_LABEL, type VsmTransmission } from './transmissionMade.ts'
import { vsmTransmissionContext, type VsmTransmissionContext } from './transmissionContext.ts'
import { binPlan } from './transmissionBinPlan.ts'
import { binLists, encodeBin } from './transmissionBin.ts'

export interface VsmTransmissionFrame {
  device: GPUDevice
  lights: readonly VsmBoundLight[]
  /** Unique per frame, never 0: the clear's stamp. */
  stamp: number
  /** The blended caster rows `[rowFirst, rowEnd)`. */
  rowFirst: number
  rowEnd: number
  /** Rows in use among them: the candidates' bound, which sizes the chunks. */
  used: number
}

/** The transmission's one compute pass: its clear, its bin and its resolve. */
const TRANSMISSION_PASS: GPUComputePassDescriptor = { label: TRANSMISSION_LABEL }

/**
 * Clears, bins and resolves the transmission slices this frame redraws. Between `encodeVsmRender`
 * and `encodeVsmAfterRaster` (it reads `res.current`). Returns the rows a chunk took within the
 * GPU budget's room (`vsmChunkRowsWithin`), none without a bin.
 */
export function encodeVsmTransmission(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  trans: VsmTransmission,
  frame: VsmTransmissionFrame,
  scene: VsmRenderScene,
) {
  const { device } = frame
  const ctx = vsmTransmissionContext(trans, device)
  const { layout, caps } = trans
  const plan = binPlan(ctx, trans, frame, scene)
  const binning = plan?.within.size ? plan : undefined
  const regions = vsmTransmissionRegions(layout.poolPages, caps)
  uniformImage[0] = frame.stamp >>> 0
  uniformImage[1] = frame.rowFirst
  uniformImage[2] = caps.records
  uniformImage[3] = caps.patchWords
  uniformImage[4] = caps.blocks
  uniformImage[5] = regions.records
  uniformImage[6] = regions.patches
  uniformImage[7] = binning ? binning.cmds : 0
  uniformImage[8] = binning ? binning.pairs : 0
  writeChanged(device, trans.uniform, uniformImage, 0, uniformImage.length)

  const groups = transmissionGroups(device, ctx, trans)
  // The encoder's clears first: the clear, the bin and the resolve are then one compute pass, each
  // dispatch reading what those before it wrote.
  encoder.clearBuffer(trans.build, 0, VSM_TRANSMISSION_COUNTER_WORDS * 4)
  const bin = binning && binLists(encoder, ctx, trans, res, scene, binning)
  const pass = encoder.beginComputePass(TRANSMISSION_PASS)
  pass.setPipeline(ctx.clear.pipeline)
  pass.setBindGroup(0, vsmPerFrameSet(groups.clear0, res, clearTables, ctx))
  pass.setBindGroup(1, groups.clear1)
  // ⌈poolPages / 256⌉ groups: one row for the largest pool (`poolDispatch.test.ts`).
  pass.dispatchWorkgroups(ceilDiv(layout.poolPages, VSM_TRANSMISSION_PAGE_GROUP))
  if (binning && bin) encodeBin(pass, ctx, scene, binning, bin)
  // Resolve: the slices numbered, a thread a record placed, a group a slice, a thread a dirty
  // slice.
  {
    pass.setPipeline(ctx.number.pipeline)
    pass.setBindGroup(0, groups.number)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(ctx.place.pipeline)
    pass.setBindGroup(0, groups.place)
    pass.dispatchWorkgroupsIndirect(trans.args, VSM_TRANSMISSION_ARGS_AT.place)
    pass.setPipeline(ctx.resolve.pipeline)
    pass.setBindGroup(0, groups.resolve)
    pass.dispatchWorkgroupsIndirect(trans.args, VSM_TRANSMISSION_ARGS_AT.resolve)
    pass.setPipeline(ctx.headers.pipeline)
    pass.setBindGroup(0, groups.resolve)
    pass.dispatchWorkgroupsIndirect(trans.args, VSM_TRANSMISSION_ARGS_AT.headers)
  }
  pass.end()
  return plan?.within
}

// The frame's scratch of `encodeVsmTransmission`, rewritten each frame.
const uniformImage = new Uint32Array(VSM_TRANSMISSION_UNIFORM_BYTES / 4)

/** The groups of the clear, the number, the place and the resolve of `trans`: made once per
 *  transmission. */
function transmissionGroups(
  device: GPUDevice,
  ctx: VsmTransmissionContext,
  trans: VsmTransmission,
) {
  if (ctx.groups?.trans === trans) return ctx.groups
  const { uniform, build, table, pool, links } = trans
  return (ctx.groups = {
    trans,
    clear0: vsmFrameSetHeld(),
    clear1: vsmBufferGroup(device, ctx.clear.groups[1], [uniform, build, table, pool, links]),
    number: vsmBufferGroup(device, ctx.number.groups[0], [uniform, build, trans.args]),
    place: vsmBufferGroup(device, ctx.place.groups[0], [uniform, build]),
    resolve: device.createBindGroup({
      layout: ctx.resolve.groups[0],
      entries: sequentialEntries([
        ...[uniform, build, table, pool, links].map((buffer) => ({ buffer })),
        trans.storageView,
      ]),
    }),
  })
}

/** The clear's group of the VSM tables this frame reads (`res.current`, `vsmPerFrameSet`). */
const clearTables = (res: VsmResources, ctx: VsmTransmissionContext) =>
  ctx.device.createBindGroup({
    layout: ctx.clear.groups[0],
    entries: vsmBindGroupEntries(res, VSM_TRANSMISSION_CLEAR_SPECS),
  })
