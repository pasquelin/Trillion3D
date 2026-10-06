// The engine's shader texts as it builds them by default, one copy for every test: the wide
// direct and bounce lighting (`contractLightingShader`), the TAA resolve, the blend and the water
// composite.
import { contractLightingShader } from '../../lighting/deferred/shaders.ts'
import { taaShader } from '../../taa/shaderWgsl.ts'
import { blendShader } from '../../webgpu/blend/shader.ts'
import { waterCompositeShader } from '../../webgpu/water/compositeWgsl.ts'

export const DIRECT_LIGHTING_SHADER = contractLightingShader(false, false)
export const BOUNCE_LIGHTING_SHADER = contractLightingShader(true, false)
export const TAA_SHADER = taaShader(true)
export const BLEND_SHADER = blendShader()
export const WATER_COMPOSITE_SHADER = waterCompositeShader()
