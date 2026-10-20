// The engine's shader texts as it builds them by default, one copy for every test: the wide
// direct and bounce lighting (`contractLightingProgram`), the TAA resolve, the blend and its
// transmissive stages.
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { contractLightingProgram, UNLIT_LIGHTING_PROGRAM } from '../../lighting/deferred/shaders.ts'
import { taaResolveShader } from '../../post/taa/resolveWgsl.ts'
import { blendShader } from '../../blend/shader.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** The contract program's text at a key (`contractLightingProgram`), as its pipeline compiles it. */
export const contractLightingShader = (
  bounce: boolean,
  key: Partial<ContractKey> = { lobeless: true },
) => wgslModule(contractLightingProgram(bounce, key))
export const UNLIT_LIGHTING_SHADER = wgslModule(UNLIT_LIGHTING_PROGRAM)
export const DIRECT_LIGHTING_SHADER = wgslModule(contractLightingProgram(false))
export const BOUNCE_LIGHTING_SHADER = wgslModule(contractLightingProgram(true))
export const TAA_SHADER = taaResolveShader(true)
export const BLEND_SHADER = blendShader()
export const TRANSMIT_SHADER = blendShader({}, { stage: transmitWgsl({}, false) })
