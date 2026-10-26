/**
 * THE CASTERS THE SHADOW RASTER DRAWS, as the engine's decode makes them drawable: the candidates
 * kernel (`../vsm/render/renderCandidatesWgsl.ts`) lists the clusters the main view's cut would draw
 * there, whatever the frustum and the pyramid say — a shadow is of the world, not of the view —, in the
 * layout of the cut's list of visible clusters (`../../../geometry/dag/visible/layout.ts`: a page, a
 * placement, a tag); the decode of the visible clusters (`../../../visibility/decode/`) makes each its
 * `PageInfo` from its cluster's record, its placement's record and world, and the raster reads them
 * as the visibility raster does. A cluster is decoded once per frame, here or there: the list and the
 * decoded clusters are the casters' own, sized for the clusters that may cast
 * (`ClusterState.candidateCount`).
 */
import { grownLength } from '../../../../../math/src/sequence/resized.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { RASTER_PASS_MAIN, type RasterPass } from '../../../visibility/raster/contract.ts'
import { createGpuDecode, type DecodeInputs } from '../../../visibility/decode/decode.ts'
import { DECODE_ARGS_BYTES, DEFORM } from '../../../visibility/decode/contract.ts'
import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
import { visibleBytes } from '../../../geometry/dag/visible/layout.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** The decode of the casters on `device`, compiled once and kept for every session of it: its groups
 *  follow the buffers they name, which only the casters use. */
export const casterDecode = oncePerDevice(createGpuDecode)

/** The decode compiled off the thread before the first lit frame, with the other shadow pipelines
 *  (`prepareVsmPipelines`): no frame waits for it. */
export const prepareCasterDecode = (device: GPUDevice) =>
  casterDecode(device)
    .prepare()
    .then(() => undefined)

/** Bytes of a decoded cluster, and of the work buffer the decode keeps its lists in for `cap`
 *  clusters (its ranges, its deformation's list). */
const PAGE_BYTES = PAGE_INFO.words * 4
const workBytes = (cap: number) => 4 * (DEFORM.at + DEFORM.list + cap)

/** Bytes the casters hold for `cap` candidates: their list, their decoded clusters, the decode's
 *  work buffer and arguments. */
export const casterFeedBytes = (cap: number) =>
  visibleBytes(cap) + cap * PAGE_BYTES + workBytes(cap) + DECODE_ARGS_BYTES

/** The casters' buffers, held for `cap` candidates at most. */
export interface CasterFeed {
  device: GPUDevice
  cap: number
  /** The candidates kernel's list, in the layout of the cut's (`VISIBLE_HEADER_WORDS` words, then a
   *  page, a placement and a tag a cluster). */
  list: GPUBuffer
  /** Their decoded clusters, at their index in the list (`PAGE_INFO`). */
  pages: GPUBuffer
  work: GPUBuffer
  args: GPUBuffer
  /** The buffers the decode names, rewritten before each encode. */
  inputs: DecodeInputs
}

/** The least candidates the casters hold room for. */
const FLOOR = 256

function createCasterFeed(device: GPUDevice, cap: number): CasterFeed {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const make = (label: string, size: number, usage = storage) =>
    device.createBuffer({ label: `Trillion3D shadow casters ${label}`, size, usage })
  return {
    device,
    cap,
    list: make('list', visibleBytes(cap)),
    pages: make('decoded clusters', cap * PAGE_BYTES),
    work: make('decode work', workBytes(cap)),
    args: make('decode arguments', DECODE_ARGS_BYTES, storage | GPUBufferUsage.INDIRECT),
    inputs: {} as DecodeInputs,
  }
}

/** Frees the casters' buffers. */
export function releaseCasterFeed(feed: CasterFeed | undefined) {
  if (!feed) return
  for (const buffer of [feed.list, feed.pages, feed.work, feed.args]) buffer.destroy()
}

/**
 * The casters held for `need` candidates at least: made at the first frame that casts, and again,
 * larger by the engine's one growth, when the clusters that may cast outgrow them — what they held is
 * rewritten every frame, nothing is copied. A device that refuses the allocation throws, as any
 * shadow allocation does (`constructGpuResources`, `vsmGrant.ts`).
 */
export function ensureCasterFeed(rt: WebgpuPagesRuntime, device: GPUDevice, need: number) {
  const { lights } = rt
  let feed = lights.casters
  if (feed && feed.device === device && feed.cap >= need) return feed
  const cap = grownLength(feed?.device === device ? feed.cap : 0, Math.max(FLOOR, need))
  releaseCasterFeed(feed)
  feed = lights.casters = createCasterFeed(device, cap)
  return feed
}

/**
 * Names to the decode the buffers it reads and writes this frame: the casters' list and decoded
 * clusters, and the cut's cluster records, the roots' worlds in doubles and the placements' records
 * and results. False while one is missing (no cut yet, no placement table): there is nothing to
 * decode them with.
 */
export function bindCasterInputs(rt: WebgpuPagesRuntime, feed: CasterFeed) {
  const cut = rt.run.gpuSelection,
    placements = rt.vis.placementGpu,
    worlds = rt.rootWorlds?.worlds
  if (!cut || !placements || !worlds) return false
  const { inputs } = feed
  inputs.visible = feed.list
  inputs.info = cut.info
  inputs.rootWorlds = worlds
  inputs.placements = placements.buffer
  inputs.outputs = placements.outputs
  inputs.pages = feed.pages
  inputs.work = feed.work
  inputs.args = feed.args
  return true
}

/** The decode of the casters in `compute`: the list the candidates closed (`vsmRenderCandidatesDone`)
 *  read as the camera's main pass is, its clusters decoded to `feed.pages`; with `RASTER_PASS_POST`,
 *  the casters behind the list's split (`vsmRenderCandidatesPostDone`), which the descent's post
 *  pass found, as the camera's post pass reads its own. */
export function encodeCasterDecode(
  compute: GPUComputePassEncoder,
  feed: CasterFeed,
  pass: RasterPass = RASTER_PASS_MAIN,
) {
  casterDecode(feed.device).encode(compute, pass, feed.inputs)
}
