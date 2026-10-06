import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import { collisionBytesOf, type PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { createResidentTiles } from './tileResident.ts'
import { cookedBytes, type Model, type Placed, type TileShape } from './tilePlace.ts'
import { ONE_REQUEST, retriableError } from '../cluster/checked.ts'

/** Tile reads in flight at once. */
const FETCHES = 8

/** An open model's opening: its tiles, empty until its file lands, and the abort its leaving lets
 *  go of its reads by — one back while its file was on its way lands once, the later. */
export type TileOpening = { placed: Placed[]; abort: AbortController }

/**
 * The reads of the tiles' cooked objects, `FETCHES` at once: one per tile of a model, however many
 * of its placements want it. Its bytes landing are restored once and built into the body of every
 * placement still waiting for it, then let go: the module holds the shape.
 */
export function createTileReads(
  budget: PhysicsBudget,
  bodies: ReturnType<typeof createPhysicsBodies>,
  resident: ReturnType<typeof createResidentTiles>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  const share = collisionBytesOf(budget)
  let fetching = 0
  /** `shape`'s `bytes` landed: restored when a placement still waits for it and its bytes fit —
   *  else their room was taken by a static mesh meanwhile, and it waits —, then built into the
   *  bodies of the waiting placements the body budget still holds. */
  function land(shape: TileShape, bytes: Uint8Array) {
    const waiting = shape.placed.filter((p) => !p.out && p.id < 0)
    if (!waiting.length || bodies.count.collisionBytes + shape.tile.bytes > share) return
    resident.restore(shape, bytes)
    for (const p of waiting) if (bodies.count.bodies < budget.bodies) resident.build(p)
    invalidate()
  }
  return {
    /** Whether a read may start: fewer than `FETCHES` in flight. */
    free: () => fetching < FETCHES,
    /** Reads `shape`, one of `model`'s, until its `opening` aborts. */
    async read(model: Model, opening: TileOpening, shape: TileShape) {
      const { signal } = opening.abort
      shape.reading = true
      fetching++
      try {
        // One request: a tile still wanted is asked again at the next update, but for a 4xx.
        const bytes = await cookedBytes(model, shape.tile.url, signal, ONE_REQUEST)
        // Its model left, or was opened again meanwhile: this tile is no longer one it holds.
        if (!signal.aborted) land(shape, bytes)
      } catch (error) {
        // Its model left: the read was let go, which is no failure. A 4xx is not asked at the next
        // update: its placements leave their opening until their model opens again, as ones the
        // worker refused.
        if (signal.aborted) return
        failed(error as EngineError)
        if (!retriableError(error)) opening.placed = opening.placed.filter((p) => p.shape !== shape)
      } finally {
        shape.reading = false
        fetching--
      }
    },
  }
}
