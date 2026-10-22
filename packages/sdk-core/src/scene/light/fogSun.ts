/**
 * THE SUN THE FOG SCATTERS, AS THE LIGHT STORE KEEPS IT.
 *
 * The fog scatters the light of one directional light toward the eye (`fogHeight.ts`, the sun's
 * lobe): the sun the store holds (`atmosphereSun.ts`, with or without an atmosphere), else the
 * first directional light added. The environment's block holds, in the fog's sun slot, the unit
 * direction toward it and its luminance (`lightLuminance`: its colour times its intensity, each
 * channel weighed by the eye's sensitivity to it) which the fog's directional colour is multiplied
 * by; all zero without a directional light.
 */
import { ENVIRONMENT_COEFFICIENTS } from '../core/environment.ts'
import { FOG_SLOT } from '../core/fog.ts'
import type { SceneLight } from './contracts.ts'
import { lightLuminance } from './fields.ts'

/** Writes the fog's sun into the environment's block `out`: the direction toward it, then its
 *  luminance; all zero without one. */
export function packFogSun(sun: SceneLight | undefined, out: Float32Array) {
  // The float where the fog's sun slot starts in the environment's block.
  const at = ENVIRONMENT_COEFFICIENTS * 4 + FOG_SLOT.sun * 4
  out.fill(0, at, at + 4)
  if (!sun?.direction) return out
  for (let c = 0; c < 3; c++) out[at + c] = -sun.direction[c]
  out[at + 3] = lightLuminance(sun)
  return out
}
