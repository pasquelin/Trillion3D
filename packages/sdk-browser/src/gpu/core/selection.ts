/**
 * The contract every GPU selection kernel honours, and the camera state it reads.
 *
 * The kernel is `gpuDagSelection`: a cluster DAG where each cluster carries its own screen-error
 * band. This module holds what is common to a kernel and its callers — the uniform block and the
 * readback shape — so neither side owns the other; the block's projection is written by
 * `selectionProjection.ts`, the world's cells the cut follows are `worldCells.ts`'s.
 */
import { FRUSTUM_PLANE_VALUES } from '../../../../math/src/geometry/frustum/frustum.ts'
import { pixelScale } from '../../../../math/src/projection/camera.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { writeSelectionPlanes, writeSelectionProjection } from './selectionProjection.ts'
import type { AsideCut } from './aside.ts'
import type { CutPyramid } from '../../geometry/dag/occlusion.ts'
import type { DagRoot } from '../../geometry/dag/types.ts'
import type { CellLink, WorldCells } from '../../geometry/dag/worlds/worldCells.ts'
import type { PoseHost } from '../../geometry/dag/proxy/proxyInstances.ts'
import type { ProxyBoxes } from '../../lighting/bounce/probes/probeSync.ts'
import type { CutTables, ProxyResources } from '../../geometry/dag/cut/cutReaders.ts'
import type { CutListCaps } from '../../geometry/dag/lists/cutListCaps.ts'

/**
 * `perspective` is the projection's clip-w weight (`EngineCamera.perspective`), 1 when absent.
 * `view` and `planes` are those of the render frame — the planes of the render matrix the image
 * draws with, its jitter included (`viewProj`) —, and `cameraWorld` — the eye's world position,
 * ancestors resolved — is its ORIGIN: the camera is at zero in the frame the kernel works in, and
 * this triplet only names that frame for a sample or an oracle. `pixelError` is the threshold the
 * cut reads: the host's pixels per edge, divided by the view's level-of-detail factor and the
 * streaming quality scale (`../../frame/render/gpuCut.ts`).
 */
export type SelectionUniforms = {
  planes: Float32Array
  view: Float32Array
  pixelScale: [number, number]
  pixelError: number
  near: number
  cameraWorld: [number, number, number]
  perspective?: number
  /** The render matrix the image draws with — its jitter included —, from the render frame to clip
   *  space, the projection's clip depth along its clip weight, `z = x · w + y`, and the view's size
   *  in pixels: what a box is projected with to the pixel centres it covers
   *  (`../../geometry/dag/shader/occlusionWgsl.ts`). */
  viewProj: Float32Array
  depthMap: [number, number]
  viewSize: [number, number]
  /** What the occlusion runs (`OCCLUSION_TWO_PASS`); none when absent. */
  occlusion?: number
  /** The culls the host turned off (`CULL_FRUSTUM_OFF`, `CULL_MIN_LOD_OFF`,
   *  `../../geometry/dag/shader/viewsWgsl.ts`); none when absent. */
  cullOff?: number
  /** The previous image's render matrix composed at this image's eye, its depth map and its size:
   *  what the main pass tests the previous pyramid with. Read only under `OCCLUSION_TWO_PASS`. */
  prevViewProj?: Float32Array
  prevDepthMap?: [number, number]
  prevSize?: [number, number]
  /** The host's frame: the clock the rows' closure stamps a row's use with, and, for a cut whose
   *  occlusion runs two passes, its identity — such a cut reads the pyramid of the image before,
   *  and no two images cut on the same one (`../../geometry/dag/swap/swap.ts`). */
  frame?: number
}
/**
 * A resident cut's two lists — the camera's requested pages, the drawn pages — as the ranks the
 * readback in hand claims for them in the list the host adopted last
 * (`../../geometry/dag/differenceChain.ts`): for rank `s`, the rank its page holds there,
 * `NO_INDEX` for a page one of the snapshots since did not hold. Claims, checked against the list
 * held before they are believed.
 */
