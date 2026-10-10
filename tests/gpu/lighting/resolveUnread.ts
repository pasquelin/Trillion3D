import { LIGHTING_RECEIVER_BINDING } from '../../../packages/sdk-browser/src/lighting/deferred/surfaceWgsl.ts'
import { RECEIVER_BINDINGS } from '../../../packages/sdk-browser/src/visibility/shader/receiverOffsetWgsl.ts'
import { SUBSURFACE_BINDING } from '../../../packages/sdk-browser/src/scene/subsurface.ts'
import { PHYSICAL_LOBES_BINDING } from '../../../packages/sdk-browser/src/scene/physicalLobes.ts'
import { REFLECTION_TARGET_BINDING } from '../../../packages/sdk-browser/src/reflections/weight.ts'

/** The resolve's bindings the harness never reads: the surfaces, the receiver offset's, the
 *  subsurface, the lobes and the reflection, which its entries set by hand or leave. */
export const UNREAD = new Set([
  ...RECEIVER_BINDINGS.map((_, i) => LIGHTING_RECEIVER_BINDING + i),
  SUBSURFACE_BINDING,
  PHYSICAL_LOBES_BINDING,
  REFLECTION_TARGET_BINDING,
])
