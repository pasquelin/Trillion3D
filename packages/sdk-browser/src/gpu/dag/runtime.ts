import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'
import { createDagResidencyUpload } from './residencyUpload.ts'
import { createDagPoolList } from './poolList.ts'
import { createDagDispatch } from './dispatch.ts'
import { followRows, growthAsked } from './queueGrowth.ts'
import { createDifferenceChain } from './differenceChain.ts'
import { createDagRuntimeState, recutMain } from './runtimeState.ts'
import { coarsenTick } from './coarsening.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { createAsideCut } from './aside.ts'
import { createTreeFollower } from './treeFollow.ts'
import { createLinkFollower } from './worldFollow.ts'
import { WORLD_ROOT_MARK } from './worldLinks.ts'
import {
  flushRuntime,
  parkRoot,
  updateRuntimeResidency,
  voidCuts,
  writeMark,
  type DagRun,
  type RootsOnGpu,
} from './runtimeOps.ts'
import { rewritePlacement, updateRuntimeWorlds } from './runtimeWorlds.ts'
import { appendRoots } from './runtimeAppend.ts'
import type { DagResources } from './resources.ts'
import { cutReaders } from './cutReaders.ts'
import { cutBytes } from './cutBuffers.ts'
import { createProxyInstances } from './proxyInstances.ts'
import { followRecords } from './recordsFollow.ts'
import { NO_PROXY_BOXES } from '../../bounce/probeSync.ts'

export function createDagRuntime(
  resources: DagResources,
  /** The pages the pool already holds, when the cut is made beside it (`poolList.ts`). */
  poolHeld: ((page: number) => boolean) | undefined,
  /** The session's roots on the GPU: the stretch's one writer and the tree's leaves. */
  roots: RootsOnGpu,
): GpuSelection {
  const { packed } = resources
  const state = createDagRuntimeState()
  const chain = createDifferenceChain()
  const run: DagRun = {
    resources,
    state,
    chain,
    // The cut rule's residency, derived from the pool's and uploaded by difference.
    uploadResidency: createDagResidencyUpload(resources),
    ...createDagDispatch(resources, state, chain),
    poolList: createDagPoolList(packed, resources.cold, poolHeld),
    tree: createTreeFollower(resources, roots.leaves),
    // What a ray can meet of the run-time cuts, one instance a placement (`proxyInstances.ts`).
    proxies: createProxyInstances(resources),
    // Each HLOD cell's one representation (`worldFollow.ts`).
    links: createLinkFollower(resources),
    moves: new Int32Array(8),
  }
  return selectionOver(run, roots)
}

/** The camera cut's face (`GpuSelection`) over `run`. */
function selectionOver(run: DagRun, roots: RootsOnGpu): GpuSelection {
  const { resources, state, uploadResidency, poolList, links, chain } = run
  const { packed, pageCount, frames, buffers, textures } = resources
  const live = () => !state.disposed && !state.dead
  // The one step every cut on these tables takes before it encodes, the main view's and each view
  // aside's: the root and mark words parked or marked since go up (`flushWords`), the roots'
  // worlds, boxes and stretches are written, the tree fits what moved again over their leaves, the
  // world's links and cell states that moved go up — a cut made before them is not the cut now,
  // the main view's and each view aside's alike (`sameCut`).
  const syncTables = () => {
    if (!live()) return
    frames.flushWords()
    roots.roots(frames.rows)
    run.tree?.sync()
    run.proxies.refresh()
    // The cut's groups follow the placements' records they bind, made again only for another view.
    followRecords(resources)
    if (links?.sync()) voidCuts(state, false)
  }
  const selection: GpuSelection = {
    get gpuBytes() {
      return cutBytes(resources)
    },
    get hostBytes() {
      const pool = poolList.entries.byteLength
      return frames.originBytes + uploadResidency.hostBytes + pool + (links?.hostBytes ?? 0)
    },
    // The draw mask, a bit a page in `work` (`shader/compactWgsl.ts`): its readers bind one buffer at
    // one offset.
    maskBuffer: resources.work,
    maskOffset: dagWorkLayout(resources.blockCount).drawMask,
    get pageCount() {
      return packed.live?.pages ?? pageCount
    },
    worldCapacity: packed.worldCount,
    frames: frames.rows.view,
    get worlds() {
      return frames.worlds.view
    },
    world: links && {
      show: links.show,
      visible: links.visible,
      stands: links.stands,
      get revision() {
        return links.revision
      },
    },
    cellStates: packed.world && {
      view: resources.group.cold,
      get base() {
        return packed.world!.stateBase
      },
      get cells() {
        return packed.world!.cells
      },
    },
    get worldRevision() {
      return state.worldRevision
    },
    updateWorlds: (next, named) => updateRuntimeWorlds(run, next, named),
    composedPlacement(w, composed) {
      if (!composed && live()) rewritePlacement(run, w)
      run.tree?.touch(w)
    },
    treeFollowed: !!run.tree,
    groupOf: (w) => run.tree?.groupOf(w) ?? -1,
    groupsMoved: (groups) => run.tree?.groupsMoved(groups),
    placeInCell: (w, cell, instance) => links?.placeInCell(w, cell, instance),
    waitRow: (key, index, cell, instance) => links?.waitRow(key, index, cell, instance),
    worldsMovedOnGpu(rows) {
      if (!live()) return
      state.worldRevision++
      // The proxy's world boxes of those rows are made again; the others stand.
      for (const w of rows) run.proxies.worldWritten(w)
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
    parkWorld: (w, parked) => live() && parkRoot(run, w, parked),
    // A placement of the world DAG keeps its mark (`WORLD_ROOT_MARK`) whatever the root's bits.
    markWorld: (w, mark) =>
      live() && writeMark(run, w, mark | (resources.packed.mark[w] & WORLD_ROOT_MARK)),
    // What the passes beside the cut read: its tables, the proxy (`cutReaders.ts`).
    ...cutReaders(run, live),
    get proxyHostBytes() {
      return run.proxies.hostBytes
    },
    proxyPose: (encoder, host) => live() && run.proxies.pose(encoder, host),
    proxyArrived: () => live() && run.proxies.arrived(),
    proxyBoxes: () => (live() ? run.proxies.worldBoxes() : NO_PROXY_BOXES),
    updateResidency: (next, changes, moved) => updateRuntimeResidency(run, next, changes, moved),
    isReady: (page) => uploadResidency.isReady(page),
    isChildReady: (page) => uploadResidency.isChildReady(page),
    askEvictions() {
      if (live()) recutMain(resources.swap, state)
    },
    notePool(page, held) {
      // The next dispatch cuts and reads back again, the eviction queue with it; this cut stays.
      if (live() && poolList.note(page, held)) recutMain(resources.swap, state)
    },
    dispatch(next, shared) {
      syncTables()
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
        syncTables()
        run.dispatch(uniforms)
      }),
    dispose() {
      state.disposed = true
      state.dead = true
      run.tree?.dispose()
      state.pending = state.pending.catch(() => {})
      run.proxies.dispose()
      resources.readbacks.destroy()
      for (const buffer of buffers) buffer.destroy()
      for (const { texture } of textures) texture.destroy()
    },
  }
  return selection
}