export type CutClaims = { asked: Uint32Array; drawn: Uint32Array }
/** Each packed page's residency flag as the host's row cache sets it, what the cut reads: at the
 *  pages a change names, every page at a rebuild (`../../geometry/rows/page/pageState.ts`). */
export type PageResidency = { readonly length: number; flag(page: number): number }
/** The cut's requests, one per leaf it keeps and sees, in the order its threads asked them: the
 *  leaf's first packed page, how many pages it names from there — one group's, which may lie in
 *  more than one streaming page —, and its priority, the larger the more urgent (`../../geometry/dag/request/request.ts`). A leaf
 *  several placements share is asked once by each. */
type CutRequests = { pages: number[]; counts: number[]; priorities: number[] }
export type SelectionResult = {
  requests: CutRequests
  /** The packed pages the requests name, request after request: what the host's lists follow. */
  pageIds: number[]
  frustumRejected: number
  lodLevel: number
  drawablePageIds?: number[]
  /** The items — placement tree cells, nodes, clusters — the previous image's pyramid hid, held for
   *  the post pass, and those the post pass's pyramid hid for good
   *  (`../../geometry/dag/shader/occlusionWgsl.ts`). */
  occluded: number
  postHidden: number
  /** Triangle totals HELD BY THE GPU, where the verdict is given: what the cut draws — past its
   *  frustum, its levels and both passes of its occlusion — and its blend share. The CPU sums
   *  none. */
  selectedTriangles: number
  transparentTriangles: number
  /** True when the cut exceeded the sample cap the device can hold: each list is its head, the
   *  frame's mask is whole, and nothing exits on it (`../../geometry/cut/adoption/adoption.ts`). */
  truncated?: boolean
  /** What the cut asked of its lists, the most one pass asked of each: past a cap, it drew what
   *  fit (`../../geometry/dag/lists/listFeedback.ts`). With the drawn list alone. */
  peaks?: CutListCaps
}
/** A readback and its uniforms (`../../geometry/cut/adoption/adoption.ts`). */
export type GpuCut = {
  uniforms: SelectionUniforms
  result: SelectionResult
  /** Pose revision it was cut under: behind the selection's, it streams, counts, holds no image. */
  worldRevision: number
}
/** Pages whose residency flag just changed, in increasing order: a reader handed none visits
 *  every page. */
