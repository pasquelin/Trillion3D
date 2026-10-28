import type {
  CutTotals,
  GpuCut,
  GpuSelection,
  SelectionUniforms,
} from '../../../gpu/core/selection.ts'
import { sameSelectionUniforms } from '../../../gpu/core/selectionCopy.ts'
import type { PageRec } from '../../selection/types.ts'
import type { CutDelta } from './delta.ts'
import { createHeadUnion } from './headUnion.ts'
import { copyRanks, copyRankList, type RankList } from './copyRanks.ts'

/** What the adoption counts of a readback. */
type CutMetrics = CutTotals & {
  /** True when the frame reread the shown list it already held: `desired` and `shown` are those of
   *  the previous frame, at the same ranks. False by default, and false as soon as a doubt exists. */
  cutHeld: boolean
  /** True when this adoption actually rewrote `desired` or `shown`. Adoption does not happen only
   *  at render: a drain replays one after the fact, so every reader of these lists must know they
   *  moved under it, not only that the current frame held them. */
  listsRewritten: boolean
  ready: boolean
  /** True when this adoption took the counts of a readback, adopted or not. */
  counted: boolean
  visible: number
}

/** What the adopter keeps from one readback to the next. */
interface Adopter {
  options: AdopterOptions
  metrics: CutMetrics
  lastCut: GpuCut | undefined
  askedUnion: ReturnType<typeof createHeadUnion>
  drawnUnion: ReturnType<typeof createHeadUnion>
  /** Shown list `shown` and `drawn` are made from, or `null` when they come from elsewhere. */
  shownCut: GpuCut | null
  /** Age of the drawable id sequence: it advances every time a shown list publishes another one,
   *  adopted or not. `shownSeq` is that of the sequence `shown` is actually made from: a shown list
   *  applied then rejected — different uniforms — separates them, and that is
   *  what forbids holding `shown` on a sequence the frame never adopted. */
  drawnSeq: number
  shownSeq: number
}

/** The cut `cut`, its drawn pages `drawablePageIds`, taken as a difference from the last one, or
 *  held when it is the same. */
function applyDeltas(a: Adopter, cut: GpuCut, drawablePageIds: number[]) {
  const { delta, drawnDelta } = a.options
  if (cut === a.lastCut) {
    delta.hold()
    drawnDelta.hold()
    return
  }
  const { pageIds, truncated } = cut.result
  const asked = truncated ? a.askedUnion(pageIds, delta.ids, delta.count) : pageIds,
    drawnIds = truncated
      ? a.drawnUnion(drawablePageIds, drawnDelta.ids, drawnDelta.count)
      : drawablePageIds
  delta.apply(asked, asked.length)
  drawnDelta.apply(drawnIds, drawnIds.length)
  a.lastCut = cut
}

/** The GPU counted the triangles where the verdict is given, as each cluster joins the list of
 *  visible clusters, and shipped them in the shown-list header (`../../dag/shader/totalsWgsl.ts`):
 *  they describe the cut, not the list that reports it, and the CPU sums nothing. They follow
 *  every readback, as `visible` does, also one read under a camera the frame has left: only the
 *  image's own lists wait for a cut of the camera in place, and counts that waited for it stood
 *  still for as long as the camera moved. */
function countCut(metrics: CutMetrics, cut: GpuCut) {
  metrics.ready = true
  metrics.counted = true
  metrics.selectedTriangles = cut.result.selectedTriangles
  metrics.transparentTriangles = cut.result.transparentTriangles
  metrics.frustumRejected = cut.result.frustumRejected
  metrics.lodLevel = cut.result.lodLevel
  metrics.occluded = cut.result.occluded
  metrics.postHidden = cut.result.postHidden
}

/** `shown` is a function of the drawable id sequence alone: a new shown list that republishes
 *  the SAME sequence `shown` is made from yields the same records, at the same ranks, and
 *  `shown` is not remade. The comparison is on the age of the adopted sequence,
 *  not on the last applied difference: a shown list applied then rejected advanced the age
 *  without writing anything. A null `shownCut` means none was made yet. */
