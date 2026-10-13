import { LIGHTS_IRRADIANCE_WGSL } from '../lighting/direct/lightLoopWgsl.ts'
import { BOUNCE_LIGHT_CELL_WGSL } from './lightCellWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { INVERSE_PI_BOUNCE } from '../../../math/src/wgsl/lighting.ts'

/** The radiance a surface of diffuse \`albedo\` returns from a point \`P\` of normal \`N\`: the lights' irradiance
 *  there — walking the lights of its cell (\`bounceLightSlice\`), shadows traced against the proxy — and the
 *  bounce the cascades hold, Lambert's. Every program that traces binds the light grid's buffer as \`tileLights\`. */
export const SURFACE_RAY_WGSL = wgslBlock(
  'SURFACE_RAY_WGSL',
  [INVERSE_PI_BOUNCE, LIGHTS_IRRADIANCE_WGSL, BOUNCE_LIGHT_CELL_WGSL],
  `
fn surfaceLit(albedo:vec3f,P:vec3f,N:vec3f,reach:f32)->vec3f{
 return albedo*(lightsIrradiance(P,N,reach)+sampleBounce(P,N))*INVERSE_PI_BOUNCE;
}`,
)
