// The default upload budgets of a frame (`transferBudgets.ts`).
/** The two budgets. Bytes: 16 MiB of tiles copied into the pools.
 *  Milliseconds: the same order as the shadow stage's budget, a fixed number of tile
 *  uploads per frame in the frame's own unit. What they defer shows its coarser resident level
 *  until the next pass. */
export const DEFAULT_TEXTURE_TRANSFER_BYTES = 16 * 1024 * 1024;
export const DEFAULT_TEXTURE_UPLOAD_MS = 1;