export type ResidencyChanges = { pages: Int32Array; count: number }
type Visit = (page: number) => void
/** Told `true` when the shared command buffer reached the queue, `false` when the image dropped it. */
export type SelectionSubmission = (submitted: boolean) => void
export type GpuSelection = {
  readonly maskBuffer: GPUBuffer
  /** The u32 word of `maskBuffer` the FRAME mask starts at: bit `p & 31` of word `p >> 5` is packed
   *  page `p`. Read before `encodePost`, it holds the main pass's draws; after it, those of both
   *  passes — what every later reader of the image takes. */
  readonly maskOffset: number
  /** The u32 word of `maskBuffer` the POST mask starts at, laid out as the frame mask: the clusters
   *  the post pass alone draws, in the image whose `encodePost` said there was one. */
  readonly postMaskOffset: number
  /** The pages its roots hold, the ones appended included (`appendRoots`). */
  readonly pageCount: number
  /** The placements its tables are laid out for: `updateWorlds` takes sixteen floats each. */
  readonly worldCapacity: number
  /** The world's chain of HLOD cells, when it packs the world DAG (`../../geometry/dag/worlds/worldFollow.ts`): which
   *  the partition shows, and what draws each now. */
  readonly world?: WorldCells
  /** Where the cut's cold words (`view`) hold the world's HLOD cell states (`CELL_DRAW`), `cells`
   *  per instance from word `base`, and its file words from word `files`
   *  (`../../geometry/dag/worlds/worldLinks.ts`): what a pass beside the descent binds to gate an
   *  item by its file and cell as the descent does (`../../blend/verdict/verdictWgsl.ts`), or every
   *  page by the descent's own gate from the word its placements' links start at, `links`
   *  (`../../geometry/dag/shader/worldGateWgsl.ts`: the shadow casters). `instances` is how many
   *  instances of the world DAG the cut packs: a row of an instance past them has no state word. */
  readonly cellStates?: Readonly<{
    view: GPUTextureView
    base: number
    cells: number
    instances: number
    files: number
    links: number
  }>
  /** Bytes of its host tables, sized by the resident pages: the CPU budget holds them. */
  readonly hostBytes: number
  /** Bytes of its GPU tables, within the cut's share (`../../session/memory/cutTableBytes.ts`). */
  readonly gpuBytes?: number
  readonly worldRevision: number
  /** The cut's frame words, one record table (`../../geometry/dag/frameTable.ts`): what the root boxes pass
   *  writes the stretch into and the tree's leaves read (`../../placement/roots/rootBoxes.ts`). */
  readonly frames: GPUTextureView
  /** The cut's records, one table (`../../geometry/dag/worlds/worldTable.ts`): what the
   *  composition writes and the proxy's rays read (`../../lighting/bounce/runtime/runtimeSceneWgsl.ts`). A new view
   *  once the proxy's copies grow it: read at each use. */
  readonly worlds: GPUTextureView
  /** The poses the host holds: every placement's, as a walk wrote them — any may have moved —,
   *  or, `named` given, those it lists, increasing, the placements a call moved: those alone are
   *  compared and sent. The placements whose pose moved — the words a cut reads, or the exact
   *  translation —, increasing, a view the next call overwrites: what the placement tree follows
   *  (`../../geometry/dag/tree/treeFollow.ts`). Advances `worldRevision` when one moved. */
  updateWorlds(worlds: Float32Array, named?: Int32Array): Int32Array
  /** The poses the last frame drew kept for its views' next main passes, before the frame that
   *  calls it sends one (`../../geometry/dag/previousPoses.ts`). */
  keepPoses(): void
  /** Placement `world` is posed on the GPU by its parent from now on, or no longer
   *  (`../../placement/compose/gpuCompose.ts`): its tree group opens while it is; unlinked, the pose the
   *  host holds is written again over the one its parent composed. */
  composedPlacement(world: number, composed: boolean): void
  /** Whether its cut follows a placement tree (`../../geometry/dag/tree/treeFollow.ts`): what the kernel writing
   *  the tree's leaves is asked for before a frame binds it (`../../placement/roots/rootPasses.ts`). */
  readonly treeFollowed: boolean
  /** The member group of placement `world` in the placement tree, -1 outside it: what a
   *  composition names the groups of the roots a parent moves by. */
  groupOf(world: number): number
  /** The groups `groups` name are fitted again before the next cut: the roots a parent
   *  composes moved with it (`../../geometry/dag/tree/treeFollow.ts`). */
  groupsMoved(groups: ArrayLike<number>): void
  /** The cut's worlds were rewritten on the GPU (`../../placement/compose/gpuCompose.ts`), where no
   *  `updateWorlds` compares them: advances `worldRevision`, and the next dispatch cuts again under
   *  them — the levels, the frustum and the raster split follow the composed poses. `rows` are the
   *  placements whose worlds it wrote: the proxy makes their boxes again and no other. */
  worldsMovedOnGpu(rows: Iterable<number>): void
  /** True while its lists or regions are made again between two frames (`../../geometry/dag/queueGrowth.ts`):
   *  no root is appended meanwhile, and the appending caller asks again at its next frame. */
  readonly growing: boolean
  /** True while no cut may run on its tables (`../../geometry/dag/queueGrowth.ts`, `tablesHeld`): the frames
   *  draw the last cut committed, so no page it may draw leaves the pool meanwhile. */
  readonly cutHeld: boolean
  /** The caps its lists are held to from the next cut on, the session's settings' at each image
   *  (`../../geometry/dag/lists/cutListCaps.ts`): changed, its lists are made again before it cuts. */
  holdLists(caps: CutListCaps): void
  /** `roots` — later placements of primitives it holds — appended behind its own, in the room
   *  its tables kept (`../../geometry/dag/pack/pack.ts`, `appendDagRoots`), cut from the next dispatch on. False
   *  when they do not fit, or while it is `growing`: the caller makes a cut over every root, at a
   *  grown capacity, unless it waits for the growth to end. */
  appendRoots(roots: readonly DagRoot[]): boolean
  /** The row cache now holds `rows` rows: the open counts placements hold follow it
   *  (`../../geometry/dag/queueGrowth.ts`), grown before the next cut. */
  followRows?(rows: number): void
  /** What a program reads the proxy through (`ProxyResources`): none until a placement wears one. */
  proxy(): ProxyResources | undefined
  /** Its tables as a pass beside the cut reads them (`../../geometry/dag/cut/cutReaders.ts`), read again at each
   *  call: a growth lays them out anew. None once released. */
  cutTables(): CutTables | undefined
  /** Bytes the CPU keeps for the proxy (`../../geometry/dag/proxy/proxyInstances.ts`): the streamer's reservation counts them. */
  readonly proxyHostBytes: number
  /** The deformed placements' copies of their meshes' proxies posed by the records of the frame, before the
   *  first program of the image that traces them (`../../geometry/dag/proxy/proxyPose.ts`). */
  proxyPose(encoder: GPUCommandEncoder, host: PoseHost): void
  /** The compiled meshes' proxies arrived: every placement wears what its primitive holds now. */
  proxyArrived(): void
  /** The world boxes of the placements that wear a proxy, the runs of those new or moved since the last
   *  call, and their extent (`../../lighting/bounce/probes/probeSync.ts`). */
  proxyBoxes(): ProxyBoxes
  /** Parks placement `world` — its root enters no descent queue — or takes it back. */
  parkWorld(world: number, parked: boolean): void
  /** Writes placement `world`'s root mark word (`ClusterRoot.mark`, its reach above, `rootMark`). */
  markWorld(world: number, mark: number): void
  /** Placement `world` lies where `link` says now (`CellLink`): it draws while its file shows as
   *  its main cell or its cell draws its placements — a row of a cell's actor, while its cell draws
   *  that actor (`../../geometry/dag/worlds/worldFollow.ts`) —; nothing without a world. */
  placeInCell(world: number, ...link: CellLink): void
  /** Row `row` of the row list `key`, whose root the cut does not hold yet, lies in HLOD 0 cell
   *  `cell` and file `file` of instance `k` — or is a row of `cell`'s actor (`actor`) —, or in none
   *  (`-1`): both count it as not resident meanwhile (`../../geometry/dag/worlds/worldFollow.ts`);
   *  nothing without a world. */
  waitRow(key: object, row: number, cell: number, k: number, file?: number, actor?: boolean): void
  /** Each page whose drawing the world's switch moved since the last call, told to `visit` by its
   *  placement and its rank there: an actor's or a placement's turned to draw or to hide
   *  (`../../geometry/dag/worlds/worldSwitched.ts`); none without a world. */
  switchedPages(visit: (world: number, rank: number) => void): void
  /** True when the cut's residency moved; each page whose readiness did goes to `moved`. */
  updateResidency(resident: PageResidency, changes?: ResidencyChanges, moved?: Visit): boolean
  /** The cut rule's `resident(c)` of `page`, then `resident(childGroup(c))` (`geometry/cut/rule.ts`). */
  isReady(page: number): boolean
  isChildReady(page: number): boolean
  /** The next dispatch cuts again and reads its cut back: what a row the row cache's queue waits
   *  for asks (`../../geometry/rows/rowOrder.ts`). */
  recut(): void
  /** Encodes the selection. Given `shared`, the caller owns the command buffer and calls the
   *  settlement back, `true` once it is queued, `false` if dropped: no readback before `true`. A
   *  cut whose `uniforms.occlusion` runs two passes encodes its main pass alone: its post pass, the
   *  rest of the cut and its readback follow in `encodePost`, which the image encodes into the same
   *  command buffer before it is queued. */
  dispatch(uniforms: SelectionUniforms, shared?: GPUCommandEncoder): SelectionSubmission | undefined
  /** The post pass of the cut `dispatch` encoded last, into `encoder`: after the image's first
   *  raster pass and the pyramid built from its depth (`pyramid`; none once it is released, which
   *  hides nothing), before its second. True when there was one; false when the cut ran in one
   *  pass, its frame mask holding every draw. */
  encodePost(encoder: GPUCommandEncoder, pyramid: CutPyramid | undefined): boolean
  /** The pyramid the next `dispatch`'s main pass reads — the previous image's, whose matrices its
   *  uniforms carry (`OCCLUSION_TWO_PASS`) —, for that dispatch alone; none, a blank one. */
  bindPyramid(pyramid: CutPyramid | undefined): void
  peek(): GpuCut | null
  /** A cut for a view drawn beside the main one, on these tables (`../../geometry/dag/aside.ts`). */
  aside(): AsideCut
  /** The host adopts `cut`, the readback in hand: the ranks it claims in the list the host held,
   *  valid until the next readback lands — none when the host held no GPU list —; the readbacks
   *  after it claim theirs in its lists. Nothing for any other cut. */
  adopt(cut: GpuCut): CutClaims | undefined
  /** True once released: a released selection dispatches and drains nothing more. */
  failed(): boolean
  /** Settled once the readbacks in flight have landed, nothing grown or cut again: the first
   *  step of a drain (`flush`), alone. */
  landed(): Promise<void>
  flush(): Promise<SelectionResult | null>
  dispose(): void
}

