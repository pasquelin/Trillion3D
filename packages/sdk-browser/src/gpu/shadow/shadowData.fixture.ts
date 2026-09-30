// Where the page table starts in the shadow data buffer, as `shadowData.ts` lays it: every light's
// record first, then the table's words. The tests read and write the table at this offset.
import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';

/** Bytes of the records, before the page table in the same buffer. */
export const SHADOW_TABLE_OFFSET = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
