// The engine's shader texts as it builds them by default, one copy for every test: the wide
// direct and bounce lighting (`contractLightingProgram`, whole, and its text), the TAA resolve, the
// blend and the water composite.
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { contractLightingProgram, UNLIT_LIGHTING_PROGRAM } from '../../lighting/deferred/shaders.ts'
import { taaShader } from '../../taa/shaderWgsl.ts'
import { blendShader } from '../../webgpu/blend/shader.ts'
import { waterCompositeShader } from '../../webgpu/water/compositeWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** The contract program's text at a key (`contractLightingProgram`), as its pipeline compiles it. */
export const contractLightingShader = (
  bounce: boolean,
  key: Partial<ContractKey> = { lobeless: true },
) => wgslModule(contractLightingProgram(bounce, key)())
export const UNLIT_LIGHTING_SHADER = wgslModule(UNLIT_LIGHTING_PROGRAM)
export const DIRECT_LIGHTING_PROGRAM = contractLightingProgram(false)
export const BOUNCE_LIGHTING_PROGRAM = contractLightingProgram(true)
export const DIRECT_LIGHTING_SHADER = wgslModule(DIRECT_LIGHTING_PROGRAM())
export const BOUNCE_LIGHTING_SHADER = wgslModule(BOUNCE_LIGHTING_PROGRAM())
export const TAA_SHADER = taaShader(true)
export const BLEND_SHADER = blendShader()
export const WATER_COMPOSITE_SHADER = waterCompositeShader()
