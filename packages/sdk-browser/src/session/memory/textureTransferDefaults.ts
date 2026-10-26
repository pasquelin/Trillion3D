// The default upload budgets of a frame (`transferBudgets.ts`).
import { MIB } from '../../../../math/src/constants.ts'

/** The two budgets, ceilings above the 32 tiles a pass lands (`materials/virtual/pump.ts`).
 *  Bytes: 16 MiB of tiles copied into the pools.
 *  Milliseconds: the same order as the shadow stage's budget, the frame's own unit. What they
 *  defer shows its coarser resident level until the next pass. */
export const DEFAULT_TEXTURE_TRANSFER_BYTES = 16 * MIB
export const DEFAULT_TEXTURE_UPLOAD_MS = 1
