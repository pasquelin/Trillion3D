import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'
import { createDagResidencyUpload } from './residencyUpload.ts'
import { createDagPoolList } from './poolList.ts'
import { createDagDispatch } from './dispatch.ts'
import { createDifferenceChain } from './differenceChain.ts'
import { createDagRuntimeState, recutMain } from './runtimeState.ts'
import { MASK_SECTION, flagLocation } from './split.ts'
import { createWorldResidencyMirror } from './worldMirror.ts'
import { createAsideCut } from './aside.ts'
import { createTreeFollower } from './treeFollow.ts'
import { createLinkFollower } from './worldFollow.ts'
import {
  appendRoots,
  flushRuntime,
  parkRoot,
  rewritePlacement,
  updateRuntimeResidency,
  updateRuntimeWorlds,
  writeMark,
  type DagResources,
  type DagRun,
} from './runtimeOps.ts'

export function createDagRuntime(
  resources: DagResources,
  /** The pages the pool already holds, when the cut is made beside it (`poolList.ts`). */
  poolHeld?: (page: number) => boolean,
  /** Whether a parent composes placement `w` on the GPU now: its tree group stays open. */
  composed?: (w: number) => boolean,
): GpuSelection {
  const { device, packed } = resources
  const state = createDagRuntimeState()
  const chain = createDifferenceChain()
  const run: DagRun = {
    linkMoved: undefined,
    resources,
    state,
    chain,
    // The cut rule's residency, derived from the pool's and uploaded by difference.
    uploadResidency: createDagResidencyUpload(resources),
    ...createDagDispatch(resources, state, chain),
    poolList: createDagPoolList(device, packed, resources.coldParts, poolHeld),
    // A packed world DAG reads the scene's residency through its mirror (#1332); none packs it
    // before #1333, and the rows' flags go up as they are.
    mirror: packed.world && createWorldResidencyMirror({ ...packed, world: packed.world }),
    tree: createTreeFollower(resources, composed),
    // A link move with no residency behind it goes to the cut's residency as the rows last stood;
    // each move is told to the run's listener (`linkMoved`).
    links: createLinkFollower(resources, {
      updateResidency: (rows, changes) => void updateRuntimeResidency(run, rows, changes),
      linkMoved: (w) => run.linkMoved?.(w),
    }),
    moves: new Int32Array(8),
  }
  return selectionOver(run)
}

/** The camera cut's face (`GpuSelection`) over `run`. */
function selectionOver(run: DagRun): GpuSelection {
  const { resources, state, uploadResidency, poolList, mirror, chain } = run
  const { packed, pageCount, nodeCount, frames, buffers } = resources
  // The draw mask, in the part of `flags` that holds its section whole (`split.ts`): its readers
  // bind one buffer at one offset, whatever the split.
  const mask = flagLocation(resources.split.flagCuts, MASK_SECTION, nodeCount, pageCount)
  const live = () => !state.disposed && !state.dead
  /** The main view, as the steps before a cut know it (`TableSync`). */
  const mainView = {}
  // The one step every cut on these tables takes before it encodes, the main view's and each view
  // aside's: the rows of the root and mark words parked or marked since go up (`flushWords`), the
  // tree fits what moved again, the links that moved go up.
  const syncTables = (uniforms: SelectionUniforms, view: object) => {
    if (!live()) return
    frames.flushWords()
    run.tree?.sync()
    run.links?.sync(uniforms, view)
  }
  const selection: GpuSelection = {
    get hostBytes() {
      const pool = poolList.entries.byteLength
      return frames.originBytes + uploadResidency.hostBytes + pool + (mirror?.hostBytes ?? 0)
    },
    maskBuffer: resources.flagParts[mask.part],
    maskOffset: mask.word,
    get pageCount() {
      return packed.live?.pages ?? pageCount
    },
    worldCapacity: packed.worldCount,
    worldRanges: frames.ranges.map((range, r) => ({ ...range, buffer: frames.worldBuffers[r] })),
    packsWorld: !!mirror,
    get worldRevision() {
      return state.worldRevision
    },
    updateWorlds: (next, named) => updateRuntimeWorlds(run, next, named),
    composedPlacement(w, composed) {
      if (!composed && live()) rewritePlacement(run, w)
      run.tree?.touch(w)
    },
    placeObject: (w, object) => run.links?.place(w, object),
    get linkMoved() {
      return run.linkMoved
    },
    set linkMoved(listener) {
      run.linkMoved = listener
    },
    worldStandsIn: (w) => !!run.links?.standsIn(w),
    worldsMovedOnGpu() {
      if (live()) state.worldRevision++
    },
    get growing() {
      return state.growing
    },
    get coarsen() {
      return state.coarsen
    },
    appendRoots: (roots) => appendRoots(run, roots),
    // The root travels behind the stretch in the frame buffer (`resources.ts`).
    parkWorld: (w, parked) => live() && parkRoot(run, w, parked),
    // The mark travels behind the record shift (`primitiveFrameWords`).
    markWorld: (w, mark) => live() && writeMark(run, w, mark),
    updateResidency: (next, changes, moved) => updateRuntimeResidency(run, next, changes, moved),
    isReady: (page) => uploadResidency.isReady(page),
    isChildReady: (page) => uploadResidency.isChildReady(page),
    notePool(page, held) {
      // The next dispatch cuts and reads back again, the eviction queue with it: the cut in hand
      // stays.
      if (live() && poolList.note(page, held)) recutMain(resources.swap, state)
    },
    dispatch(next, shared) {
      syncTables(next, mainView)
      return run.dispatch(next, shared)
    },
    peek: () => (state.dead ? null : state.last),
    aside: () => createAsideCut(resources, state, { copyOwed: run.copyOwed, syncTables }),
    adopt: (cut) => (!state.dead && cut === state.last ? chain.adopt() : undefined),
    failed: () => state.dead,
    flush: () => flushRuntime(run, selection),
    dispose() {
      state.disposed = true
      state.dead = true
      state.pending = state.pending.catch(() => {})
      for (const buffer of buffers) buffer.destroy()
    },
  }
  return selection
}
