import type { GpuSelection } from '../../../gpu/core/selection.ts'
import { growthAsked, holdListCaps } from '../queueGrowth.ts'
import { recutMain } from './runtimeState.ts'
import { createAsideCut } from '../aside.ts'
import { WORLD_ROOT_MARK } from '../worlds/worldLinks.ts'
import { DRAW_MARKS, ROOT_PARENT_MARK } from '../frameTable.ts'
import {
  flushRuntime,
  parkRoot,
  updateRuntimeResidency,
  writeDrawDistance,
  writeMark,
  writeRootParentWords,
  type DagRun,
} from './runtimeOps.ts'
import { rewritePlacement, updateRuntimeWorlds } from './runtimeWorlds.ts'
import { appendRoots } from './runtimeAppend.ts'
import { cutReaders } from '../cut/cutReaders.ts'
import { cutBytes } from '../cut/cutBuffers.ts'
import { holdViewFilter } from '../viewFilterRegion.ts'
import { NO_PLACEMENT_BOXES } from '../placement/placementBoxes.ts'

/**
 * THE PARTS OF THE CAMERA CUT'S FACE (`GpuSelection`, `runtime.ts`): each a set of its members over
 * the run, joined with their accessors kept (`joined`). `live` says whether the run is not yet
 * released.
 */

/** The members of the cut's face `selectionTables` builds. */
type TablesFace = Pick<
  GpuSelection,
  | 'gpuBytes'
  | 'hostBytes'
  | 'visible'
  | 'visibleCap'
  | 'info'
  | 'edges'
  | 'infoShift'
  | 'maskBuffer'
  | 'maskOffset'
  | 'postMaskOffset'
  | 'pageCount'
  | 'worldCapacity'
  | 'frames'
  | 'worlds'
  | 'previous'
>

/** The cut's tables the passes beside it bind, and their sizes. */
export function selectionTables(run: DagRun): TablesFace {
  const { resources, uploadResidency, links } = run
  const { packed, pageCount, frames } = resources
  return {
    get gpuBytes() {
      return cutBytes(resources)
    },
    get hostBytes() {
      return frames.originBytes + uploadResidency.hostBytes + (links?.hostBytes ?? 0)
    },
    // The masks of the blended clusters the frame draws, the post pass's alone behind them, a bit a
    // page in `work` (`../shader/blendMaskWgsl.ts`): their readers bind one buffer at one offset
    // each. The visible clusters the rasters draw are `visible`, another buffer when its room grows.
    get visible() {
      return resources.visible
    },
    get visibleCap() {
      return resources.visibleCap
    },
    info: resources.info,
    edges: resources.edges,
    infoShift: packed.infoShift,
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
    get previous() {
      return frames.previous.table.view
    },
  }
}

/** The members of the cut's face `selectionPoses` builds. */
type PosesFace = Pick<
  GpuSelection,
  | 'keepPoses'
  | 'posesDrawn'
  | 'poses'
  | 'keepPosesOf'
  | 'posesMoving'
  | 'composedPlacement'
  | 'treeFollowed'
  | 'treeParented'
  | 'groupOf'
  | 'groupsMoved'
>

/** The placements' poses and tree. */
export function selectionPoses(run: DagRun, live: () => boolean): PosesFace {
  const { tree } = run
  const { frames } = run.resources
  return {
    keepPoses: () => live() && frames.previous.keep(),
    posesDrawn: () => frames.previous.drawn(),
    poses: frames.previous,
    keepPosesOf: (older) => frames.previous.adopt(older.poses),
    get posesMoving() {
      return frames.previous.moving
    },
    composedPlacement(w, composed) {
      if (!composed && live()) rewritePlacement(run, w)
      tree?.touch(w)
    },
    treeFollowed: !!tree,
    treeParented: !!tree?.parented,
    groupOf: (w) => tree?.groupOf(w) ?? -1,
    groupsMoved: (groups) => tree?.groupsMoved(groups),
  }
}

/** The members of the cut's face `selectionWorlds` builds. */
type WorldsFace = Pick<
  GpuSelection,
  | 'world'
  | 'cellStates'
  | 'worldRevision'
  | 'updateWorlds'
  | 'placeInCell'
  | 'waitRow'
  | 'switchedPages'
  | 'worldsMovedOnGpu'
>

