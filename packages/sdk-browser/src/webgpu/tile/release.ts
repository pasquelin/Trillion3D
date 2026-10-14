import { tailSlotOf, tileSlotOf } from './ids.ts'
import type { Lane } from './lanes.ts'

/** A retired slot gives back its pinned tail and streamed places without moving other slots. */
export function releaseTileSlot(lane: Lane, slot: number) {
  for (const index of lane.pool.occupied()) {
    const id = lane.pool.keyOf(index)
    if ((tailSlotOf(id) ?? tileSlotOf(id)) !== slot) continue
    lane.resident.delete(id)
    lane.pool.release(index)
  }
}
