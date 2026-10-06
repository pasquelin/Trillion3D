import { HOST_WRAP_CLAMP_TO_EDGE, HOST_WRAP_MIRRORED_REPEAT } from './surfaceConstants.ts'
import type { WrapMode } from '../../../sdk-core/src/index.ts'

/** Addressing the host declared, in the engine's words; anything else repeats, as the samplers do. */
export function importWrapMode(wrap: number): WrapMode {
  if (wrap === HOST_WRAP_CLAMP_TO_EDGE) return 'clamp'
  return wrap === HOST_WRAP_MIRRORED_REPEAT ? 'mirror' : 'repeat'
}
