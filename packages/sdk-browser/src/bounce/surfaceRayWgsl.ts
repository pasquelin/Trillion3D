import { SURFACE_IRRADIANCE_WGSL } from './irradianceWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { INVERSE_PI_BOUNCE } from '../../../math/src/wgsl/lighting.ts'

/** The radiance a surface of diffuse \`albedo\` returns from a point \`P\` of normal \`N\`: the lights' irradiance
 *  there — shadows traced against the proxy — and the bounce the cascades hold, Lambert's. */
export const SURFACE_RAY_WGSL = wgslBlock(
  'SURFACE_RAY_WGSL',
  [INVERSE_PI_BOUNCE, SURFACE_IRRADIANCE_WGSL],
  `
fn surfaceLit(albedo:vec3f,P:vec3f,N:vec3f,reach:f32)->vec3f{
 return albedo*(directIrradiance(P,N,reach)+sampleBounce(P,N))*INVERSE_PI_BOUNCE;
}`,
)
