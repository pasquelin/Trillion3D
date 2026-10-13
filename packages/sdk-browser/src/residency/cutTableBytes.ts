import { MIB } from '../../../math/src/constants.ts'

/**
 * THE MOST THE CAMERA CUT'S GPU SHARE HOLDS: its tables — each unique record's hot and cold words,
 * each placement's 128 bytes (`../gpu/dag/worlds.ts`), the shared nodes, and what a view's reach
 * holds: the descent queues and lists at the size they grew to (`../gpu/dag/queueGrowth.ts`), the
 * readout and its kept ranks (`../gpu/dag/listCap.ts`), the masks in `work`. The share is what they
 * hold, asked of the budget before each buffer is made and funded before the pools, as the frame's
 * is (`ActiveGpuMemory.cutTables`, `memoryBudget.ts`): the cut never presses the pools behind
 * their back, and they never refuse it.
 *
 * A cut whose tables would pass this is refused by name before the buffer past it is made, and the
 * CPU cut draws (`../gpu/dag/resources.ts`); a cut that would grow past it does not grow, and its
 * view coarsens (`../gpu/dag/coarsening.ts`). Sized on an 8 km open world of 250 k placements and a
 * million unique records: its records, placements and nodes take 147 MiB, its views' worst reach —
 * six eyes, nothing resident, 3.9 M candidates and a level of 976 k entries — 182 MiB more.
 */
export const CUT_TABLE_BYTES = 384 * MIB
