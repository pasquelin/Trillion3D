import { MIB } from '../../../../math/src/constants.ts'

/**
 * THE MOST THE CAMERA CUT'S GPU SHARE HOLDS: its tables — each unique record's hot and cold words,
 * each placement's 128 bytes (`../../geometry/dag/worlds/worlds.ts`), the shared nodes, the descent
 * queues and lists at their settings' caps (`../../geometry/dag/lists/cutListCaps.ts`), the
 * readout and its kept ranks (`../../geometry/dag/lists/listCap.ts`), the masks in `work`. The share is what they
 * hold, asked of the budget before each buffer is made and funded before the pools, as the frame's
 * is (`ActiveGpuMemory.cutTables`, `memoryBudget.ts`): the cut never presses the pools behind
 * their back, and they never refuse it.
 *
 * A cut whose tables would pass this is refused by name before the buffer past it is made
 * (`../../geometry/dag/resources.ts`); lists laid out again past it at run time keep the caps
 * they held (`../../geometry/dag/queueGrowth.ts`). Sized on an 8 km open world of 250 k
 * placements and a million unique records: its records, placements and nodes take 147 MiB; its
 * lists at the reference's caps take the reference's 216 MiB — 2 Mi nodes of 8 bytes a pass and 12
 * held for the post pass, 16 Mi candidate clusters of 8, 4 Mi clusters drawn of 12
 * (`../../geometry/dag/flagSections.ts`) —, and 20 bytes for each root slot and cell of the
 * placement tree beside them, which the reference keeps in its instance lists; its readout and kept
 * ranks the rest.
 */
export const CUT_TABLE_BYTES = 408 * MIB
