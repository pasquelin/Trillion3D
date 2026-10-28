/**
 * THE SHADOW VIEWS' DESCENT ENCODED (`traversalWgsl.ts`), at the head of the raster's first compute
 * pass (`../render/renderEncode.ts`), as the camera's cut encodes its own (`../../../../geometry/dag/encode.ts`):
 * the views listed, queue 0 written, the levels a resident page needs reached — level 0 flat, every
 * later level on what the one before it deposited, its arguments armed in the pass —, then the pages
 * it listed handed to the casters' kernel (`VSM_RENDER_COUNT_LISTED`), which dispatches on them.
 * With the occlusion, the nodes the previous frame's pyramid hid are judged again in the second
 * compute pass of a view pass, once the pyramid is built over what its first raster drew
 * (`encodeVsmDescentPost`): the held nodes, then every level again on those seen, the pages they
 * list handed to the casters' kernel behind the first's.
 *
 * Its lists are the camera's cut's, laid for its views: the descent array — three words an entry, the
 * entry, its placement, its view — of queue 0's entries for each view and the nodes it opens; the
 * listed pages, each once (`candAppend`), as many as the packed pages; the nodes held for the post
 * pass, four words each, as many as the descent array's entries; its readout, the requests, as the
 * cut's (`../../../../geometry/dag/readoutWords.ts`), copied back to the streaming (`requests.ts`).
 * The nodes it opens are held to the cut's cap of nodes (`cutMaxNodes`): a frame past it draws what
 * fit.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { COMPUTE, computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import { createRecordTexture } from '../../../../gpu/core/recordTexture.ts'
import { sizedBuffer } from '../../../../gpu/core/sizedBuffer.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../../../gpu/dispatch/grid.ts'
import type { CutTables } from '../../../../geometry/dag/cut/cutReaders.ts'
import { FLAG_TABLE } from '../../../../geometry/dag/cut/cutTables.ts'
import { copiedWords } from '../../../../geometry/dag/readoutWords.ts'
import { dagBindEntries } from '../../../../geometry/dag/shader/bindings.ts'
import {
  DAG_ARGS,
  DAG_ARGS_INITIAL,
  DAG_ARM_BINDING,
  dagArmPipe,
} from '../../../../geometry/dag/shader/armWgsl.ts'
import { BLOCK_MASK_WORDS, FRAME_COUNTERS } from '../../../../geometry/dag/shader/floorWgsl.ts'
import { CULL_MIN_LOD_OFF, DAG_UNIFORM_BYTES } from '../../../../geometry/dag/shader/viewsWgsl.ts'
import { OCCLUSION_TWO_PASS } from '../../../../geometry/dag/shader/occlusionWgsl.ts'
import { viewWord } from '../../../../geometry/dag/viewLayout.ts'
import { entryWords } from '../../../../geometry/dag/shader/descentShape.ts'
import { flagShapeWords } from '../../../../geometry/dag/flagSections.ts'
import { vsmComputePipe } from '../passKit.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmFrameSetHeld,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  type VsmResources,
} from '../resources.ts'
import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../../../gpu/bind/bindIdentity.ts'
import { VSM_LIGHT_WORDS, VSM_RENDER_LIGHT_BYTES } from '../constants.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmOcclusionEntries } from '../occlusion/occlusionPass.ts'
import { VSM_RENDER_FIRST_SLOT, vsmRenderParamsEntry } from '../render/renderParams.ts'
import {
  VSM_DESCENT_ENTRY,
  VSM_DESCENT_SHAPE,
  VSM_DESCENT_SPECS,
  vsmDescentWgsl,
} from './traversalWgsl.ts'
import { uniformBuffer } from '../../../../gpu/core/uniformBlock.ts'

const LABEL = 'vsm.descent'

/** What the descent reads of the cut (`CutTables`): its tables at the culling's bindings and what a
 *  descent beside it is laid out by. */
export interface VsmDescentScene {
  tables: CutTables['views'] & { cold: GPUTextureView; previous: GPUTextureView }
  info: CutTables['descent']
}

/** The descent's sizes for a frame: queue 0's entries a view, the views at most (a map and a mip of
 *  it with a page to draw), the lights of the frame, the nodes it may open, the pages it may list. */
interface DescentSizes {
  views: number
  lights: number
  nodeBudget: number
  candCap: number
}

