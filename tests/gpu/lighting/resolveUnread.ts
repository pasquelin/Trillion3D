import { DEFERRED_BINDINGS } from '../../../packages/sdk-browser/src/lighting/deferred/bindings.ts'
import { RECEIVER_BINDINGS } from '../../../packages/sdk-browser/src/visibility/shader/receiverOffsetWgsl.ts'

/** The resolve's bindings the harness never reads: the surfaces, the receiver offset's, the
 *  subsurface, the lobes and the reflection, which its entries set by hand or leave. */
export const UNREAD = new Set([
  ...RECEIVER_BINDINGS.map((_, i) => DEFERRED_BINDINGS.receiver + i),
  DEFERRED_BINDINGS.subsurface,
  DEFERRED_BINDINGS.lobes,
  DEFERRED_BINDINGS.reflection,
])
