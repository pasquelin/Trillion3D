import type * as WebgpuLent from '../webgpu/impostor/lent.ts'

/** What the core lends the impostor family (`../webgpu/impostor/lent.ts`). */
export type Lent = typeof WebgpuLent

/**
 * The core's pieces as the impostor family reads them (#1335, #1336): filled by `lend`, which
 * `loadImpostorCode` calls with the core's lend when the family arrives, before any of its code
 * runs; the family's modules read them here at call time, never at their load, and import only the
 * types of the core modules they come from.
 */
export const core = {} as Lent

/** Fills `core` with what the core lends. */
export const lend = (lent: Lent) => void Object.assign(core, lent)