/** The descent's pipes on `layout`'s VSM tables: its kernels on its two groups — the levels and the
 *  post pass's held nodes on a third, the occlusion's, for the sight of a node —, its arming kernel
 *  on its own at the list words of its `work`, its counters first (`dagArmPipe`). */
export function vsmDescentPipes(device: GPUDevice, layout: VsmLayout) {
  const code = vsmDescentWgsl(layout)
  // The culling's group, the bindings the descent reads: its tables, the poses the previous image
  // drew, its uniform block, its flags, its readout and its work.
  const used = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const groups = [
    dagBindEntries().filter((entry) => used.has(entry.binding)),
    [
      vsmRenderParamsEntry(0),
      ...vsmBindGroupLayoutEntries(VSM_DESCENT_SPECS, COMPUTE),
      computeBufferEntry(4, 'storage', COMPUTE),
      computeBufferEntry(8, 'read-only-storage', COMPUTE),
    ],
  ]
  const sighted = [...groups, vsmOcclusionEntries()]
  const pipe = (entry: string, of = groups) =>
    vsmComputePipe(device, `${LABEL}.${entry}`, code, entry, of)
  const arm = dagArmPipe()
  return {
    views: pipe(VSM_DESCENT_ENTRY.views),
    prepare: pipe(VSM_DESCENT_ENTRY.prepare),
    levels: VSM_DESCENT_ENTRY.levels.map((entry) => pipe(entry, sighted)),
    postPrepare: pipe(VSM_DESCENT_ENTRY.postPrepare),
    postNodes: pipe(VSM_DESCENT_ENTRY.postNodes, sighted),
    close: pipe(VSM_DESCENT_ENTRY.close),
    arm: vsmComputePipe(
      device,
      `${LABEL}.${VSM_DESCENT_ENTRY.arm}`,
      code,
      VSM_DESCENT_ENTRY.arm,
      arm.groups,
      arm.constants,
    ),
  }
}
type DescentPipes = ReturnType<typeof vsmDescentPipes>

/** A set's descent: its pipes, its uniform block, its lists and their groups. */
export interface VsmDescent {
  device: GPUDevice
  pipes?: DescentPipes
  uniform: GPUBuffer
  block: Uint32Array<ArrayBuffer>
  flags?: ReturnType<typeof createRecordTexture>
  out?: GPUBuffer
  work?: GPUBuffer
  args: GPUBuffer
  /** Its culling and arming groups, made again when what they bind moves; its VSM group, once a
   *  frame set (`vsmPerFrameSet`). */
  culling: WebgpuBindIdentity
  groups?: { culling: GPUBindGroup; arm: GPUBindGroup }
  vsmSets: VsmPerFrameSet<GPUBindGroup>
  vsm?: GPUBindGroup
  /** The raster's lists its VSM group was made over, set before it is asked. */
  lists?: VsmDescentLists
  /** Its readout's ranks and its uniform's caps this frame. */
  listCap: number
  queueCap: number
  /** Where the frame's lights lie in its `work`, in bytes, and how many bytes they take
   *  (`clearVsmDescent`). */
  lightsAt: number
  lightBytes: number
}

const descents = new WeakMap<VsmResources, VsmDescent>()

/** The bytes the descent of `res` holds on the device. */
export function vsmDescentBytes(res: VsmResources) {
  const d = descents.get(res)
  if (!d) return 0
  return (
    d.uniform.size + d.args.size + (d.out?.size ?? 0) + (d.work?.size ?? 0) + (d.flags?.bytes ?? 0)
  )
}

/** Releases the descent of `res`. */
export function releaseVsmDescent(res: VsmResources) {
  const d = descents.get(res)
  if (!d) return
  for (const buffer of [d.uniform, d.args, d.out, d.work]) buffer?.destroy()
  d.flags?.texture.destroy()
  descents.delete(res)
}