/** The world's cells and files, and the rows a pose moved. */
export function selectionWorlds(run: DagRun, live: () => boolean): WorldsFace {
  const { resources, state, links } = run
  const { packed, frames } = resources
  return {
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
    placeInCell: (w, cell, instance, file, main, actor) =>
      links?.placeInCell(w, cell, instance, file, main, actor),
    waitRow: (key, row, cell, instance, file, actor) =>
      links?.waitRow(key, row, cell, instance, file, actor),
    switchedPages: (visit) => links?.switched(visit),
    worldsMovedOnGpu(rows) {
      if (!live()) return
      state.worldRevision++
      // The world boxes of those rows are made again; the others stand. The next frame
      // keeps their poses (`../previousPoses.ts`).
      for (const w of rows) {
        run.boxes.mark(w)
        frames.previous.moved(w)
      }
    },
  }
}

/** The members of the cut's face `selectionPlacements` builds. */
type PlacementsFace = Pick<
  GpuSelection,
  | 'growing'
  | 'cutHeld'
  | 'holdLists'
  | 'appendRoots'
  | 'parkWorld'
  | 'markWorld'
  | 'drawDistanceWorld'
  | 'rootParentWorld'
  | 'drawDistances'
  | 'holdFilter'
>

/** The growth of the cut's lists, and the roots and placements a host moves. */
export function selectionPlacements(run: DagRun, live: () => boolean): PlacementsFace {
  const { resources, state } = run
  return {
    get growing() {
      return state.growing
    },
    // What `tablesHeld` says, asked without growing anything.
    get cutHeld() {
      return state.disposed || state.dead || state.growing || growthAsked(resources, state)
    },
    holdLists: (caps) => live() && holdListCaps(resources, state, caps),
    appendRoots: (roots) => appendRoots(run, roots),
    parkWorld: (w, parked) => live() && parkRoot(run, w, parked),
    // A placement of the world DAG keeps its mark (`WORLD_ROOT_MARK`), one that names a draw
    // distance its bits (`DRAW_MARKS`, `drawDistanceWorld`) and an instance of an assembly its own
    // (`ROOT_PARENT_MARK`, `rootParentWorld`), whatever the root's bits.
    markWorld: (w, mark) =>
      live() &&
      writeMark(
        run,
        w,
        mark | (resources.packed.mark[w] & (WORLD_ROOT_MARK | DRAW_MARKS | ROOT_PARENT_MARK)),
      ),
    drawDistanceWorld: (w, distance) => live() && writeDrawDistance(run, w, distance),
    rootParentWorld: (w, parent) => !live() || writeRootParentWords(run, w, parent),
    get drawDistances() {
      return !!resources.packed.drawDistance
    },
    holdFilter: (bits) => (live() ? holdViewFilter(resources, bits) : undefined),
  }
}

/** The members of the cut's face `selectionBoxes` builds. */
type BoxesFace = Pick<GpuSelection, 'cutTables' | 'placementBoxes' | 'placementBoxesBytes'>

/** What the passes beside the cut read of it: its tables (`../cut/cutReaders.ts`), and the world boxes of its placements. */
export function selectionBoxes(run: DagRun, live: () => boolean): BoxesFace {
  return {
    // What the passes beside the cut read: its tables (`../cut/cutReaders.ts`).
    ...cutReaders(run, live),
    get placementBoxesBytes() {
      return run.boxes.hostBytes
    },
    placementBoxes: () => (live() ? run.boxes.boxes() : NO_PLACEMENT_BOXES),
  }
}

/** The members of the cut's face `selectionCut` builds. */
type CutFace = Pick<
  GpuSelection,
  | 'updateResidency'
  | 'isReady'
  | 'isChildReady'
  | 'recut'
  | 'dispatch'
  | 'encodePost'
  | 'bindPyramid'
  | 'peek'
  | 'aside'
  | 'failed'
  | 'landed'
  | 'flush'
  | 'dispose'
>

/** The residency, the dispatch, the aside cuts and the end of the run. */
export function selectionCut(run: DagRun, live: () => boolean, syncTables: () => void): CutFace {
  const { resources, state, uploadResidency } = run
  return {
    updateResidency: (next, changes, moved) => updateRuntimeResidency(run, next, changes, moved),
    isReady: (page) => uploadResidency.isReady(page),
    isChildReady: (page) => uploadResidency.isChildReady(page),
    recut() {
      if (live()) recutMain(resources.owner, state)
    },
    dispatch(next, shared) {
      syncTables()
      return run.dispatch(next, shared)
    },
    encodePost: (encoder, pyramid) => live() && run.encodePost(encoder, pyramid),
    bindPyramid: (pyramid) => run.bindPyramid(pyramid),
    peek: () => (state.dead ? null : state.last),
    aside: (primed) =>
      createAsideCut(resources, state, { copyOwed: run.copyOwed, syncTables }, primed),
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
      resources.readbacks.destroy()
      resources.release()
    },
  }
}
