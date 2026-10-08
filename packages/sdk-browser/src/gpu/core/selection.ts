/**
 * The contract every GPU selection kernel honours, and the camera state it reads.
 *
 * The kernel is `gpuDagSelection`: a cluster DAG where each cluster carries its own
 * screen-error band. This module holds what is common to a kernel and its callers — the uniform
 * block, the readback shape and the page-cone convention — so neither side owns the other.
 */
import { FRUSTUM_PLANE_VALUES, maxStretch } from '../../../../sdk-core/src/index.ts'
import { pixelScale as writePixelScale } from '../../../../math/src/projection/camera.ts'
import type { CameraMotion, EngineCamera } from '../../camera/world.ts'
import { aheadViewOf, holdAheadView, type AheadView } from './aheadView.ts'
import type { AsideCut } from './aside.ts'
import type { DagRoot } from '../dag/types.ts'

/** A step a cut takes on the tables before it encodes, under its uniforms, for its view — the
 *  main one or one aside (`../dag/swap.ts`) — (`GpuSelection.beforeCut`). */
export type TableSync = (uniforms: SelectionUniforms, view: number) => void

export const SELECTION_NONE = 0xffffffff,
  SELECTION_WORKGROUP = 64

/**
 * `cameraStretch` is the camera half of the cut's object-to-view stretch, `perspective` the
 * projection's clip-w weight (`EngineCamera.perspective`), 1 when absent. `view` and `planes` are
 * those of the render frame, and `cameraWorld` — the eye's world position, ancestors resolved — is
 * its ORIGIN: the camera is at zero in the frame the kernel works in, and this triplet only names
 * that frame for a sample or an oracle.
 */
export type SelectionUniforms = {
  planes: Float32Array
  view: Float32Array
  pixelScale: [number, number]
  pixelError: number
  near: number
  cameraWorld: [number, number, number]
  cameraStretch?: number
  perspective?: number
  /** The view ahead of a moving camera (`./aheadView.ts`); absent or null for a still one. */
  ahead?: AheadView | null
  /** The pool cannot hold the whole cut: the camera's requests rank by admission, the minimum
   *  capacity's pages then the coarsest level first (`../dag/request.ts`). */
  admitByLevel?: boolean
}
/**
 * A resident cut's two lists — the camera's requests, the drawn pages — as the ranks the readback
 * in hand claims for them in the GPU list the host adopted last (`../dag/differenceChain.ts`): for
 * rank `s`, the rank its page holds there, `SELECTION_NONE` for a page one of the snapshots since
 * did not hold. Claims, checked against the list held before they are believed.
 */
