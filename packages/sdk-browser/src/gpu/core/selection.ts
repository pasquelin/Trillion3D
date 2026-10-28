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
import type { RecordTexture } from './recordTexture.ts'
import type { CutPyramid } from '../../geometry/dag/occlusion.ts'
import type { DagRoot } from '../../geometry/dag/types.ts'
import type { DrawDistance, RootParent } from '../../geometry/selection/types.ts'
import type { CellLink, WorldCells } from '../../geometry/dag/worlds/worldCells.ts'
import type { PlacementBoxes } from '../../geometry/dag/placement/placementBoxes.ts'
import type { CutTables } from '../../geometry/dag/cut/cutReaders.ts'
import type { CutListCaps } from '../../geometry/dag/lists/cutListCaps.ts'
import type { SelectionUniforms } from './selectionUniforms.ts'

export type { SelectionUniforms }

/** Each packed page's residency flag as the host's cluster residency sets it, what the cut reads: at
 *  the pages a change names, every page at a rebuild (`../../geometry/clusters/pageState.ts`). */
export type PageResidency = { readonly length: number; flag(page: number): number }
/** The cut's requests, one per leaf it keeps and sees, in the order its threads asked them: the
 *  leaf's first packed page, how many pages it names from there — one group's, which may lie in
 *  more than one streaming page —, and its priority, the larger the more urgent (`../../geometry/dag/request/request.ts`). A leaf
 *  several placements share is asked once by each. */
type CutRequests = { pages: number[]; counts: number[]; priorities: number[] }
export type SelectionResult = {
  requests: CutRequests
  /** The packed pages the requests name, in increasing order: what the host's lists follow. */
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
  peaks?: CutListCaps & { level: number }
}
/** The totals a cut's readback gives the image's metrics: counted by the GPU where the verdict is given. */
export type CutTotals = Pick<
  SelectionResult,
  | 'selectedTriangles'
  | 'transparentTriangles'
  | 'frustumRejected'
  | 'lodLevel'
  | 'occluded'
  | 'postHidden'
