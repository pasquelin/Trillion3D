import type {
  AssetScope,
  CameraPose,
  FrameMetrics,
  StablePreview,
} from '../../../../sdk-core/src/index.ts'
import type { Engine } from '../../engine/types.ts'
import { DEFAULT_CLEAR_COLOR } from '../../engine/common.ts'
import type { MemoryBudgets } from '../../residency/pools.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import type { AlphaChange } from '../../placement/engineSceneUpdates.ts'
import type { DrawSource } from '../../page/selection/drawSource.ts'
import type { Primitive } from '../../../../sdk-core/src/index.ts'
import type { SessionRuntime } from '../render/sessionRuntime.ts'

type Inputs = {
  check: () => void
  engine: Engine
  render: (pose?: CameraPose) => FrameMetrics
  flush: () => Promise<void>
  capture: () => Promise<Uint8Array>
  scope: AssetScope
  canvas: HTMLCanvasElement
  partitionsJoin: SessionRuntime['partitionsJoin']
}

/** What the session draws of `poses`, one image each, at the canvas's size, bottom row first. */
function viewRenderer(inputs: Inputs) {
  const { check, engine, render, flush, capture, scope, canvas } = inputs
  return async (poses: readonly CameraPose[]): Promise<StablePreview[]> => {
    check()
    const views: StablePreview[] = []
    for (const pose of poses) {
      render(pose)
      await flush()
      const rgba = await capture()
      views.push({
        scope,
        origin: 'bottom-left',
        rgba: rgba.slice(),
        width: canvas.width,
        height: canvas.height,
        backend: engine.id,
      })
    }
    return views
  }
}

/** The rows, compositions and vertices a world rewrites in place, and the buffers it grows. */
function placementUpdates(check: () => void, engine: Engine) {
  return {
    /** Rows `from` to `to` of an instance buffer the session holds were written. */
    updatePlacements: (rows: PlacementRows, from: number, to: number) => (
      check(),
      engine.updatePlacements(rows, from, to)
    ),
    /** Rows `links` follow `parent` (`Engine.composePlacements`). */
    composePlacements(
      parent: object,
      world: ArrayLike<number>,
      links: readonly { rows: PlacementRows; index: number; local: ArrayLike<number> }[],
      whole: boolean,
    ) {
      check()
      return engine.composePlacements(parent, world, links, whole)
    },
    /** Whether it grows each of `from` to `capacity` rows (`Engine.growsInPlace`). */
    growsInPlace: (from: readonly PlacementRows[], capacity: number) =>
      engine.growsInPlace(from, capacity),
    /** An instance buffer the session holds was replaced by a larger one (`placement/growth.ts`). */
    growPlacements: (from: PlacementRows, to: PlacementRows) => (
      check(),
      engine.growPlacements(from, to)
    ),
    /** A source the session was not opened with draws a primitive it holds (`Engine.addPlacements`). */
    addPlacements: (source: DrawSource, primitive: Primitive) => (
      check(),
      engine.addPlacements?.(source, primitive) ??
        Promise.resolve('the engine takes no source in place')
    ),
    /** A dynamic geometry's lists were rewritten in place (#573); false when the engine cannot
     *  take it, and only a new session will draw them. */
    updateVertices: (...change: Parameters<Engine['updateVertices']>) => (
      check(),
      engine.updateVertices(...change)
    ),
    vertexBytes: (...change: Parameters<Engine['vertexBytes']>) => engine.vertexBytes(...change),
  }
}

/** The partitions a world's models bring, joined to the session while it runs: placed for its view
 *  (`prime`), then followed by each frame (`follow`) — or no more (`leave`). */
function partitionJoins(check: () => void, join: Inputs['partitionsJoin']) {
  return {
    /** The index pages of `cells` catalogued, their roots counted and bound, the cells the view
     *  reaches placed (`primePartitions`): before the rows they place are handed to the engine. */
    preparePartitions: (...args: Parameters<Inputs['partitionsJoin']['prime']>) => (
      check(),
      join.prime(...args)
    ),
    followPartitions: (...args: Parameters<Inputs['partitionsJoin']['follow']>) => (
      check(),
      join.follow(...args)
    ),
    leavePartitions: (...args: Parameters<Inputs['partitionsJoin']['leave']>) => (
      check(),
      join.leave(...args)
    ),
  }
}

/** The scene changes the engine takes in place, without preparing the session again. */
export function createExplorerSceneApi(inputs: Inputs) {
  const { check, engine } = inputs
  return {
    /**
     * Sets the engine's memory pools during the session — what a settings slider calls. The
     * engine keeps what fits in the new pool, and the report says what it really holds (`clamp`
     * when the value was brought back) and what the setting cost.
     */
    async setMemoryBudgets(budgets: MemoryBudgets) {
      check()
      return engine.setMemoryBudgets(budgets)
    },
    ...placementUpdates(check, engine),
    ...partitionJoins(check, inputs.partitionsJoin),
    /** Bounced light on or off in the session, at the next frame. */
    setBounce(on: boolean) {
      check()
      engine.setBounce(on)
    },
    /** The clear colour behind the scene, `0xrrggbb` or the default, at the next frame. */
    setClearColor(hex = DEFAULT_CLEAR_COLOR) {
      check()
      engine.setClearColor(hex)
    },
    /** Host surfaces rewritten in place are read again; false when the engine cannot for this
     *  change — a picture that changed size —, and only a new session will draw them. `values`
     *  false says only their textures moved, `alpha` that their alpha mode or cutoff did
     *  (`Engine.refreshMaterials`). */
    refreshMaterials: (values = true, alpha?: AlphaChange) => (
      check(),
      engine.refreshMaterials(values, alpha) !== false
    ),
    renderViews: viewRenderer(inputs),
  }
}
