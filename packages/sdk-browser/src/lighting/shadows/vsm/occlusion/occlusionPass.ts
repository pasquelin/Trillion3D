/**
 * THE OCCLUSION PYRAMID'S BUILD ENCODED (`occlusionWgsl.ts`):
 * its pipes and groups, held by the set (`VsmResources.occlusionPass`), the build's encoding
 * (`prepareVsmPyramid`, `encodeVsmPyramid`) and the frame's tables kept for the next frame (`keepOcclusionTables`).
 *
 * When the raster calls it (`../render/renderEncode.ts`): with the culling on, each view pass draws what its first cull
 * keeps, the pyramid is built over the pages drawn, its second cull tests what the first held back
 * and draws what it finds visible; once every view pass is drawn, the pyramid is built again. A
 * frame that keeps no previous frame (the set's first, a frame after one that drew no map) has no
 * pyramid to test against: one cull a view pass, then the build.
 */
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { VSM_GROUP_WIDTH } from '../constants.ts'
import { vsmComputePipe, vsmBufferGroup } from '../passKit.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  type VsmResources,
} from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { encodeKeptTables, type VsmOcclusionResources } from './occlusionResources.ts'
import {
  PYRAMID_BUILD_SPECS,
  PYRAMID_SELECT_SPECS,
  PYRAMID_TOP_SPECS,
  pyramidTileLevels,
  pyramidTopLevels,
  vsmBuildPyramidTopWgsl,
  vsmBuildPyramidWgsl,
  vsmSelectPyramidWgsl,
} from './occlusionWgsl.ts'

