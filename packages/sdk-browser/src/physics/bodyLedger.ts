import { checkPhysicsBudget, type PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'

/** What the tile bodies give a body none is left a slot for: the slots they hold, and the
 *  farthest of them freed (`tiles.ts`). */
export type TileRoom = { held: { readonly bodies: number }; evictFarthest(): void }

/**
 * What a world's bodies, and the shapes they share, count against `budget`: one ledger, each
 * count under its owner — a body's slot, a shared shape —, checked first (`check`) and given back
 * by that owner.
 */
export function createBodyLedger(budget: Readonly<PhysicsBudget>) {
  const count = { bodies: 0, decorative: 0, collisionBytes: 0, softVertices: 0 }
  const held = new Map<unknown, { bytes: number; softVertices: number }>()
  const check = (key: keyof typeof count, more: number) =>
    checkPhysicsBudget(budget, key, count[key] + more)
  let tiles: TileRoom = { held: { bodies: 0 }, evictFarthest: () => {} }
  return {
    count,
    /** Refuses `more` of `key` past its budget. */
    check,
    /** Refuses one more body past the budget, the slots the tile bodies hold counted free: what
     *  `takeSlot` could give, nothing evicted. */
    fitsSlot: () => check('bodies', 1 - tiles.held.bodies),
    /** Takes a slot for one more body, the farthest tile body leaving first when none is free. */
    takeSlot() {
      if (count.bodies >= budget.bodies) tiles.evictFarthest()
      check('bodies', 1)
    },
    /** What the tile bodies give a body none is left a slot for. */
    onFull: (room: TileRoom) => void (tiles = room),
    /** `bytes` of collision and `softVertices` counted under `owner`, checked already. */
    hold(owner: unknown, bytes: number, softVertices: number) {
      if (bytes || softVertices) held.set(owner, { bytes, softVertices })
      count.collisionBytes += bytes
      count.softVertices += softVertices
    },
    /** What `owner` counted, given back. */
    give(owner: unknown) {
      const counted = held.get(owner)
      if (!counted) return
      count.collisionBytes -= counted.bytes
      count.softVertices -= counted.softVertices
      held.delete(owner)
    },
  }
}
