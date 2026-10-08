import {
  checkPhysicsBudget,
  collisionBytesOf,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts'
import type { SlotOwner } from './bodySlots.ts'

/** What the tiles give a body no tile holds when none is left a slot, or bytes, for it: the slots
 *  their bodies hold and the bytes their restored shapes claim, the farthest body freed, and the
 *  farthest tiles let go until `bytes` fit (`tiles.ts`). */
export type TileRoom = {
  readonly bodies: number
  readonly bytes: number
  evictFarthest(): void
  letGoFarthest(bytes: number): void
}

const NO_TILES: TileRoom = { bodies: 0, bytes: 0, evictFarthest() {}, letGoFarthest() {} }

/**
 * What a world's bodies, and the shapes they share, count against `budget`: one ledger, each
 * count under its owner — a body's slot, a shared shape —, admitted first (`admit`, `claim`) and
 * given back by that owner. A body no tile holds counts the tiles' slots and bytes free: they
 * leave for it (`makeRoom`), the farthest first.
 */
export function createBodyLedger(budget: Readonly<PhysicsBudget>) {
  const count = { bodies: 0, decorative: 0, collisionBytes: 0, softVertices: 0 }
  const held = new Map<unknown, { bytes: number; softVertices: number }>()
  let tiles = NO_TILES
  /** How much more of `key` the budget allows. */
  const room = (key: keyof typeof count) =>
    (key === 'collisionBytes' ? collisionBytesOf(budget) : budget[key]) - count[key]
  /** Refuses `more` of `key` past its budget, by name. */
  const check = (key: keyof typeof count, more: number) => {
    if (more > room(key)) checkPhysicsBudget(budget, key, count[key] + more)
  }
  /** `bytes` of collision and `softVertices` counted under `owner`, admitted already. */
  const hold = (owner: unknown, bytes: number, softVertices: number) => {
    if (bytes || softVertices) held.set(owner, { bytes, softVertices })
    count.collisionBytes += bytes
    count.softVertices += softVertices
  }
  return {
    count,
    room,
    hold,
    /** Refuses the body `owner` would hold past the budget — `bytes` of collision,
     *  `softVertices`, a decorative one's count, its slot —, the tiles' slots and bytes counted
     *  free for a body no tile holds; nothing leaves. */
    admit(owner: SlotOwner, bytes: number, softVertices: number) {
      const tile = 'tile' in owner
      check('collisionBytes', tile ? bytes : bytes - tiles.bytes)
      check('softVertices', softVertices)
      if ('mesh' in owner && owner.physics.decorative) check('decorative', 1)
      check('bodies', tile ? 1 : 1 - tiles.bodies)
    },
    /** Room for one more body no tile holds, of `bytes`: the farthest tiles let go until they
     *  fit, then the farthest tile body for a slot when none is free. */
    makeRoom(bytes: number) {
      if (room('collisionBytes') < bytes) tiles.letGoFarthest(bytes)
      if (room('bodies') < 1) tiles.evictFarthest()
      check('collisionBytes', bytes)
      check('bodies', 1)
    },
    /** `bytes` of collision a shape bodies share claims under it: refused past the share. */
    claim(owner: object, bytes: number) {
      check('collisionBytes', bytes)
      hold(owner, bytes, 0)
    },
    /** What the tiles give a body no tile holds (`makeRoom`). */
    onFull: (room: TileRoom) => void (tiles = room),
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

/** A world's ledger (`createBodyLedger`). */
export type BodyLedger = ReturnType<typeof createBodyLedger>
