import { LIGHTS_IRRADIANCE_WGSL } from '../lighting/direct/lightLoopWgsl.ts'
import { BOUNCE_LIGHT_CELL_WGSL } from './lightCellWgsl.ts'
import { BOUNCE_GRID_WGSL } from './gridWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { INVERSE_PI_BOUNCE } from '../../../math/src/wgsl/lighting.ts'

/** The radiance a surface of diffuse \`albedo\` returns from a point \`P\` of normal \`N\`, Lambert's,
 *  under the irradiance the cascades already hold there (\`surfaceSeen\`): a reflection's hit, read,
 *  whatever the lights — in every program that reads the reflection chain. */
export const SURFACE_SEEN_WGSL = wgslBlock(
  'SURFACE_SEEN_WGSL',
  [INVERSE_PI_BOUNCE, BOUNCE_GRID_WGSL],
  `fn surfaceSeen(albedo:vec3f,P:vec3f,N:vec3f)->vec3f{return albedo*sampleBounce(P,N)*INVERSE_PI_BOUNCE;}`,
)

/** \`surfaceLit\`: the lights' irradiance too — walking the lights of its cell (\`bounceLightSlice\`),
 *  shadows traced against the proxy —, what a probe's ray brings back to build the cascades. Every
 *  program that lights a probe's hit binds the light grid's buffer as \`tileLights\`. */
export const SURFACE_RAY_WGSL = wgslBlock(
  'SURFACE_RAY_WGSL',
  [SURFACE_SEEN_WGSL, INVERSE_PI_BOUNCE, LIGHTS_IRRADIANCE_WGSL, BOUNCE_LIGHT_CELL_WGSL],
  `fn surfaceLit(albedo:vec3f,P:vec3f,N:vec3f,reach:f32)->vec3f{
 return albedo*lightsIrradiance(P,N,reach)*INVERSE_PI_BOUNCE+surfaceSeen(albedo,P,N);
}`,
)
