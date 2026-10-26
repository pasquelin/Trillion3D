import { storageBufferCap } from '../../session/memory/pools.ts'
import { listCapHeld } from './layout.ts'
import { OPEN_SLOT_WORDS } from './heldOpen.ts'

export type Limits = Parameters<typeof storageBufferCap>[0]

/** The most ranks one `out` binding holds on this device, beside the `heldSlots` slots of the
 *  open counts placements hold (`heldOpen.ts`), which lie behind its lists. */
export function deviceListCap(limits: Limits, heldSlots = 0) {
  const binding = storageBufferCap(limits)
  return listCapHeld(binding - heldSlots * OPEN_SLOT_WORDS * 4)
}
