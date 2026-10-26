import { DEFERRED_BINDINGS } from '../../../packages/sdk-browser/src/lighting/deferred/bindings.ts'

/** The local lights' pass's bindings the harness never reads: the surfaces, the tile lists of the pass's
 *  vertex stage, the subsurface and the lobes, which its entries set by hand or leave. */
export const UNREAD = new Set<number>([
  DEFERRED_BINDINGS.tileList,
  DEFERRED_BINDINGS.subsurface,
  DEFERRED_BINDINGS.lobes,
])
