import { storageBufferCap } from '../../residency/pools.ts'
import { listCapHeld } from './layout.ts'
import { HELD_SLOT_WORDS } from './heldOpen.ts'

export type Limits = Parameters<typeof storageBufferCap>[0]

/** The most ranks one `out` binding holds on this device, beside the `heldSlots` slots of the
 *  open counts placements hold (`heldOpen.ts`), which lie behind its lists. */
export const deviceListCap = (limits: Limits, heldSlots = 0) =>
  listCapHeld(storageBufferCap(limits) - heldSlots * HELD_SLOT_WORDS * 4)