export type CutClaims = { asked: Uint32Array; drawn: Uint32Array }
export type SelectionResult = {
  pageIds: number[]
  /** Requests of the view ahead, ranked as `pageIds` and after all of them (`../dag/request.ts`). */
  aheadPageIds?: number[]
  frustumRejected: number
  lodLevel: number
  drawablePageIds?: number[]
  /** A resident cut's eviction queue (`../dag/evict.ts`): canonical pages, first evicted first. */
  evictPageIds?: number[]
  /** The camera's requests counted by admission bucket (`../dag/readoutWords.ts`,
   *  `levelCountsWord`): where each level of a list ranked by admission starts. */
  levelCounts?: Uint32Array
  /** Triangle totals HELD BY THE GPU, where the verdict is given: what the cut rule draws — one
   *  counter, read as `selected` and `drawn` — and its blend share. The CPU sums none. */
  selectedTriangles: number
  drawnTriangles: number
  transparentTriangles: number
  /** True when the cut exceeded the sample cap the device can hold: each list is its head, the
   *  frame's mask is whole, and nothing exits on it (`../../webgpu/cut/adoption.ts`). */
  truncated?: boolean
}
/** A readback and its uniforms (`../../webgpu/cut/adoption.ts`). */
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
  readonly maskOffset: number // index in u32 words of the current-frame drawable page mask
  /** The pages its roots hold, the ones appended included (`appendRoots`). */
  readonly pageCount: number
  /** The placements its tables are laid out for: `updateWorlds` takes sixteen floats each. */
  readonly worldCapacity: number
  /** It packs the world DAG (#1333), whose residency it mirrors (`../dag/worldMirror.ts`, #1332). */
  readonly packsWorld?: boolean
  /** Bytes of its host tables, sized by the resident pages: the CPU budget holds them. */
  readonly hostBytes: number
  readonly worldRevision: number
  /** The buffers of the cut's worlds, one per range of primitives (`../dag/frameRanges.ts`): what
   *  a GPU composition of the poses writes (`../../placement/gpuCompose.ts`). */
  readonly worldRanges: readonly { first: number; count: number; buffer: GPUBuffer }[]
  /** The poses the host holds: every placement's, as a walk wrote them — any may have moved —,
   *  or, `named` given, those it lists, increasing, the placements a call moved, named first
   *  (`placementMoved`): those alone are compared and sent. Advances `worldRevision` when one
   *  moved. */
  updateWorlds(worlds: Float32Array, named?: Int32Array): boolean
  /** Placement `world`'s pose was just written by a call that names it (`moveRootRows`): its
   *  tree group alone is fitted again (`../dag/treeFollow.ts`); absent without a tree. */
  placementMoved?(world: number): void
  /** Placement `world` is posed on the GPU by its parent from now on, or no longer
   *  (`../../placement/gpuCompose.ts`): its tree group opens while it is; unlinked, the pose the
   *  host holds is written again over the one its parent composed. */
  composedPlacement?(world: number, composed: boolean): void
  /** The cut's worlds were rewritten on the GPU (`../../placement/gpuCompose.ts`), where no
   *  `updateWorlds` compares them: advances `worldRevision`, and the next dispatch cuts again under
   *  them — the levels, the frustum and the raster split follow the composed poses. */
  worldsMovedOnGpu(): void
  /** True while its list or its regions grow between two frames (`../dag/listCap.ts`): no root
   *  is appended meanwhile, and the appending caller asks again at its next frame. */
  readonly growing: boolean
  /** `roots` — later placements of primitives it holds — appended behind its own, in the room
   *  its tables kept (`../dag/pack.ts`, `appendDagRoots`), cut from the next dispatch on. False
   *  when they do not fit, or while it is `growing`: the caller makes a cut over every root, at a
   *  grown capacity, unless it waits for the growth to end. */
  appendRoots(roots: readonly DagRoot[]): boolean
  /** Parks placement `world` — its root enters no descent queue — or takes it back. */
  parkWorld(world: number, parked: boolean): void
  /** Writes placement `world`'s root mark word (`ClusterRoot.mark`, its reach above, `markReach`). */
  markWorld(world: number, mark: number): void
  /** Placement `world` places `object` of the world DAG now, or none (`-1`): the world stands in
   *  for it where its object's group suffices (`../dag/worldFollow.ts`); absent without a world. */
  placeObject?(world: number, object: number): void
  /** Whether placement `world` is linked to an object of the world DAG, whose super-roots stand in
   *  for it far away (`../dag/worldFollow.ts`); absent without a world. */
  worldStandsIn?(world: number): boolean
  /** Told of each placement whose link to the world DAG moved (`placeObject`). */
  linkMoved?: (world: number) => void
  /** True when the cut's residency moved; each page whose readiness did goes to `moved`. */
  updateResidency(resident: Uint32Array, changes?: ResidencyChanges, moved?: Visit): boolean
  /** The cut rule's `resident(c)` of `page`, then `resident(childGroup(c))` (`page/cut/rule.ts`). */
  isReady(page: number): boolean
  isChildReady(page: number): boolean
  /** Each page the pool takes or gives back: the eviction queue lists what it holds. */
  notePool(page: number, held: boolean): void
  /** Registers `step`, which every cut on these tables runs before it encodes — the main view's
   *  and each view aside's (`../dag/aside.ts`) —: what moved since the last cut written to the
   *  tables it reads (`../dag/treeFollow.ts`, `../dag/worldFollow.ts`). */
  beforeCut(step: TableSync): void
  /** Encodes the selection. Given `shared`, the caller owns the command buffer and calls the
   *  settlement back, `true` once it is queued, `false` if dropped: no readback before `true`. */
  dispatch(uniforms: SelectionUniforms, shared?: GPUCommandEncoder): SelectionSubmission | undefined
  peek(): GpuCut | null
  /** A cut for a view drawn beside the main one, on these tables (`../dag/aside.ts`). */
  aside(): AsideCut
  /** The host adopts `cut`, the readback in hand: the ranks it claims in the list the host held,
   *  valid until the next readback lands — none when the host held no GPU list —; the readbacks
   *  after it claim theirs in its lists. Nothing for any other cut. */
  adopt(cut: GpuCut): CutClaims | undefined
  /** True once released: a released selection dispatches and drains nothing more. */
  failed(): boolean
  flush(): Promise<SelectionResult | null>
  dispose(): void
}

const planeScratch = new Float32Array(FRUSTUM_PLANE_VALUES),
  viewScratch = new Float32Array(16)

/** Uniform block of a cut, allocated once: the frame rewrites it, it does not remake it. */
export function createSelectionUniforms(): SelectionUniforms {
  return {
    planes: new Float32Array(FRUSTUM_PLANE_VALUES),
    view: new Float32Array(16),
    pixelScale: [1, 1],
    pixelError: 0,
    near: 0.1,
    cameraWorld: [0, 0, 0],
  }
}

export function cameraSelectionUniforms(
  cam: EngineCamera,
  pixelError: number,
  viewport?: [number, number],
  into?: SelectionUniforms,
  /** The camera's motion: given, a moving camera also sends its view ahead. */
  motion?: CameraMotion,
): SelectionUniforms {
  const planes = into?.planes ?? planeScratch
  const view = into?.view ?? viewScratch
  // View and planes are those of the RENDER FRAME (`../../camera/renderOrigin.ts`): the kernel composes
  // `view · world` in single precision on world matrices brought back to `cameraWorld`; the absolute
  // view would mix two frames. Single precision only rounds here: everything above is in double.
  planes.set(cam.planesRelative)
  view.set(cam.viewRelative)
  const pixelScale = writePixelScale(
    into?.pixelScale ?? ([1, 1] as [number, number]),
    cam.projection,
    viewport?.[0],
    viewport?.[1],
  )
  const cameraWorld: [number, number, number] = into?.cameraWorld ?? [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) cameraWorld[axis] = cam.eye[axis]
  // Times each primitive's own stretch, as `selectVisiblePages`; the render frame keeps its bits.
  const cameraStretch = maxStretch(cam.viewRelative)
  if (into) {
    into.pixelError = pixelError
    into.near = cam.near
    into.cameraWorld = cameraWorld
    into.cameraStretch = cameraStretch
    into.perspective = cam.perspective
    holdAheadView(into, cam, motion)
    return into
  }
  return {
    planes: planes.slice(),
    view: view.slice(),
    pixelScale: [pixelScale[0], pixelScale[1]],
    pixelError,
    near: cam.near,
    cameraWorld: [cameraWorld[0], cameraWorld[1], cameraWorld[2]],
    cameraStretch,
    perspective: cam.perspective,
    ahead: motion ? aheadViewOf(cam, motion) : null,
  }
}