/** Uniform block of a cut, allocated once: the frame rewrites it, it does not remake it. */
export function createSelectionUniforms(): SelectionUniforms {
  return {
    planes: new Float32Array(FRUSTUM_PLANE_VALUES),
    view: new Float32Array(16),
    pixelScale: [1, 1],
    pixelError: 0,
    near: 0.1,
    cameraWorld: [0, 0, 0],
    viewProj: new Float32Array(16),
    depthMap: [0, 0],
    viewSize: [1, 1],
  }
}

/** `cam`'s uniform block at `pixelError` over `viewport`, written into `into` — the frame's, kept
 *  from frame to frame —, its projection (`writeSelectionProjection`) under `renderMatrix`. */
export function cameraSelectionUniforms(
  cam: EngineCamera,
  pixelError: number,
  viewport?: [number, number],
  into: SelectionUniforms = createSelectionUniforms(),
  renderMatrix: ArrayLike<number> = cam.viewProjection,
): SelectionUniforms {
  // View and planes are those of the RENDER FRAME (`../../camera/renderOrigin.ts`): the kernel composes
  // `view · world` in single precision on world matrices brought back to `cameraWorld`; the absolute
  // view would mix two frames. Single precision only rounds here, all above is in double. The
  // planes are the render matrix's own, its jitter included (`writeSelectionPlanes`).
  into.view.set(cam.viewRelative)
  pixelScale(into.pixelScale, cam.projection, viewport?.[0], viewport?.[1])
  for (let axis = 0; axis < 3; axis++) into.cameraWorld[axis] = cam.eye[axis]
  into.pixelError = pixelError
  into.near = cam.near
  into.perspective = cam.perspective
  writeSelectionProjection(into, cam, renderMatrix, viewport ?? [1, 1])
  writeSelectionPlanes(into, cam, renderMatrix)
  return into
}
