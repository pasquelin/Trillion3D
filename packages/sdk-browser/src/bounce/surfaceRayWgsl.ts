import { LIGHTS_IRRADIANCE_WGSL } from '../lighting/direct/lightLoopWgsl.ts'
import { BOUNCE_LIGHT_CELL_WGSL } from './lightCellWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { INVERSE_PI } from '../../../math/src/wgsl/constants.ts'

/** The radiance a surface of diffuse \`albedo\` returns from a point \`P\` of normal \`N\`, Lambert's:
 *  \`surfaceSeen\`, under the irradiance the cascades already hold there — a reflection's hit, read —;
 *  \`surfaceLit\`, the lights' irradiance too — walking the lights of its cell (\`bounceLightSlice\`),
 *  shadows traced against the proxy —, what a probe's ray brings back to build the cascades. Every
 *  program that traces binds the light grid's buffer as \`tileLights\`. */
export const SURFACE_RAY_WGSL = wgslBlock(
  'SURFACE_RAY_WGSL',
  [INVERSE_PI, LIGHTS_IRRADIANCE_WGSL, BOUNCE_LIGHT_CELL_WGSL],
  `
fn surfaceSeen(albedo:vec3f,P:vec3f,N:vec3f)->vec3f{return albedo*sampleBounce(P,N)*INVERSE_PI;}
fn surfaceLit(albedo:vec3f,P:vec3f,N:vec3f,reach:f32)->vec3f{
 return albedo*lightsIrradiance(P,N,reach)*INVERSE_PI+surfaceSeen(albedo,P,N);
}`,
)
