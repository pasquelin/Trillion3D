import { type ParticlePool } from '../../../sdk-core/src/fluids/particles.ts'
import { BLENDS } from './drawWords.ts'
import { displayTargets } from '../webgpu/blend/displayFilter.ts'
import { REACTIVE_TARGET } from '../lighting/deferred/asIsShare.ts'

/** A disc's targets: the lit image, its blend's display layers if `routed`, the reactive value. */
export const particleTargets = (
  blend: ParticlePool['blend'],
  routed = false,
): GPUColorTargetState[] => [
  { format: 'rgba16float', blend: BLENDS[blend] },
  ...(routed ? displayTargets(blend === 'additive' ? 'additive' : 'normal') : []),
  REACTIVE_TARGET,
]