/** The descent of `res` on `device`, made the first time. */
function descentOf(res: VsmResources, device: GPUDevice): VsmDescent {
  let d = descents.get(res)
  if (d?.device === device) return d
  if (d) releaseVsmDescent(res)
  const args = device.createBuffer({
    label: `${LABEL}.args`,
    size: DAG_ARGS_INITIAL.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(args, 0, DAG_ARGS_INITIAL)
  d = {
    device,
    uniform: uniformBuffer(device, `${LABEL}.uniform`, DAG_UNIFORM_BYTES),
    block: new Uint32Array(DAG_UNIFORM_BYTES / 4),
    args,
    culling: createWebgpuBindIdentity(),
    vsmSets: vsmFrameSetHeld<GPUBindGroup>(),
    listCap: 0,
    queueCap: 0,
    lightsAt: 0,
    lightBytes: 0,
  }
  descents.set(res, d)
  return d
}

/** The bytes the descent's lists ask for `sizes` beyond what they hold. */
export function vsmDescentGrowth(res: VsmResources, scene: VsmDescentScene, sizes: DescentSizes) {
  const d = descents.get(res)
  const { flags, out, work } = listBytes(scene, sizes)
  return (
    Math.max(0, flags - (d?.flags?.bytes ?? 0)) +
    Math.max(0, out - (d?.out?.size ?? 0)) +
    Math.max(0, work - (d?.work?.size ?? 0))
  )
}

/** The descent's queue words — every view's queue 0 and the entries no budget bounds, then the
 *  nodes it opens — and its lists' bytes: its flags (the queue, the listed pages and the nodes held
 *  for the post pass, as many as the queue's entries), its readout, its work (the frame counters,
 *  the views' list, the frame's lights, the pages' mask: `counterBase`). */
function listBytes(
  { info }: VsmDescentScene,
  { views, lights, nodeBudget, candCap }: DescentSizes,
) {
  const queueCap = entryWords(VSM_DESCENT_SHAPE) * (info.entries * views + nodeBudget)
  return {
    queueCap,
    flags: 4 * flagShapeWords({ queueWords: queueCap, candCap, nodeBudget }),
    out: 4 * copiedWords(info.listCap),
    work:
      4 *
      (FRAME_COUNTERS + 1 + views + VSM_LIGHT_WORDS * lights + info.blockCount * BLOCK_MASK_WORDS),
    viewBase: FRAME_COUNTERS,
    lightBase: FRAME_COUNTERS + 1 + views,
  }
}

/** The raster's lists the descent uses: the parameters' window, the counters and the placements'
 *  words, which it binds, and the frame's lights, which it copies into its `work` (`RenderListGroups`,
 *  the object the VSM group is held under, made again when one of them moved). */
export interface VsmDescentLists {
  params: GPUBufferBinding
  lights: GPUBuffer
  counts: GPUBuffer
  rootWords: GPUBuffer
}

/**
 * The descent of `res` made ready for a frame of `sizes`: its pipes, its lists grown, its uniform
 * block written — the main view's (`CutTables.descent.block`), the descent's caps in place of the
 * cut's, the two-pass occlusion where the previous frame's pyramid is kept, no filter —, its groups made again when what they bind
 * moved. Returns the descent and the word its views' list starts at.
 */
export function prepareVsmDescent(
  res: VsmResources,
  device: GPUDevice,
  scene: VsmDescentScene,
  sizes: DescentSizes,
  lists: VsmDescentLists,
  twoPass: boolean,
) {
  const d = descentOf(res, device)
  const { info, tables } = scene
  d.pipes ??= vsmDescentPipes(device, res.layout)
  const bytes = listBytes(scene, sizes)
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  d.out = sizedBuffer(device, d.out, bytes.out, storage, `${LABEL}.out`)
  d.work = sizedBuffer(device, d.work, bytes.work, storage, `${LABEL}.work`)
  const records = bytes.flags / 4
  if (!d.flags || d.flags.capacity < records) {
    d.flags?.texture.destroy()
    d.flags = createRecordTexture(
      device,
      { ...FLAG_TABLE, label: `${LABEL}.flags` },
      records,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    )
  }
  d.listCap = info.listCap
  d.queueCap = bytes.queueCap
  d.lightsAt = 4 * bytes.lightBase
  d.lightBytes = VSM_RENDER_LIGHT_BYTES * sizes.lights
  writeBlock(d, info, sizes, twoPass)
  const next = d.culling.next
  next.length = 0
  next.push(d.out, d.work, d.flags.view, d.args, d.uniform)
  next.push(tables.nodes, tables.frames, tables.worlds, tables.tree, tables.cold, tables.previous)
  if (d.culling.moved() || !d.groups) d.groups = cullingGroups(d, tables)
  // The VSM group over the frame set's tables and the raster's lists, made again when one of them
  // moved (`lists` is the object the raster holds its list groups in).
  d.lists = lists
  d.vsm = vsmPerFrameSet(d.vsmSets, res, vsmGroup, d, lists)
  return { descent: d, viewBase: bytes.viewBase }
}

/** The uniform block: the main view's, with the descent's caps — its queue, its listed pages, the
 *  nodes it opens, its readout's ranks —, the two-pass occlusion where the previous frame's pyramid
 *  is kept (`twoPass`), no cull turned off but the too-coarse leaves' (`CULL_MIN_LOD_OFF`), no filter. */
function writeBlock(
  d: VsmDescent,
  info: VsmDescentScene['info'],
  sizes: DescentSizes,
  twoPass: boolean,
) {
  const W = viewWord
  d.block.set(info.block.subarray(0, d.block.length))
  d.block[W('queueCap')] = d.queueCap
  d.block[W('candCap')] = sizes.candCap
  d.block[W('nodeBudget')] = sizes.nodeBudget
  d.block[W('listCap')] = d.listCap
  d.block[W('occlusion')] = twoPass ? OCCLUSION_TWO_PASS : 0
  // The camera's switch of the too-coarse leaves' cull (`cutMinLodCulling`) is the shadow views' too, as the
  // reference has one flag for its cluster cull; the other culls the host turned off are the camera's alone.
  d.block[W('cullOff')] &= CULL_MIN_LOD_OFF
  d.block[W('filterBase')] = 0
  d.device.queue.writeBuffer(d.uniform, 0, d.block)
}

/** The descent's culling group — the cut's tables at the culling's bindings, its uniform block, its
 *  flags, readout and work — and its arming group. */
function cullingGroups(d: VsmDescent, tables: VsmDescentScene['tables']) {
  const { device } = d
  const pipes = d.pipes!
  const culling = device.createBindGroup({
    label: `${LABEL}.culling`,
    layout: pipes.views.groups[0]!,
    entries: [
      { binding: 1, resource: tables.nodes },
      { binding: 2, resource: { buffer: d.uniform } },
      { binding: 3, resource: d.flags!.view },
      { binding: 4, resource: { buffer: d.out! } },
      { binding: 5, resource: { buffer: d.work! } },
      { binding: 6, resource: tables.worlds },
      { binding: 7, resource: tables.frames },
      { binding: 8, resource: tables.cold },
      { binding: 9, resource: tables.tree },
      { binding: 10, resource: tables.previous },
    ],
  })
  const arm = device.createBindGroup({
    label: `${LABEL}.arm`,
    layout: pipes.arm.groups[0]!,
    entries: [
      { binding: DAG_ARM_BINDING.work, resource: { buffer: d.work! } },
      { binding: DAG_ARM_BINDING.args, resource: { buffer: d.args } },
    ],
  })
  return { culling, arm }
}

/** The descent's VSM group over the tables of `res.current` and the raster's lists `d.lists`. */
function vsmGroup(res: VsmResources, d: VsmDescent) {
  const { params, counts, rootWords } = d.lists!
  return d.device.createBindGroup({
    label: `${LABEL}.vsm`,
    layout: d.pipes!.views.groups[1]!,
    entries: [
      { binding: 0, resource: params },
      ...vsmBindGroupEntries(res, VSM_DESCENT_SPECS),
      { binding: 4, resource: { buffer: counts } },
      { binding: 8, resource: { buffer: rootWords } },
    ],
  })
}

/** The views' count cleared and the frame's lights copied into the work (`descentLight`), out of the
 *  pass: the views kernel counts from none, over the lights as this frame wrote them. */
export function clearVsmDescent(encoder: GPUCommandEncoder, d: VsmDescent, viewBase: number) {
  encoder.clearBuffer(d.work!, viewBase * 4, 4)
  encoder.copyBufferToBuffer(d.lists!.lights, 0, d.work!, d.lightsAt, d.lightBytes)
}

/** What a descent is encoded for: the lights of the frame, whose maps list the views, and the views
 *  at most (`DescentSizes.views`), which queue 0 holds the roots of. */
export interface VsmDescentExtent {
  lights: number
  views: number
}

/** The arming kernel in `pass`, then the culling group back in place: the kernels that follow bind it. */
function arm(pass: GPUComputePassEncoder, d: VsmDescent) {
  const pipeline = d.pipes!.arm.pipeline
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, d.groups!.arm)
  pass.dispatchWorkgroups(1)
  pass.setBindGroup(0, d.groups!.culling)
}

/**
 * The descent in `pass` for `extent` over `info`'s levels: the views, queue 0, the levels, and the
 * close, which hands the casters' kernel its pages; the casters' dispatch reads its arguments from
 * `descent.args` (`DAG_ARGS.cand`), armed last. `occlusion` is the group of the previous frame's
 * pyramid and tables, which the levels judge a node by, or a blank one.
 */
export function encodeVsmDescent(
  pass: GPUComputePassEncoder,
  d: VsmDescent,
  info: VsmDescentScene['info'],
  extent: VsmDescentExtent,
  occlusion: GPUBindGroup,
) {
  const pipes = d.pipes!
  const seeds = info.rootSlots * extent.views
  const { views, prepare, close } = pipes
  const first = pipes.levels[0]!.pipeline
  if (!views.pipeline || !prepare.pipeline || !first || !close.pipeline) return
  pass.setBindGroup(0, d.groups!.culling)
  pass.setBindGroup(1, d.vsm!, VSM_RENDER_FIRST_SLOT)
  pass.setBindGroup(2, occlusion)
  pass.setPipeline(views.pipeline)
  dispatchRows(pass, ceilDiv(Math.max(1, extent.lights), WORKGROUP_THREADS))
  pass.setPipeline(prepare.pipeline)
  dispatchRows(pass, ceilDiv(Math.max(1, seeds, info.blockCount), WORKGROUP_THREADS))
  pass.setPipeline(first)
  dispatchRows(pass, ceilDiv(Math.max(1, seeds), WORKGROUP_THREADS))
  encodeLevels(pass, d, 1, info.levels, VSM_RENDER_FIRST_SLOT)
  arm(pass, d)
  pass.setPipeline(close.pipeline)
  pass.setBindGroup(1, d.vsm!, VSM_RENDER_FIRST_SLOT)
  pass.dispatchWorkgroups(1)
}

/** Levels `first` up to `end` of the descent in `pass`, each on the arguments armed from what the
 *  level before it deposited, the VSM group at `offset`. */
function encodeLevels(
  pass: GPUComputePassEncoder,
  d: VsmDescent,
  first: number,
  end: number,
  offset: readonly number[],
) {
  const { levels } = d.pipes!
  for (let level = first; level < end; level++) {
    arm(pass, d)
    const pipeline = levels[level % levels.length]!.pipeline
    if (!pipeline) continue
    pass.setPipeline(pipeline)
    pass.setBindGroup(1, d.vsm!, offset)
    pass.dispatchWorkgroupsIndirect(d.args, DAG_ARGS.queues[level % 3]!)
  }
}

/**
 * The descent's post pass in `pass`, once the pyramid is built over what the first raster of the
 * view pass whose parameters lie at `offset` drew: the pass opened, the nodes held for it judged
 * again by `occlusion`, the group of this frame's pyramid and tables — those of this view pass's
 * maps, seen ones entering queue 0 —, every level again on them (`info.levels`), and the close,
 * which hands the casters' kernel the pages they listed, behind those of the main pass.
 */
export function encodeVsmDescentPost(
  pass: GPUComputePassEncoder,
  d: VsmDescent,
  info: VsmDescentScene['info'],
  occlusion: GPUBindGroup,
  offset: readonly number[],
) {
  const { postPrepare, postNodes, close } = d.pipes!
  if (!postPrepare.pipeline || !postNodes.pipeline || !close.pipeline) return
  pass.setBindGroup(0, d.groups!.culling)
  pass.setBindGroup(1, d.vsm!, offset)
  pass.setBindGroup(2, occlusion)
  pass.setPipeline(postPrepare.pipeline)
  pass.dispatchWorkgroups(1)
  arm(pass, d)
  pass.setPipeline(postNodes.pipeline)
  pass.setBindGroup(1, d.vsm!, offset)
  pass.dispatchWorkgroupsIndirect(d.args, DAG_ARGS.postNodes)
  encodeLevels(pass, d, 0, info.levels, offset)
  arm(pass, d)
  pass.setPipeline(close.pipeline)
  pass.setBindGroup(1, d.vsm!, offset)
  pass.dispatchWorkgroups(1)
}

/** The casters' dispatch argument the descent armed: a thread a listed page (`DAG_ARGS.cand`). */
export const VSM_DESCENT_LISTED_ARGS = DAG_ARGS.cand
