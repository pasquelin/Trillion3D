import { storageBufferCap } from '../../residency/pools.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';

/** Rows one page table holds on this device: one storage binding of `PAGE_INFO_STRIDE`-byte rows,
 *  the table every pass binds whole (`../pages/render/encodeDraws.ts`, `ensurePageTable`). */
export const pageTableRows = (limits?: Parameters<typeof storageBufferCap>[0]) =>
  Math.max(2, Math.floor(storageBufferCap(limits) / PAGE_INFO_STRIDE));
