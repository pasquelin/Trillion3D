import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { skyLightReadWgsl } from '../../modules/sky/skyLight/read.ts'
import { REFLECTION_SKY_LIGHT } from '../reflections/viewLayout.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from '../reflections/field.ts'
import { SCREEN_SPACE_BINDINGS as B, SCREEN_SPACE_INPUTS_WGSL } from './rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from './screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from './screenSpaceView.ts'

/** The binding of the traced reflections the composition reads. */
export const COMPOSE_INPUT_BINDING = 17

/**
 * THE REFLECTIONS COMPOSED WITH THE ENVIRONMENT (\`composeCompute\`), a thread a pixel: what the reflection target holds for the opaque
 * resolve is the rays' answer and, where they did not answer, the radiance around the scene along the reflected direction at the surface's
 * roughness (the sky light's filtered cube): \`traced.rgb + (1 - traced.a) * environment\`, the traced alpha being the share of the rays that hit,
 * faded by the roughness and the intensity. A pixel that casts no ray (no surface, far plane, unlit) writes zero.
 */
export const composeWgsl = () =>
  wgslProgram(
    `@group(${SCREEN_SPACE_GROUP}) @binding(${COMPOSE_INPUT_BINDING}) var tracedImage:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.out}) var targetOut:texture_storage_2d_array<rgba16float,write>;
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn composeCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=ssView.size.xy)){return;}
 let pixel=vec2i(id.xy);
 let flags=textureLoad(surfaceFlags,pixel,0).r;
 let z=hizOpaqueDepth(pixel);
 var color=vec3f(0.0);
 if(!ssFarDepth(z)&&!ssUnlit(flags)){
  let normal=textureLoad(surfaceNormals,pixel,0);
  let traced=textureLoad(tracedImage,pixel,0);
  let P=ssWorldAt(ssScreenOfPixel(vec2f(pixel)+vec2f(0.5)),z);
  let R=reflect(ssCameraVector(P),normalize(normal.xyz));
  color=traced.rgb+(1.0-saturate(traced.a))*reflectionEnvironment(R,normal.a);
 }
 textureStore(targetOut,pixel,0,vec4f(color,0.0));
}`,
    [SCREEN_SPACE_INPUTS_WGSL, skyLightReadWgsl(REFLECTION_SKY_LIGHT), REFLECTION_ENVIRONMENT_WGSL],
  )
