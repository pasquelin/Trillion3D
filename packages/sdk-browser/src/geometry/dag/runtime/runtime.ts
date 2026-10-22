import type { GpuSelection } from '../../../gpu/core/selection.ts'
import { createDagResidencyUpload } from '../residencyUpload.ts'
import { createDagDispatch } from '../dispatch.ts'
import { followRows, growthAsked, holdListCaps } from '../queueGrowth.ts'
import { createDifferenceChain } from '../differenceChain.ts'
import { createDagRuntimeState, recutMain } from './runtimeState.ts'
import { createAsideCut } from '../aside.ts'
import { createTreeFollower } from '../tree/treeFollow.ts'
import { createLinkFollower } from '../worlds/worldFollow.ts'
import { WORLD_ROOT_MARK } from '../worlds/worldLinks.ts'
import { DRAW_DISTANCE_MARK } from '../frameTable.ts'
import {
  flushRuntime,
  parkRoot,
  updateRuntimeResidency,
  voidCuts,
  writeDrawDistance,
  writeMark,
  type DagRun,
  type RootsOnGpu,
} from './runtimeOps.ts'
import { rewritePlacement, updateRuntimeWorlds } from './runtimeWorlds.ts'
import { appendRoots } from './runtimeAppend.ts'
import type { DagResources } from '../resources.ts'
import { cutReaders } from '../cut/cutReaders.ts'
import { cutBytes } from '../cut/cutBuffers.ts'
import { createProxyInstances } from '../proxy/proxyInstances.ts'
import { holdViewFilter } from '../viewFilterRegion.ts'
import { followRecords } from '../recordsFollow.ts'
import { NO_PROXY_BOXES } from '../../../lighting/bounce/probes/probeSync.ts'

export function createDagRuntime(
  resources: DagResources,
  /** The session's roots on the GPU: the stretch's one writer and the tree's leaves. */
  roots: RootsOnGpu,
): GpuSelection {
  const state = createDagRuntimeState()
  const chain = createDifferenceChain()
  const run: DagRun = {
    resources,
    state,
    chain,
    // The cut rule's residency, derived from the pool's and uploaded by difference.
    uploadResidency: createDagResidencyUpload(resources),
    ...createDagDispatch(resources, state, chain),
    tree: createTreeFollower(resources, roots.leaves),
    // What a ray can meet of the run-time cuts, one instance a placement (`../proxy/proxyInstances.ts`).
    proxies: createProxyInstances(resources),
    // Each HLOD cell's one representation (`../worlds/worldFollow.ts`).
    links: createLinkFollower(resources),
    moves: new Int32Array(8),
  }
  return selectionOver(run, roots)
}

/** The camera cut's face (`GpuSelection`) over `run`. */
function selectionOver(run: DagRun, roots: RootsOnGpu): GpuSelection {
  const { resources, state, uploadResidency, links, chain } = run
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
      return frames.originBytes + uploadResidency.hostBytes + (links?.hostBytes ?? 0)
    },
    // The frame's draw mask and the post pass's, a bit a page in `work`
    // (`../shader/compactWgsl.ts`): their readers bind one buffer at one offset each.
    maskBuffer: resources.work,
    maskOffset: resources.workLayout.drawMask,
    postMaskOffset: resources.workLayout.postMask,
    get pageCount() {
      return packed.live?.pages ?? pageCount
    },
    worldCapacity: packed.worldCount,
    frames: frames.rows.view,
    get worlds() {
      return frames.worlds.view
    },
    world: links,
    cellStates: packed.world && {
      view: resources.group.cold,
      get base() {
        return packed.world!.stateBase
      },
      get cells() {
        return packed.world!.cells
      },
      get instances() {
        return packed.world!.roots.length
      },
      get files() {
        return packed.world!.fileBase
      },
      get links() {
        return packed.world!.linkBase
      },
    },
    get worldRevision() {
      return state.worldRevision
    },
    updateWorlds: (next, named) => updateRuntimeWorlds(run, next, named),
    keepPoses: () => live() && frames.previous.keep(),
    composedPlacement(w, composed) {
      if (!composed && live()) rewritePlacement(run, w)
      run.tree?.touch(w)
    },
    treeFollowed: !!run.tree,
    groupOf: (w) => run.tree?.groupOf(w) ?? -1,
    groupsMoved: (groups) => run.tree?.groupsMoved(groups),
    placeInCell: (w, cell, instance, file, main, actor) =>
      links?.placeInCell(w, cell, instance, file, main, actor),
    waitRow: (key, row, cell, instance, file, actor) =>
      links?.waitRow(key, row, cell, instance, file, actor),
    switchedPages: (visit) => links?.switched(visit),
    worldsMovedOnGpu(rows) {
      if (!live()) return
      state.worldRevision++
      // The proxy's world boxes of those rows are made again; the others stand. The next frame
      // keeps their poses (`../previousPoses.ts`).
      for (const w of rows) {
        run.proxies.worldWritten(w)
        frames.previous.moved(w)
      }
    },
    get growing() {
      return state.growing
    },
    // What `tablesHeld` says, asked without growing anything.
    get cutHeld() {
      return state.disposed || state.dead || state.growing || growthAsked(resources, state)
    },
    holdLists: (caps) => live() && holdListCaps(resources, state, caps),
    appendRoots: (roots) => appendRoots(run, roots),
    followRows: (rows) => live() && followRows(resources, state, rows),
    parkWorld: (w, parked) => live() && parkRoot(run, w, parked),
    // A placement of the world DAG keeps its mark (`WORLD_ROOT_MARK`), and one that names a draw
    // distance its bit (`DRAW_DISTANCE_MARK`, `drawDistanceWorld`), whatever the root's bits.
    markWorld: (w, mark) =>
      live() &&
      writeMark(run, w, mark | (resources.packed.mark[w] & (WORLD_ROOT_MARK | DRAW_DISTANCE_MARK))),
    drawDistanceWorld: (w, distance) => live() && writeDrawDistance(run, w, distance),
    get drawDistances() {
      return !!resources.packed.drawDistance
    },
    proxyDistance: (eye, scale) => live() && run.proxies.distance(eye, scale),
    holdFilter: (bits) => (live() ? holdViewFilter(resources, bits) : undefined),
    // What the passes beside the cut read: its tables, the proxy (`../cut/cutReaders.ts`).
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
    recut() {
      if (live()) recutMain(resources.swap, state)
    },
    dispatch(next, shared) {
      syncTables()
      return run.dispatch(next, shared)
    },
    encodePost: (encoder, pyramid) => live() && run.encodePost(encoder, pyramid),
    bindPyramid: (pyramid) => run.bindPyramid(pyramid),
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
      resources.occlusion.dispose()
      resources.readbacks.destroy()
      for (const buffer of buffers) buffer.destroy()
      for (const { texture } of textures) texture.destroy()
    },
  }
  return selection
}
