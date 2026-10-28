import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'
import { skyLightDiffuseWgsl } from '../../modules/sky/skyLight/read.ts'
import { volumetricLightmapWgsl } from '../volumetricLightmap/sampleWgsl.ts'
import {
  LIGHT_DIRECTION_BINDINGS as B,
  LIGHT_DIRECTION_GROUP,
  LIGHT_DIRECTION_SKY,
} from './layout.ts'

/**
 * THE LIGHT DIRECTIONS THE GPU DERIVES: the direction and the angle of an object's indirect shadow are read where the object stands, on the GPU, from a
 * record holding its position (`gather.ts`, `host.ts`), and written back in the same record with the direction in place of the position.
 *
 * Where the session has a volumetric lightmap, by the sky light's mode (`skyLightMode`): 0, the strongest direction of the light the lightmap holds
 * there, in its harmonics of two bands, at the cone angle of the setting; 1, a stationary sky light, the unoccluded direction the lightmap holds, at an
 * angle that grows with the sky's visibility there (its length) from the least sky angle; 2, a sky light that captures the scene, the direction its harmonics
 * are strongest in. Without a lightmap, that last one alone. A direction of almost no length is straight up (the scene's up is y). The least visibility in
 * the record's last word is kept.
 *
 * The lightmap is bound in group 1 from binding 0 (`volumetricLightmapWgsl`), the sky light's harmonics and uniform in group 2 (`LIGHT_DIRECTION_SKY`).
 */

const [RED, GREEN, BLUE] = SRGB_LUMINANCE

const COMMON = `
struct LightDirectionParams{counts:vec4u,angles:vec4f,}
@group(0) @binding(${B.params}) var<uniform> directionParams:LightDirectionParams;
@group(0) @binding(${B.input}) var<storage,read> directionInput:array<vec4u>;
@group(0) @binding(${B.output}) var<storage,read_write> directionOutput:array<vec4u>;
// The direction the sky light's irradiance grows fastest in: the gradient of its first band, the three channels weighed by their luminance,
// turned from the cube's frame to the scene's. Straight up (the scene's up is y) where the sky gives no light.
fn skyDominantDirection()->vec3f{
 let gradient=skyHarmonic(0u).xyz*${RED}+skyHarmonic(1u).xyz*${GREEN}+skyHarmonic(2u).xyz*${BLUE};
 if(!skyLightApplied()||dot(gradient,gradient)<0.0000001){return vec3f(0.0,1.0,0.0);}
 return cubeToScene(normalize(gradient));
}
fn writeDirection(index:u32,direction:vec3f,angle:f32,record:vec4u){
 var aimed=direction;
 if(dot(aimed,aimed)<0.1){aimed=vec3f(0.0,1.0,0.0);}
 let minVisibility=unpack2x16float(record.w).y;
 directionOutput[index]=vec4u(bitcast<vec3u>(aimed),pack2x16float(vec2f(angle,minVisibility)));
}`

/** Where the sky light's diffuse read is bound: group 2 (`LIGHT_DIRECTION_SKY`). */
const SKY = skyLightDiffuseWgsl(LIGHT_DIRECTION_SKY)

const FROM_SKY = `
@compute @workgroup_size(${LIGHT_DIRECTION_GROUP},1,1)
fn lightDirection(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=directionParams.counts.x){return;}
 writeDirection(id.x,skyDominantDirection(),directionParams.angles.x,directionInput[id.x]);
}`

const FROM_LIGHTMAP = `
fn strongestDirection(v:vec4f)->vec3f{
 let direction=vec3f(-v.w,-v.y,v.z);
 return direction/max(length(direction),0.0001);
}
fn luminanceOfHarmonics(r:vec4f,g:vec4f,b:vec4f)->vec4f{
 return r*${RED}+g*${GREEN}+b*${BLUE};
}
@compute @workgroup_size(${LIGHT_DIRECTION_GROUP},1,1)
fn lightDirection(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=directionParams.counts.x){return;}
 let record=directionInput[id.x];
 let uv=vlmBrickUvs(bitcast<vec3f>(record.xyz));
 let coneAngle=directionParams.angles.x;
 var direction:vec3f;
 var angle=coneAngle;
 if(directionParams.counts.y==2u){
  direction=skyDominantDirection();
 }else if(directionParams.counts.y==1u){
  let bent=vlmSkyBentNormal(uv);
  let skyLength=length(bent);
  angle=max(skyLength*directionParams.angles.y*0.5*PI,directionParams.angles.z*PI/180.0);
  direction=bent/max(skyLength,0.0001);
 }else{
  let sh=vlmSh2(uv);
  direction=strongestDirection(luminanceOfHarmonics(sh.r,sh.g,sh.b));
 }
 writeDirection(id.x,direction,angle,record);
}`

/** The program that derives the light directions of the records (the object's position in, the direction and angle out): from the volumetric lightmap
 *  where the session has one, by the sky light's mode (`skyLightMode`); else from the sky light's harmonics, the direction they are strongest in, as the
 *  reference reads them of a movable sky light. */
export const lightDirectionShader = (lightmap: boolean) =>
  wgslProgram(`${COMMON}${lightmap ? FROM_LIGHTMAP : FROM_SKY}`, [
    PI,
    SKY,
    ...(lightmap ? [volumetricLightmapWgsl(1, 0)] : []),
  ])