const LABEL = `${VSM_PASS_PREFIX}occlusion`
/** The build's compute pass (its label is the shadow raster's budget's: `vsmRenderMs`). */
export const BUILD_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}occlusion.build` }

/** The occlusion's group (`VSM_OCCLUSION_GROUP`) of the culls and of the shadow views' descent
 *  (`../traversal/traversalPass.ts`): the pyramid and the kept tables, by load. */
export const vsmOcclusionEntries = () => [
  computeTextureEntry(0, 'unfilterable-float', '2d-array'),
  computeTextureEntry(1, 'uint'),
  computeTextureEntry(2, 'uint'),
  computeTextureEntry(3, 'uint'),
]

/** The build's pipes of `layout`: the selection, the tile kernel — which writes the levels 0 to 4 where
 *  the device grants five storage textures a stage, else 0 to 3 (`pyramidTileLevels`) — and the top
 *  kernel, which writes the levels past them. */
export function vsmOcclusionPipes(device: GPUDevice, layout: VsmLayout) {
  const tileLevels = pyramidTileLevels(device)
  const levels = (count: number, binding: number) =>
    Array.from({ length: count }, (_, k) =>
      computeStorageTextureEntry(binding + k, 'r32float', 'write-only', '2d-array'),
    )
  return {
    select: vsmComputePipe(
      device,
      `${LABEL}.select`,
      vsmSelectPyramidWgsl(layout),
      'vsmSelectPyramidPages',
      [
        vsmBindGroupLayoutEntries(PYRAMID_SELECT_SPECS, COMPUTE),
        [
          computeUniformEntry(0),
          computeBufferEntry(1, 'storage'),
          computeBufferEntry(2, 'storage'),
        ],
      ],
    ),
    build: vsmComputePipe(
      device,
      `${LABEL}.build`,
      vsmBuildPyramidWgsl(layout, tileLevels),
      'vsmBuildPyramid',
      [
        vsmBindGroupLayoutEntries(PYRAMID_BUILD_SPECS, COMPUTE),
        [computeBufferEntry(0, 'read-only-storage'), ...levels(tileLevels, 1)],
      ],
    ),
    top: vsmComputePipe(
      device,
      `${LABEL}.top`,
      vsmBuildPyramidTopWgsl(layout, tileLevels),
      'vsmBuildPyramidTop',
      [
        vsmBindGroupLayoutEntries(PYRAMID_TOP_SPECS, COMPUTE),
        [
          computeBufferEntry(0, 'read-only-storage'),
          computeTextureEntry(1, 'unfilterable-float', '2d-array'),
          ...levels(pyramidTopLevels(tileLevels), 2),
        ],
      ],
    ),
  }
}

/** The build's groups over the VSM resources of a frame set (group 0 of each kernel). */
interface PyramidTables {
  select: GPUBindGroup
  build: GPUBindGroup
  top: GPUBindGroup
}

/** The occlusion's context of a set: its pipes, their own groups (made once with the set's
 *  resources), their groups over a frame set's tables, the parameter last written. */
export interface VsmOcclusionContext {
  device: GPUDevice
  pipes: ReturnType<typeof vsmOcclusionPipes>
  own: PyramidTables
  tables: VsmPerFrameSet<PyramidTables>
  fullUpdate: number
}

/** A view of level `level` of the pyramid, as a one-level array. */
const levelView = (pyramid: GPUTexture, level: number) =>
  pyramid.createView({ dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1 })

/** The groups over the build's own buffers and the pyramid's levels. */
function ownGroups(
  device: GPUDevice,
  pipes: VsmOcclusionContext['pipes'],
  occlusion: VsmOcclusionResources,
): PyramidTables {
  const { pyramid, pages, args, params } = occlusion
  const entries = (views: GPUTextureView[], first: number) =>
    views.map((resource, k) => ({ binding: first + k, resource }))
  const tileLevels = pyramidTileLevels(device)
  const tile = Array.from({ length: tileLevels }, (_, k) => levelView(pyramid, k))
  const top = Array.from({ length: pyramidTopLevels(tileLevels) }, (_, k) =>
    levelView(pyramid, tileLevels + k),
  )
  return {
    select: vsmBufferGroup(device, pipes.select.groups[1], [params, pages, args]),
    build: device.createBindGroup({
      label: `${LABEL}.build1`,
      layout: pipes.build.groups[1],
      entries: [{ binding: 0, resource: { buffer: pages } }, ...entries(tile, 1)],
    }),
    top: device.createBindGroup({
      label: `${LABEL}.top1`,
      layout: pipes.top.groups[1],
      entries: [
        { binding: 0, resource: { buffer: pages } },
        { binding: 1, resource: levelView(pyramid, tileLevels - 1) },
        ...entries(top, 2),
      ],
    }),
  }
}

/** The build's groups over the tables of `res.current` (`vsmPerFrameSet`). */
function pyramidTables(res: VsmResources, ctx: VsmOcclusionContext): PyramidTables {
  const group = (layout: GPUBindGroupLayout, specs: Parameters<typeof vsmBindGroupEntries>[1]) =>
    ctx.device.createBindGroup({ layout, entries: vsmBindGroupEntries(res, specs) })
  return {
    select: group(ctx.pipes.select.groups[0], PYRAMID_SELECT_SPECS),
    build: group(ctx.pipes.build.groups[0], PYRAMID_BUILD_SPECS),
    top: group(ctx.pipes.top.groups[0], PYRAMID_TOP_SPECS),
  }
}

/** The occlusion's context of `res` on `device`: the one it holds, or made — none for a set
 *  without the occlusion. */
export function vsmOcclusionContext(res: VsmResources, device: GPUDevice) {
  const occlusion = res.occlusion
  if (!occlusion) return undefined
  const held = res.occlusionPass
  if (held && held.device === device) return held
  const pipes = vsmOcclusionPipes(device, res.layout)
  const ctx: VsmOcclusionContext = {
    device,
    pipes,
    own: ownGroups(device, pipes, occlusion),
    tables: vsmFrameSetHeld<PyramidTables>(),
    fullUpdate: -1,
  }
  res.occlusionPass = ctx
  return ctx
}

/** Frees what the context of `res` holds (its groups are the device's): nothing but the hold. */
export function releaseVsmOcclusion(res: VsmResources) {
  res.occlusionPass = undefined
}

/**
 * The pyramid built over the pages drawn since the last build, or over every held page with
 * `fullUpdate`: the arguments cleared (`prepareVsmPyramid`), then in one compute
 * pass the selection — which folds and clears the raster marks — and the two builds, indirect.
 */
export function prepareVsmPyramid(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  ctx: VsmOcclusionContext,
  fullUpdate: boolean,
) {
  const occlusion = res.occlusion!
  const full = fullUpdate ? 1 : 0
  if (ctx.fullUpdate !== full) {
    ctx.device.queue.writeBuffer(occlusion.params, 0, new Uint32Array([full, 0, 0, 0]))
    ctx.fullUpdate = full
  }
  encoder.copyBufferToBuffer(occlusion.argsInit, 0, occlusion.args, 0, occlusion.args.size)
}

/** The build's pass, in the run `steps`, after `prepareVsmPyramid`: no copy between it and the
 *  passes around it. */
export function encodeVsmPyramid(steps: ComputeRun, res: VsmResources, ctx: VsmOcclusionContext) {
  const occlusion = res.occlusion!
  const tables = vsmPerFrameSet(ctx.tables, res, pyramidTables, ctx)
  const pass = steps.pass(BUILD_PASS)
  const { select, build, top } = ctx.pipes
  if (!select.pipeline || !build.pipeline || !top.pipeline) return
  pass.setPipeline(select.pipeline)
  pass.setBindGroup(0, tables.select)
  pass.setBindGroup(1, ctx.own.select)
  pass.dispatchWorkgroups(ceilDiv(res.layout.poolPages, VSM_GROUP_WIDTH))
  pass.setPipeline(build.pipeline)
  pass.setBindGroup(0, tables.build)
  pass.setBindGroup(1, ctx.own.build)
  pass.dispatchWorkgroupsIndirect(occlusion.args, 0)
  pass.setPipeline(top.pipeline)
  pass.setBindGroup(0, tables.top)
  pass.setBindGroup(1, ctx.own.top)
  pass.dispatchWorkgroupsIndirect(occlusion.args, 16)
}

/** Whether the previous frame's pyramid and tables are kept for this frame's culls to test against:
 *  the raster culls twice a view pass, the shadow views' descent holding the nodes the pyramid hides
 *  for a post pass. */
export const vsmTwoPass = (res: VsmResources) => !!(res.occlusion?.prevKept && res.kept)

/** The frame set of `res.current`: 0 or 1. */
export const frameParity = (res: VsmResources) => (res.current === res.frames[0] ? 0 : 1)

/** The frame's page table and pages' marks over its `frame.blocks` table blocks and its
 *  `frame.mapCount` maps' stale rects copied into its frame set's kept tables (`encodeKeptTables`),
 *  once its pages are granted: the second cull reads them, and the next frame's first. */
export function keepOcclusionTables(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: { mapCount: number; blocks: number },
) {
  if (!res.occlusion || !res.kept) return
  encodeKeptTables(encoder, res.current, res.kept[frameParity(res)], res.layout, frame)
  res.occlusion.copied = true
}

/** The frame data extraction, occlusion part: a frame
 *  that granted maps and kept its tables is the next frame's previous one; any other leaves none. */
export function keepOcclusionFrame(res: VsmResources, mapsGranted: boolean) {
  const occlusion = res.occlusion
  if (!occlusion) return
  occlusion.prevKept = mapsGranted && occlusion.copied
  occlusion.copied = false
}
