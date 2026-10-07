import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { SharedShapes } from './sharedShapes.ts'
import type { TileShape } from './tilePlace.ts'
import { ONE_REQUEST } from '../cluster/checked.ts'

/** Tile reads in flight at once. */
const FETCHES = 8
/** Tile reads one update starts at most: each lands as a restore in the worker's next step. */
const LOADS = 2

/**
 * The reads of the tiles an update lets in (`tileSchedule.ts`), nearest first within the caps —
 * `FETCHES` in flight, `LOADS` an update —, one request each: a tile restored as its bytes land if
 * the update then current still lets it in (`restored`), else dropped, and handed to `landed`. A
 * tile still wanted is asked again at the next update, but for a 4xx; a failure is reported by
 * the registry, once, or to `failed`.
 */
export function createTileReads(
  shapes: SharedShapes,
  landed: (shape: TileShape) => void,
  failed: (error: EngineError) => void,
) {
  let fetching = 0,
    pass = 0
  /** Whether the update then current lets tile `shape` in. */
  const admitted = (shape: TileShape) => shape.kept === pass
  const read = (shape: TileShape) => {
    fetching++
    void shapes
      .restored(shape, admitted, ONE_REQUEST)
      .then((restored) => restored && landed(shape))
      .catch((error) => failed(error as EngineError))
      .finally(() => fetching--)
  }
  /** Reads the `LOADS` nearest of `tiles` — nearest first — update `now` lets in and that are
   *  neither restored nor on their way. */
  return (tiles: readonly TileShape[], now: number) => {
    pass = now
    for (let i = 0, loads = LOADS; i < tiles.length && loads && fetching < FETCHES; i++) {
      const shape = tiles[i]
      if (shape.kept !== pass || shape.handle >= 0 || shape.read) continue
      loads--
      read(shape)
    }
  }
}
