import { checkPhysicsBudget, type PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'

/**
 * What a world's bodies, and the shapes they share, count against `budget`: one ledger, each
 * count under its owner — a body's slot, or a shared shape —, checked first (`check`) and given
 * back by that owner.
 */
export function createBodyLedger(budget: Readonly<PhysicsBudget>) {
  const count = { bodies: 0, decorative: 0, collisionBytes: 0, softVertices: 0 }
  /** Of the collision bytes, those the shared shapes hold. */
  const shared = { bytes: 0 }
  const held = new Map<number | object, { bytes: number; softVertices: number }>()
  return {
    count,
    shared,
    /** Refuses `more` of `key` past its budget. */
    check: (key: keyof typeof count, more: number) =>
      checkPhysicsBudget(budget, key, count[key] + more),
    /** `bytes` of collision and `softVertices` counted under `owner`, checked already. */
    hold(owner: number | object, bytes: number, softVertices: number) {
      if (bytes || softVertices) held.set(owner, { bytes, softVertices })
      if (typeof owner === 'object') shared.bytes += bytes
      count.collisionBytes += bytes
      count.softVertices += softVertices
    },
    /** What `owner` counted, given back. */
    give(owner: number | object) {
      if (typeof owner === 'object') shared.bytes -= held.get(owner)?.bytes ?? 0
      count.collisionBytes -= held.get(owner)?.bytes ?? 0
      count.softVertices -= held.get(owner)?.softVertices ?? 0
      held.delete(owner)
    },
  }
}
