import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'
import { createDagResidencyUpload } from './residencyUpload.ts'
import { createDagPoolList } from './poolList.ts'
import { createDagDispatch } from './dispatch.ts'
import { followRows, growthAsked } from './queueGrowth.ts'
import { createDifferenceChain } from './differenceChain.ts'
import { createDagRuntimeState, recutMain } from './runtimeState.ts'
import { coarsenTick } from './coarsening.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { createWorldResidencyMirror } from './residencyMirror.ts'
import { createAsideCut } from './aside.ts'
import { createTreeFollower, type ComposedLeaves } from './treeFollow.ts'
import { createLinkFollower } from './worldFollow.ts'
import {
  appendRoots,
  flushRuntime,
  parkRoot,
  rewritePlacement,
  updateRuntimeResidency,
  updateRuntimeWorlds,
  writeMark,
  type DagRun,
} from './runtimeOps.ts'
import type { DagResources } from './resources.ts'
import { cutBytes } from './cutBuffers.ts'
import { createProxyInstances } from './proxyInstances.ts'

/** No placement wears a proxy: no box. */
const EMPTY_BOXES = { boxes: new Float64Array(0), changed: new Uint8Array(0) }

export function createDagRuntime(
  resources: DagResources,
  /** The pages the pool already holds, when the cut is made beside it (`poolList.ts`). */
  poolHeld?: (page: number) => boolean,
  /** The leaves a parent's composition writes into the tree's refit (`treeFollow.ts`). */
  leaves?: ComposedLeaves,
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
    tree: createTreeFollower(resources, leaves),
    // What a ray can meet of the run-time cuts, one instance a placement (`proxyInstances.ts`).
    proxies: createProxyInstances(resources),
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
  const { packed, pageCount, frames, buffers } = resources
  // The draw mask, in the part of `flags` that holds its section whole (`split.ts`): its readers
  // bind one buffer at one offset, whatever the split.
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
    run.proxies.refresh()
    run.links?.sync(uniforms, view)
  }
  const selection: GpuSelection = {
    get gpuBytes() {
      return cutBytes(resources)
    },
    get hostBytes() {
      const pool = poolList.entries.byteLength
      return frames.originBytes + uploadResidency.hostBytes + pool + (mirror?.hostBytes ?? 0)
    },
    // The draw mask, a bit a page in `work` (`shader/compactWgsl.ts`): its readers bind one buffer at
    // one offset, whatever the split.
    maskBuffer: resources.work,
    maskOffset: dagWorkLayout(resources.blockCount).drawMask,
    get pageCount() {
      return packed.live?.pages ?? pageCount
    },
    worldCapacity: packed.worldCount,
    worldRanges: frames.ranges.map((range, r) => ({
      ...range,
      buffer: frames.worldBuffers[r],
      frames: frames.buffers[r],
    })),
    packsWorld: !!mirror,
    get worldRevision() {
      return state.worldRevision
    },
    updateWorlds: (next, named) => updateRuntimeWorlds(run, next, named),
    composedPlacement(w, composed) {
      if (!composed && live()) rewritePlacement(run, w)
      run.tree?.touch(w)
    },
    groupOf: (w) => run.tree?.groupOf(w) ?? -1,
    groupsMoved: (groups) => run.tree?.groupsMoved(groups),
    placeObject: (w, object) => run.links?.place(w, object),
    get linkMoved() {
      return run.linkMoved
    },
    set linkMoved(listener) {
      run.linkMoved = listener
    },
    worldStandsIn: (w) => !!run.links?.standsIn(w),
    worldsMovedOnGpu(rows) {
      if (!live()) return
      state.worldRevision++
      // The proxy's mirror of those rows is copied at the next image; the others stand.
      for (const w of rows) run.proxies.worldsWritten([w])
    },
    get growing() {
      return state.growing
    },
    // What `tablesHeld` says, asked without growing anything.
    get cutHeld() {
      return state.disposed || state.dead || state.growing || growthAsked(resources, state)
    },
    get coarsen() {
      return state.coarse.factor
    },
    appendRoots: (roots) => appendRoots(run, roots),
    followRows: (rows) => live() && followRows(resources, state, rows),
    // The root travels behind the stretch in the frame buffer (`resources.ts`).
    parkWorld: (w, parked) => live() && parkRoot(run, w, parked),
    // The mark travels behind the record shift (`primitiveFrameWords`).
    markWorld: (w, mark) => live() && writeMark(run, w, mark),
    get proxyHostBytes() {
      return run.proxies.hostBytes
    },
    proxyBuffer: () => (live() ? run.proxies.buffer() : undefined),
    proxyMirror: (encoder) => live() && run.proxies.mirror(encoder),
    proxyPose: (encoder, host) => live() && run.proxies.pose(encoder, host),
    proxyArrived: () => live() && run.proxies.arrived(),
    proxyBoxes: () => (live() ? run.proxies.worldBoxes() : EMPTY_BOXES),
    proxyCopies: (copies) => live() && run.proxies.setCopies(copies),
    proxyRevision: () => run.proxies.revision * 4096 + state.worldRevision,
    updateResidency: (next, changes, moved) => updateRuntimeResidency(run, next, changes, moved),
    isReady: (page) => uploadResidency.isReady(page),
    isChildReady: (page) => uploadResidency.isChildReady(page),
    askEvictions() {
      if (live()) recutMain(resources.swap, state)
    },
    notePool(page, held) {
      // The next dispatch cuts and reads back again, the eviction queue with it: the cut in hand
      // stays.
      if (live() && poolList.note(page, held)) recutMain(resources.swap, state)
    },
    dispatch(next, shared) {
      syncTables(next, mainView)
      // One image: a coarsened view whose wait ran out tries its own threshold (`coarsening.ts`).
      if (live() && coarsenTick(state.coarse)) recutMain(resources.swap, state)
      return run.dispatch(next, shared)
    },
    peek: () => (state.dead ? null : state.last),
    aside: () => createAsideCut(resources, state, { copyOwed: run.copyOwed, syncTables }),
    adopt: (cut) => (!state.dead && cut === state.last ? chain.adopt() : undefined),
    failed: () => state.dead,
    landed: () => state.pending.then(() => {}),
    flush: () =>
      flushRuntime(run, (uniforms) => {
        syncTables(uniforms, mainView)
        run.dispatch(uniforms)
      }),
    dispose() {
      state.disposed = true
      state.dead = true
      run.tree?.dispose()
      state.pending = state.pending.catch(() => {})
      run.proxies.dispose()
      for (const buffer of buffers) buffer.destroy()
    },
  }
  return selection
}
