import { ALPHA_BLEND } from '../blend/stagePipelines.ts'
import { displayTargets } from '../blend/displayFilter.ts'
import { REACTIVE_TARGET } from '../../lighting/deferred/asIsShare.ts'
import { HDR_FORMAT } from '../../scene/surfaceBuffer.ts'

/** The composite's targets: the HDR target, then, `routed`, a normal layer's display layers, then,
 *  when the frame has a share (`asIsShare.ts`), the reactive value's — green alone, as a
 *  particle's. */
export const waterCompositeTargets = (share: boolean, routed = false): GPUColorTargetState[] => [
  { format: HDR_FORMAT, blend: ALPHA_BLEND },
  ...(routed ? displayTargets('normal') : []),
  ...(share ? [REACTIVE_TARGET] : []),
]