>

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
  /** The cut's `work`, which holds the masks of the BLENDED clusters it draws, a bit a packed page
   *  (`../../geometry/dag/shader/blendMaskWgsl.ts`): the blended pass reads them where
   *  they lie. The clusters the visibility rasters draw are `visible`. */
  readonly maskBuffer: GPUBuffer
  /** The u32 word of `maskBuffer` the FRAME mask starts at: bit `p & 31` of word `p >> 5` is packed
   *  page `p`, a blended cluster both passes of the cut draw. */
  readonly maskOffset: number
  /** The u32 word of `maskBuffer` the POST mask starts at, laid out as the frame mask: the blended
   *  clusters the post pass alone draws, in the image whose `encodePost` said there was one. */
  readonly postMaskOffset: number
  /** The list of visible clusters the cut writes (`../../geometry/dag/visible/layout.ts`), the one
   *  buffer the decode, the bins and the rasters read of it: its counts in its header, its records
   *  behind. */
  readonly visible: GPUBuffer
  /** The records `visible` holds room for, followed as the cut's demand moves it
   *  (`../../geometry/dag/visible/visibleGrowth.ts`). */
  readonly visibleCap: number
  /** The cluster records the cut reads (`../../geometry/dag/info/clusterInfoLayout.ts`), one for each
   *  page of each distinct page array its packing holds, and the longest edge of each cluster, one
   *  float a record, zero until measured (`../../geometry/dag/info/measureWgsl.ts`): the host writes
   *  the first as pages land (`../../geometry/clusters/clusterResidency.ts`), the GPU the second. */
  readonly info: GPUBuffer
  readonly edges: GPUBuffer
  /** What a packed page's index adds to reach its cluster record, by placement (`PackedDag.infoShift`). */
  readonly infoShift: Uint32Array
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
   *  composition writes and the ray query reads (`../../lighting/rays/rayQueryWgsl.ts`). A new view
   *  once the proxy's copies grow it: read at each use. */
  readonly worlds: GPUTextureView
  /** The poses the previous image drew (`../../geometry/dag/previousPoses.ts`, the worlds' layout): what
   *  the shadow raster's first occlusion cull tests a caster at. A new view once the table grows: read at
   *  each use. */
  readonly previous: GPUTextureView
  /** The poses the host holds: every placement's, as a walk wrote them — any may have moved —,
   *  or, `named` given, those it lists, increasing, the placements a call moved: those alone are
   *  compared and sent. The placements whose pose moved — the words a cut reads, or the exact
   *  translation —, increasing, a view the next call overwrites: what the placement tree follows
   *  (`../../geometry/dag/tree/treeFollow.ts`). Advances `worldRevision` when one moved. */
  updateWorlds(worlds: Float32Array, named?: Int32Array): Int32Array
  /** The poses the last drawn frame drew kept for its views' next main passes and velocities, before
   *  the frame that calls it sends one (`../../geometry/dag/previousPoses.ts`). */
  keepPoses(): void
  /** A view of this frame is drawn at the poses the worlds hold: the next frame keeps them. */
  posesDrawn(): void
  /** Whether a pose moved since the kept poses were copied. */
  readonly posesMoving: boolean
  /** The kept poses' table and the placements it holds (`../../geometry/dag/previousPoses.ts`). */
  readonly poses: { readonly table: RecordTexture; readonly count: number }
  /** The poses `older`, the cut this one replaces, kept of the placements both hold, taken as this
   *  cut's: the velocity measures from the poses the last drawn frame drew across the swap. */
  keepPosesOf(older: GpuSelection): void
  /** Placement `world` is posed on the GPU by its parent from now on, or no longer
   *  (`../../placement/compose/gpuCompose.ts`): its tree group opens while it is; unlinked, the pose the
   *  host holds is written again over the one its parent composed. */
  composedPlacement(world: number, composed: boolean): void
  /** Whether its cut follows a placement tree (`../../geometry/dag/tree/treeFollow.ts`): what the kernel writing
   *  the tree's leaves is asked for before a frame binds it (`../../placement/roots/rootPasses.ts`). */
  readonly treeFollowed: boolean
  /** Whether the leaves of that tree hold the balls of the groups above instances' roots, its
   *  packing naming some when the cut was made: which kernel of the leaves is asked for. */
  readonly treeParented: boolean
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
  /** Its tables as a pass beside the cut reads them (`../../geometry/dag/cut/cutReaders.ts`), read again at each
   *  call: a growth lays them out anew. None once released. */
  cutTables(): CutTables | undefined
  /** Bytes the CPU keeps for the placements' boxes (`placementBoxes`): the streamer's reservation counts them. */
  readonly placementBoxesBytes: number
  /** The world boxes of the placements, the runs of those new or moved since the last call, and their extent
   *  (`../../geometry/dag/placement/placementBoxes.ts`, followed by `../../lighting/bounce/probes/probeSync.ts`). */
  placementBoxes(): PlacementBoxes
  /** Parks placement `world` — its root enters no descent queue — or takes it back. */
  parkWorld(world: number, parked: boolean): void
  /** Writes placement `world`'s root mark word (`ClusterRoot.mark`, its reach above, `rootMark`). */
  markWorld(world: number, mark: number): void
  /** Placement `world` is drawn at `distance` from now on, at every distance when none
   *  (`ClusterRoot.drawDistance`). */
  drawDistanceWorld(world: number, distance: DrawDistance | undefined): void
  /** Placement `world` is an instance of an assembly whose root's group is `parent` from now on,
   *  none when it is no instance (`ClusterRoot.rootParent`). False when the cut cannot take the
   *  group — the leaves of its placement tree hold no ball, its packing having named none
   *  (`geometry/dag/pack/packParents.ts`, `takesParents`), or the group is new and its node table
   *  has no room for the node that holds it: the placement opens whatever the group says until a
   *  cut that can is made (`placement/growth/grownCutStart.ts`). */
  rootParentWorld(world: number, parent: RootParent | undefined): boolean
  /** Whether a placement the cut holds names a draw distance: the casters and the rays take the
   *  draw distances only then. */
  readonly drawDistances: boolean
  /** The bits of a view's filter (`SelectionUniforms.filter`) held in the cut's `work`, where its
   *  kernels and the sun's casters read them: the buffer and the word they start at, or none for
   *  a view that filters none (`../../geometry/dag/viewFilterRegion.ts`). */
  holdFilter(bits: Uint32Array | undefined): { buffer: GPUBuffer; base: number } | undefined
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
  /** The next dispatch reads its cut back: the main view's readback in hand stands on no residency
   *  any more. */
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
  /** A cut for a view drawn beside the main one, on these tables (`../../geometry/dag/aside.ts`);
   *  `primed`, the primed pyramid's, which feeds no streaming. */
  aside(primed?: boolean): AsideCut
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
    clipPlane: [0, 0, 0, 0],
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
