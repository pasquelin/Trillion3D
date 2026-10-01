import type * as Lent from './lent.ts';

/**
 * The core's pieces as the impostor family reads them (#1335, #1336): filled once by `lend`, which
 * `loadImpostorCode` calls with the core's `lent.ts` when the family arrives, before any of its
 * code runs; the family's modules read them here at call time, never at their load, and import
 * only the types of the core modules they come from.
 */
export const core = {} as typeof Lent;

/** Fills `core` with what the core lends. */
export const lend = (lent: typeof Lent) => void Object.assign(core, lent);
