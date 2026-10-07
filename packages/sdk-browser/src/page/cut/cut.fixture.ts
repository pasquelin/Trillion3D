import { frustumExcludesBox, maxStretch, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts'
import { drawsCard, selectFlat } from './select.fixture.ts'
import { openMark } from './openRoot.fixture.ts'
import { worldStretch } from './logic.ts'
import { selectionScratch, selectionState, type PageRecord } from './state.fixture.ts'
import type { SelectionResult } from './result.ts'
import { IDENTITY_WORLD, copyElements } from '../../math/matrixElements.ts'
import type { ClusterRoot } from '../selection/types.ts'
import { pixelScaleOf } from '../../streaming/priority.ts'
import type { EngineCamera } from '../../camera/world.ts'
import type { HeldResidency } from './held.fixture.ts'

/**
 * World pose of a root copied into an owned buffer, once per root: the base product
 * only reads and writes `Float64Array`s (`packages/sdk-core/src/math/matrix/matrix4.ts`), and host-library matrices are ordinary
 * arrays.
 */
const rootWorld = new Float64Array(16)

/** Select the requested LOD cut and the resident cut that can be displayed this frame. */
export function selectVisiblePages<T extends PageRecord>(
  roots: ReadonlyArray<ClusterRoot<T>>,
  cam: EngineCamera,
  options: {
    pixelError?: number
    viewport?: [number, number]
    /** The pool's residency, when the cut holds it: its rule and the rule's readiness of the
     *  roots, moved by the pool's residency feed (`./held.fixture.ts`). Absent, every page is resident. */
    held?: HeldResidency
    wanted?: T[]
    result?: SelectionResult<T>
  },
  into?: T[],
): SelectionResult<T> {
  const viewport = options.viewport,
    held = options.held
  const { viewMatrix } = selectionScratch
  // World frustum planes are those image entry set, in the host's depth convention: an image
  // computes them once, for all of its consumers, and nothing is copied here.
  const worldPlanes = cam.planes
  pixelScaleOf(cam.projection, viewport, selectionScratch.pixelScale)
  const result = options.result ?? createSelectionResult<T>()
  const shown = into ?? ([] as T[])
  const wanted = options.wanted ?? ([] as T[])
  // The packed lists are the result's own, parallel to the records, written by the same `keep`
  // (rank by rank), which widens them as the cut emits (`./take.fixture.ts`): they follow what the view
  // selects, never the instances the roots could name (#1232). Their end is the two record
  // counts, so a reader walks `shownPacked[0 .. shown.length)` and no stale tail is ever read.
  // Cut state is set on the reused object: a render image allocates nothing here.
  const state = selectionState<T>()
  state.cam = cam
  state.wanted = wanted
  state.shown = shown
  state.wantedPacked = result.wantedPacked
  state.shownPacked = result.shownPacked
  state.held = held
  state.pixelError = options.pixelError ?? 0
  state.cameraStretch = maxStretch(cam.view)
  state.flatWorld = roots[0]?.world ?? IDENTITY_WORLD
  state.flatElements = (roots[0]?.world ?? IDENTITY_WORLD).elements
  state.flatStretch = 1
  state.flatFocal = 1
  state.flatExact = false
  state.flatSound = false
  state.flatBase = -1
  state.shownCount = 0
  state.wantedCount = 0
  state.wantedTriangles = 0
  state.shownTriangles = 0
  state.uncoveredTriangles = 0
  state.frustumRejected = 0
  state.nodesTested = 0
  state.lodLevel = 0
  state.complete = true
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank]
    // A parked instance-buffer row places nothing: its root waits in the tables, untested. The cut
    // takes no root its impostor card draws.
    if (root.parked || drawsCard(root.mark)) continue
    const box = root.worldBox,
      // A deformation's reach, in the world: its units stretched by the root's placement (#357).
      g = root.reach ? root.reach * worldStretch(root) : 0
    if (
      box &&
      !openMark(root.mark) &&
      frustumExcludesBox(
        worldPlanes,
        box[0] - g,
        box[1] - g,
        box[2] - g,
        box[3] + g,
        box[4] + g,
        box[5] + g,
      )
    ) {
      state.frustumRejected++
      continue
    }
    copyElements(rootWorld, root.world.elements)
    multiplyMatrix4(viewMatrix, cam.view, rootWorld)
    selectFlat(state, root)
  }
  // The cut is finished: the record lists take their length here, and only once. The packed lists
  // keep their buffer whole — the records are their count, rank by rank, and a reader walks them
  // together —, so neither the records nor the packed ranks lose their capacity from one image to
  // the next.
  shown.length = state.shownCount
  wanted.length = state.wantedCount
  result.shownPacked = state.shownPacked
  result.wantedPacked = state.wantedPacked
  // Both sums are held as a running total: no more sweep of the records after the cut.
  const displayedTriangles = state.shownTriangles
  let selectedTriangles = state.wantedTriangles
  if (!wanted.length) selectedTriangles = displayedTriangles
  // The result is written into the caller's object when it supplies one: nothing is allocated.
  result.shown = shown
  result.wanted = wanted
  result.visible = wanted.length || shown.length
  result.selectedTriangles = selectedTriangles
  result.displayedTriangles = displayedTriangles
  result.frustumRejected = state.frustumRejected
  result.nodesTested = state.nodesTested
  result.lodLevel = state.lodLevel
  result.complete = state.complete
  result.uncoveredTriangles = state.uncoveredTriangles
  result.pixelError = state.pixelError
  // An image's cut lets go of the readiness of the roots no cut saw since the previous one.
  held?.endImage()
  // The reused state keeps no hold on this image's scene.
  state.held = undefined
  state.flatHeld = undefined
  return result
}

/** An empty cut result, to set once per hot caller then reuse from image to image:
 *  `selectVisiblePages` rewrites every field, only the object's identity matters. */
export function createSelectionResult<T>(): SelectionResult<T> {
  return {
    shown: [],
    wanted: [],
    shownPacked: new Int32Array(0),
    wantedPacked: new Int32Array(0),
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    uncoveredTriangles: 0,
    pixelError: 0,
  }
}
