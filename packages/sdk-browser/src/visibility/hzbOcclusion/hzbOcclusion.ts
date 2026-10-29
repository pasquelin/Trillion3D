import { ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { readHizSetting } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { HZB_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { GpuHiz } from '../hiz/gpu/types.ts'
import { createOcclusionFrame, fillOcclusionFrame } from '../../blend/transparent/occlusionHost.ts'
import { liveBuffer } from '../../gpu/bind/liveEntries.ts'
import { composeGroup, heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import {
  createTransparentOcclusion,
  type TransparentOcclusion,
} from '../../gpu/core/transparentOcclusion.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { HZB_CORNERS_ENTRY, HZB_CORNERS_WGSL, HZB_PARAMS_BYTES } from './hzbCornersWgsl.ts'
import {
  createHardwareQueries,
  destroyHardwareQueries,
  encodeHardwareQueries,
  type HardwareQueries,
} from '../hardwareOcclusion/hardwareOcclusion.ts'
import { hiddenRanks, sameRanks, setHzbOccludedRanks } from './occludedRoots.ts'

const PASS: GPUComputePassDescriptor = { label: HZB_OCCLUSION_PASS }

/** The corners pass's kernel, once a device, compiled off the thread. */
const cornersKernel = autoKernel(HZB_OCCLUSION_PASS, HZB_CORNERS_WGSL, HZB_CORNERS_ENTRY)

/** The roots the verdicts are of: how many, and which roots they were (`rootIndex.revision`). */
type Tag = { roots: number; revision: number }

/** The words and floats of the corners pass's uniform. */
const words = new Uint32Array(HZB_PARAMS_BYTES / 4),
  floats = new Float32Array(words.buffer),
  inverse = new Float64Array(16)

/** What a session holds of the roots' test against the depth: the test over the roots' corners (the transparent clusters' own, `createTransparentOcclusion`),
 *  the roots' verdicts, their history, and the readback that brings the verdicts to the CPU a few images late. */
interface Held {
  /** The roots the test is made for (a power of two at least the roots): a session with more makes it over. */
  capacity: number
  occlusion: TransparentOcclusion | undefined
  disposed: boolean
  params: GPUBuffer
  verdict: GPUBuffer
  history: GPUBuffer
  group: ReturnType<typeof heldGroup>
  ring: ReturnType<typeof createReadbackRing<Tag>>
  frame: ReturnType<typeof createOcclusionFrame>
  /** The ranks the last verdict hid, the same array until it changes. */
  ranks: readonly number[]
  /** The roots' hardware occlusion queries, made with the first image that asks for them. */
  queries: HardwareQueries | undefined
  /** This image copied its verdicts into the ring's buffer: mapped once the image is submitted. */
  encoded: boolean
}

const helds = new WeakMap<object, Held>()

/** Reads the verdicts that came back: the roots a test found behind the depth, as a list when the roots are still those it tested. */
function readVerdicts(rt: WebgpuPagesRuntime, held: Held, mapped: ArrayBuffer, tag: Tag) {
  const current =
    tag.roots === rt.layout.selectionRoots.length && tag.revision === rt.layout.rootIndex.revision
  const hidden = current ? hiddenRanks(new Uint32Array(mapped, 0, tag.roots), tag.roots) : []
  if (!sameRanks(held.ranks, hidden)) held.ranks = hidden
  // Put again even when unchanged: the stored verdict may be of an older root index, and the same array keeps the filter's identity.
  setHzbOccludedRanks(rt, held.ranks)
}

/** The test made for `capacity` roots: its buffers, and (off the frame) the test's pipelines. */
function makeHeld(rt: WebgpuPagesRuntime, device: GPUDevice, hiz: GpuHiz, capacity: number): Held {
  const buffer = (label: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({ label: `Trillion3D hzb occlusion ${label}`, size, usage })
  const held: Held = {
    capacity,
    occlusion: undefined,
    disposed: false,
    params: buffer('params', HZB_PARAMS_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    verdict: buffer(
      'verdicts',
      capacity * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    ),
    history: buffer('history', capacity * 8, GPUBufferUsage.STORAGE),
    group: heldGroup(),
    ring: createReadbackRing<Tag>(
      device,
      { label: 'Trillion3D hzb occlusion readback', bytes: capacity * 4, count: 3 },
      (mapped, _staging, tag) => readVerdicts(rt, held, mapped, tag),
    ),
    frame: createOcclusionFrame(),
    ranks: [],
    queries: undefined,
    encoded: false,
  }
  void createTransparentOcclusion(device, capacity, {
    pyramid: () => hiz.pyramidView(),
    levels: hiz.levelTable,
    depth: () => hiz.depth()?.resources[0],
    occluded: () => held.verdict,
  }).then((occlusion) => {
    if (held.disposed) occlusion?.dispose()
    else held.occlusion = occlusion
  })
  return held
}

/** The test's resources let go, the verdict cleared: the roots all show again. */
function release(rt: WebgpuPagesRuntime) {
  const held = helds.get(rt)
  if (!held) return
  helds.delete(rt)
  held.disposed = true
  held.occlusion?.dispose()
  const { device } = rt.gpu
  const { params, verdict, history, ring } = held
  const free = {
    destroy() {
      params.destroy()
      verdict.destroy()
      history.destroy()
      ring.destroy()
      if (held.queries) destroyHardwareQueries(held.queries)
    },
  }
  if (device) retire(device, free)
  else free.destroy()
  if (held.ranks.length) setHzbOccludedRanks(rt, [])
}

/** The test's resources let go with the session. */
export const disposeHzbOcclusion = release

/** The world extent of `pixels` of the screen at a unit clip `w`, as the reference counts it: the inverse of the view-projection applied to the pixels' share of the view,
 *  into `out` at `at` (three floats), none for no pixels. */
function writeScreenGrowth(
  out: Float32Array,
  at: number,
  pixels: number,
  size: readonly [number, number],
) {
  if (pixels <= 0) return out.fill(0, at, at + 3)
  const x = pixels / size[0],
    y = pixels / size[1]
  for (let k = 0; k < 3; k++) out[at + k] = inverse[k]! * x + inverse[4 + k]! * y
}

/** Writes the corners pass's uniform for the image of `cam`. */
function writeParams(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: Held,
  cam: EngineCamera,
  roots: number,
  grown: boolean,
) {
  // The growths are the depth pyramid test's settings: the queries draw the boxes as they are.
  const grow = (
    field:
      | 'hzbOcclusionExpandAmount'
      | 'hzbOcclusionExpandNewlyAmount'
      | 'hzbOcclusionExpandScreenSpace'
      | 'hzbOcclusionExpandNewlyScreenSpace',
  ) => (grown ? readHizSetting(rt, field) : 0)
  const framesNot = readHizSetting(rt, 'hzbOcclusionFramesNotTestedToExpand'),
    framesFor = readHizSetting(rt, 'hzbOcclusionFramesToExpandNewly'),
    amount = grow('hzbOcclusionExpandAmount'),
    newly = grow('hzbOcclusionExpandNewlyAmount'),
    screen = grow('hzbOcclusionExpandScreenSpace'),
    screenNewly = grow('hzbOcclusionExpandNewlyScreenSpace'),
    never = readHizSetting(rt, 'hzbOcclusionNeverTestDistance')
  // The growth of a root newly tested is on only with an amount, and frames, to grow it by.
  const growsNewly = (newly > 0 || screenNewly > 0) && framesFor > 0 && framesNot > 0
  words.set([roots, rt.run.frame >>> 0, growsNewly ? framesNot : 0, growsNewly ? framesFor : 0], 0)
  packDoubles(words, 4, cam.eye, 0, 3)
  floats.set([never * never, amount, newly, 0], 12)
  const size = rt.gpu.targetSize
  const { viewProj } = held.frame
  if (screen > 0 || screenNewly > 0) invertMatrix4(inverse, viewProj)
  writeScreenGrowth(floats, 16, screen, size)
  writeScreenGrowth(floats, 20, screen + screenNewly, size)
  matrixAtRenderOrigin(floats, viewProj, cam.eye, 24)
  device.queue.writeBuffer(held.params, 0, words)
}

/**
 * THE ROOTS' TEST AGAINST THE DEPTH PYRAMID (`hzbOcclusion`, off by default), encoded once the image's pyramid is built: the world box of every root, grown as the
 * settings ask, is projected and walked against the farthest depth of the pyramid, with the walk and the projection the transparent clusters are
 * tested with (the reference's, `createTransparentOcclusion`); the verdicts are copied for the CPU and come back a few images late
 * (`hzbOcclusionSubmitted`), the roots they find hidden are the ones the main view's cut leaves out (`hzbOccludedRanks`, `../../frame/render/cutViewSet.ts`). A root with no
 * box, outside the view or within `hzbOcclusionNeverTestDistance` is never rejected. Nothing while the setting is 0, the pyramid is not built or the
 * pipelines compile.
 */
export function encodeHzbOcclusion(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  encoder: GPUCommandEncoder,
) {
  const { device } = rt.gpu
  const roots = rt.layout.selectionRoots.length
  const hiz = rt.vis.gpuHiz
  // The main view alone is tested: its verdicts are the only ones the cut reads.
  if (rt.views.active !== rt.views.main) return
  if (
    !device ||
    !hiz ||
    !roots ||
    !rt.rootWorlds?.boxes ||
    (readHizSetting(rt, 'hzbOcclusion') === 0 && !readHizSetting(rt, 'occlusionQueries'))
  )
    return release(rt)
  // The depth pyramid's test stands in for the queries where it is on (the reference's order), and the queries are made once it is off.
  const pyramid = readHizSetting(rt, 'hzbOcclusion') !== 0
  let held = helds.get(rt)
  if (held && held.capacity < roots) {
    release(rt)
    held = undefined
  }
  if (!held) helds.set(rt, (held = makeHeld(rt, device, hiz, nextPow2(Math.max(roots, 1024)))))
  const { occlusion } = held
  const pipeline = cornersKernel(device).get()
  // Without a fresh pyramid the test writes no verdict (it clears them): the last ones stand.
  if (!occlusion || !pipeline || (pyramid && !rt.run.hizPyramidFresh)) return
  fillOcclusionFrame(rt, cam, held.frame)
  // The roots are tested by the image's own pyramid, whatever the cut does: no frozen cut's verdicts, the reference's walk.
  held.frame.cull = 'follow'
  held.frame.referenceTest = true
  writeParams(rt, device, held, cam, roots, pyramid)
  if (pyramid) occlusion.begin(held.frame)
  encoder.clearBuffer(occlusion.unculled)
  held.group.identity.entries[0] ??= sequentialEntries([
    liveBuffer(() => held.params),
    liveBuffer(() => rt.rootWorlds?.boxes),
    liveBuffer(() => occlusion.corners),
    liveBuffer(() => occlusion.unculled),
    liveBuffer(() => held.history),
  ])
  composeGroup(device, held.group, pipeline)
  const pass = encoder.beginComputePass(PASS)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, held.group.group!)
  dispatchRows(pass, ceilDiv(roots, WORKGROUP_THREADS))
  pass.end()
  rt.run.gpuComputeDispatches++
  if (pyramid) occlusion.encode(encoder, rt.run.hizPyramidFresh)
  else {
    held.queries ??= createHardwareQueries(device, held.capacity, {
      params: () => held.params,
      corners: () => occlusion.corners,
      unculled: () => occlusion.unculled,
      verdict: () => held.verdict,
    })
    if (!encodeHardwareQueries(rt, device, encoder, held.queries, roots)) return
  }
  const tag: Tag = { roots, revision: rt.layout.rootIndex.revision }
  const staging = held.ring.take(tag, roots * 4)
  if (!staging) return
  encoder.copyBufferToBuffer(held.verdict, 0, staging, 0, roots * 4)
  held.encoded = true
}

/** After the image is submitted: the verdicts it copied map and are read when they come back, never waited for. */
export function hzbOcclusionSubmitted(rt: object) {
  const held = helds.get(rt)
  if (!held?.encoded) return
  held.encoded = false
  held.ring.submitted()
}