function mirrorShown(a: Adopter, cut: GpuCut) {
  const { options } = a
  const held = cut === a.shownCut || (a.shownCut !== null && a.shownSeq === a.drawnSeq)
  if (held) return
  // The difference has just written these records by reading the sequence once; rereading them a
  // second time in the catalogue, at sparse ranks, would yield exactly the same array.
  copyRanks(options.shown, options.drawnPages)
  copyRankList(options.shownPacked, options.drawnDelta.ids, options.drawnDelta.count)
  a.shownCut = cut
  a.shownSeq = a.drawnSeq
}

/** The readback applied: see `createWebgpuCutAdopter`. */
function adoptCut(a: Adopter) {
  const { options, metrics } = a
  metrics.cutHeld = false
  metrics.listsRewritten = false
  metrics.counted = false
  const selection = options.selection(),
    cut = selection?.peek()
  // A list past the readout's cap (`../../dag/lists/listCap.ts`) is read by its head: the
  // requests the GPU ranked first, and the drawn pages it compacted first, plus what the lists
  // held past it (`./headUnion.ts`): the cut's list draws the whole cut, so nothing exits.
  if (!cut?.result.drawablePageIds) return false
  const { desired, delta, drawnDelta } = options
  applyDeltas(a, cut, cut.result.drawablePageIds)
  // The packed ranks of the desired cut, rank by rank beside its records, remade only when the
  // difference moved: a held or unchanged one leaves them as they stand.
  if (delta.changed) copyRankList(options.desiredPacked, delta.ids, delta.count)
  if (drawnDelta.changed) a.drawnSeq++
  // A difference is applied where it is computed, and only when it moved. An image that adopts
  // nothing — no readback has landed — must not replay the previous one, which would count every
  // page twice.
  options.onCutDelta()
  if (drawnDelta.changed) options.onDrawnDelta()
  metrics.listsRewritten = delta.changed || drawnDelta.changed
  // A cut from poses a placement has left since draws and counts as a camera's late cut does —
  // the frame's own list decides the draw —, but no image is held on it: the next readback,
  // cut under the poses in place, may still ask for pages.
  metrics.cutHeld = !metrics.listsRewritten && cut.worldRevision === selection?.worldRevision
  metrics.visible = desired.length
  countCut(metrics, cut)
  if (!sameSelectionUniforms(cut.uniforms, options.uniforms)) return false
  mirrorShown(a, cut)
  return true
}

type AdopterOptions = {
  selection: () => GpuSelection | undefined
  desired: PageRec[]
  /** The packed rank of each desired page, rank by rank, parallel to `desired`. */
  desiredPacked: RankList
  /** What the frame draws and reports as drawn: one list, the copy of the drawable cut. */
  shown: PageRec[]
  /** The packed rank of each shown page, rank by rank. */
  shownPacked: RankList
  uniforms: SelectionUniforms
  delta: CutDelta
  /** The drawable cut as a difference, kept apart because it is not the cut that was asked for. */
  drawnDelta: CutDelta
  /** Records this difference writes: `shown` is a copy of them, when the frame adopts it. */
  drawnPages: readonly PageRec[]
  /** Called once per readback, and only there: the difference is applied exactly once. */
  onCutDelta: () => void
  onDrawnDelta: () => void
}

/**
 * Applies a completed readback without letting it decide the current-frame draw.
 *
 * The readback is taken as a difference: a cut this adopter has already seen enters and leaves no
 * page at all, and a cut that moved names only what moved. `desired` IS that difference's list — one
 * catalogue for one cut, opaque and transparent mixed — so the stages that follow read a set that
 * survived the previous frame, not a rebuilt set.
 */
export function createWebgpuCutAdopter(options: AdopterOptions) {
  const a: Adopter = {
    options,
    metrics: {
      cutHeld: false,
      listsRewritten: false,
      ready: false,
      counted: false,
      visible: 0,
      selectedTriangles: 0,
      transparentTriangles: 0,
      frustumRejected: 0,
      lodLevel: 0,
      occluded: 0,
      postHidden: 0,
    },
    lastCut: undefined,
    askedUnion: createHeadUnion(),
    drawnUnion: createHeadUnion(),
    shownCut: null,
    drawnSeq: 0,
    shownSeq: -1,
  }
  return {
    adopt: () => adoptCut(a),
    metrics: a.metrics,
    /** The readback last applied, whose requests admission ranks; none before the first. */
    get adopted() {
      return a.lastCut
    },
  }
}
