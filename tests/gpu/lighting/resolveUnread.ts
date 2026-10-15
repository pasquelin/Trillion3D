import { DEFERRED_BINDINGS } from '../../../packages/sdk-browser/src/lighting/deferred/bindings.ts'

/** The resolve's bindings the harness never reads: the surfaces, the receiver target, the
 *  subsurface, the lobes and the reflection, which its entries set by hand or leave. */
export const UNREAD = new Set([
  DEFERRED_BINDINGS.receiver,
  DEFERRED_BINDINGS.subsurface,
  DEFERRED_BINDINGS.lobes,
  DEFERRED_BINDINGS.reflection,
])
