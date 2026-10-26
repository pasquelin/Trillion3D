import { type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts'
import { BLENDS } from './drawWords.ts'
import { displayTargets } from '../blend/display/displayFilter.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'

/** A disc's targets: the translucency target, its blend's display layers if `routed`. */
export const particleTargets = (
  blend: ParticlePool['blend'],
  routed = false,
): GPUColorTargetState[] => [
  { format: HDR_FORMAT, blend: BLENDS[blend] },
  ...(routed ? displayTargets(blend === 'additive' ? 'additive' : 'normal') : []),
]
