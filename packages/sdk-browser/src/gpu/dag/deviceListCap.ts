import { storageBufferCap } from '../../residency/pools.ts'
import { listCapHeld } from './layout.ts'

export type Limits = Parameters<typeof storageBufferCap>[0]

/** The most ranks one `out` binding holds on this device. */
export const deviceListCap = (limits: Limits) => listCapHeld(storageBufferCap(limits))
