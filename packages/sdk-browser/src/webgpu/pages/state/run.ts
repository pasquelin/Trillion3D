import type { CameraMotion, HostCamera } from '../../../camera/world.ts'
import type { DiagnosticMode } from '../../../../../sdk-core/src/index.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import type { GpuSelection, SelectionUniforms } from '../../../gpu/core/selection.ts'
import type { AsideCut } from '../../../gpu/core/aside.ts'
import type { FrameGateCore } from '../../../frame/gateCore.ts'
import type { WebgpuBudgetState } from '../../residency/budgetState.ts'
import type { MovedWorlds } from '../render/movedWorlds.ts'

export { createWebgpuRunState } from './runState.ts'

/** What the current image decided and counted: the cut, the coverage budget, the metrics the host
 *  reads, and the occlusion history the next image inherits. */
export interface WebgpuRunState extends WebgpuBudgetState {
  /** The clear colour every pass reads, `0xrrggbb`; set in place by `io/clearColor.ts`. */
  clearColor: number
  lost: boolean
  /** Why the device was lost, `reason: message`, the device's own cause added when it came after
   *  (`io/lost.ts`); absent while it holds and after a dispose, which gives no cause. */
  lostCause?: string
  overBudget: boolean
  visible: number
  selectedTriangles: number
  submittedTriangles: number
  frustumRejected: number
  lodLevel: number
  frame: number
  imageRevision: number
  diagnostic: DiagnosticMode
  diagnosticPixelError: number
  lastCamera: HostCamera | undefined
  gpuSelection: GpuSelection | undefined
  /** Hi-Z pyramid built this submission: the transparent test never strips another image's. */
  hizPyramidFresh: boolean
  gpuMetricsReady: boolean
  deferredDrops: Set<string>
  /** Triangles of the transparent clusters the cut holds, counted once whatever the pass count. */
  blendPagedTriangles: number
  /** Triangles of the transparent meshes outside the cluster DAG, counted per draw. */
  blendUnpagedTriangles: number
  blendSubmittedTriangles: number
  blendDrawCalls: number
  /** Cut triangles the current image puts back to draw: the published cut minus clusters without a
   *  residency row. Counted without waiting for the GPU, held from one image to the next like the cut. */
  drawnTriangles: number
  blendFrustumRejected: number
  gpuDrawCalls: number
  /** Compute dispatches of the image: the opaque raster is not a draw call. */
  gpuComputeDispatches: number
  lastProgressMs: number
  renderPathLogged: boolean
  outputDiagnosticLogged: boolean
  noOccluderHistory: boolean
  /** The view moved since the last image: every row may leave the occluders again. */
  occluderViewMoved: boolean
  rowsSyncedFrame: number
  motion: CameraMotion
  /** The drawn view's cut uniforms: each view writes its own (`./view.ts`). */
  selectionUniforms: SelectionUniforms
  /** A view drawn beside the main one cuts there (`../../../gpu/dag/aside.ts`), from its first
   *  image; the main view has none. */
  asideCut: AsideCut | undefined
  shown: PageRec[]
  /** The packed rank of each shown page, rank by rank: one record serves many placements. */
  shownPacked: number[]
  desired: PageRec[]
  /** The packed rank of each desired page, rank by rank. */
  desiredPacked: number[]
  drawn: PageRec[]
  /** The packed rank of each drawn page, rank by rank: what a per-instance reader of `drawn` reads. */
  drawnPacked: number[]
  /** True when `drawn` copies `shown` as-is; written only by the copies in `../helpers.ts`. */
  drawnMirrorsShown: boolean
  /** Pages the residency path had to touch this image; null before a GPU cut reported one. */
  pagesEntered: number | null
  pagesExited: number | null
  // Reused every image; the cut changes, the arrays behind it do not.
  pendingScratch: string[]
  /** Records whose bytes are still awaited, refilled before each pending-address walk. */
  awaitedScratch: PageRec[]
  /** Array of the list returned to the host, for it alone: render tracking writes into the other, and
   *  a list held from one image to the next would not survive that sharing. */
  hostPendingScratch: string[]
  urlScratch: string[]
  /** True when adoption reread the sample already held: `desired` and `shown` have not moved. */
  cutHeld: boolean
  /** Age of the cut's lists: rises as soon as an adoption rewrites them, rendered or not. What a
   *  keeper of a list from one image to the next reads. */
  cutEpoch: number
  /** Rises every time a page receives or loses its bytes: what the waited-for list reads. */
  pageArrayEpoch: number
  /** What each list returned to the host describes: the state that produced it, or `-1` if it is to
   *  be remade. A list is kept only if everything it depends on is still that one. */
  pendingHeld: { epoch: number; cut: number; limited: boolean; ready: boolean }
  urlsHeld: { epoch: number; cut: number; limited: boolean }
  ranksHeld: { epoch: number; cut: number; limited: boolean }
  /** Image entry: revisions, view origin, reread of the source graph, walk of world matrices and
   *  held-image witness. See `../../../frame/gateCore.ts`. */
  gate: FrameGateCore
  /** True when the current image was held and nothing more will be drawn unasked: no CPU step
   *  was executed, and no device answer in flight asks another — targets refused included. */
  frameHeld: boolean
  /** A barrier converges the textures: every pixel publishes its image feedback. */
  textureConverging: boolean
  /** A pass of the image — opaque or blend — wrote the feedback target: something to reduce. */
  feedbackWritten: boolean
  /** Revision whose matrices are carried to the GPU and to transparent items. */
  worldUploadRevision: number
  /** Origin of the render frame of matrices carried to the GPU: the eye of that image. A moving
   *  camera voids it as a scene change voids the revision. */
  worldUploadOrigin: Float64Array
  /** The placements whose world a call wrote since the last upload (`../render/movedWorlds.ts`). */
  movedWorlds: MovedWorlds
  /** Ordered signature of the tested half: two images that share it share their occluders, therefore
   *  the partition the next one inherits. */
  occluderSignature: number
}
