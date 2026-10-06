/**
 * The shipped direct-lighting resolve (`directLightingWgsl`, narrow or wide) in one compute pass:
 * each thread shades one sample through `contractLighting` — the function the deferred program
 * calls per pixel —, on the cell whose record starts the list buffer, with the resolve's own
 * bindings on the engine's numbers, and writes the f32 sum's bits. Only the entry points are the
 * proofs' (`narrow-resolve.gpu.ts`, `sampled-resolve.gpu.ts`).
 */
import { directLightingWgsl } from '../../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../../../packages/sdk-browser/src/lighting/standardLighting.ts'
import {
  CONTRACT_BINDINGS_WGSL,
  VIEW_WGSL,
} from '../../../packages/sdk-browser/src/lighting/deferred/shaders.ts'

/** Floats of a sample: albedo and metal, normal and roughness, point and occlusion, eye
 *  direction and surface flag. */
export const SAMPLE_FLOATS = 16
/** The harness's two bindings, past the resolve's own. */
export const SAMPLES_BINDING = 30
export const SUMS_BINDING = 31
/** The pixel every sample is shaded at: the drawn resolve's offset reads it. */
const SAMPLE_PIXEL = [1.5, 2.5]

export const resolveHarness = (narrow: boolean, shadowed = true, rects = true) => `
${VIEW_WGSL}
@group(0) @binding(5) var<uniform> view:View;
${CONTRACT_BINDINGS_WGSL}
${STANDARD_LIGHTING_WGSL}
${directLightingWgsl(narrow, shadowed, rects)}
struct Sample{albedoMetal:vec4f,normalRough:vec4f,pointAo:vec4f,eyeFlag:vec4f,}
@group(0) @binding(${SAMPLES_BINDING}) var<storage,read> samples:array<Sample>;
@group(0) @binding(${SUMS_BINDING}) var<storage,read_write> sums:array<vec4u>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&samples)){return;}
 let s=samples[id.x];
 surfaceModel=u32(s.eyeFlag.w);
 shadowFootprint=0.01;
 let lit=contractLighting(s.albedoMetal.rgb,s.albedoMetal.a,s.normalRough.a,normalize(s.normalRough.xyz),normalize(s.eyeFlag.xyz),s.pointAo.xyz,s.pointAo.w,vec2f(${SAMPLE_PIXEL.join(',')}),0u,cellShadowed(0u));
 sums[id.x]=vec4u(bitcast<vec3u>(lit),0u);
}
/** The drawn resolve alone, whatever the list holds: \`sampledSliceLighting\` at the view's rank,
 *  the full-list function the sampled resolve is proved against (\`sampled-resolve.gpu.ts\`). */
@compute @workgroup_size(64)
fn drawn(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&samples)){return;}
 let s=samples[id.x];
 surfaceModel=u32(s.eyeFlag.w);
 shadowFootprint=0.01;
 // A list the draw refuses — within the budget, past \`TILE_LIGHTS\` — is summed in full, as it was.
 let slice=cellSlice(0u);
 var lit=vec3f(0.0);
 let N=normalize(s.normalRough.xyz);let V=normalize(s.eyeFlag.xyz);
 if(sampledList(slice.y)){lit=sampledSliceLighting(s.albedoMetal.rgb,s.albedoMetal.a,s.normalRough.a,N,V,s.pointAo.xyz,s.pointAo.w,slice,u32(view.viewport.w),vec2f(${SAMPLE_PIXEL.join(',')}));}
 else{lit=sliceLighting(s.albedoMetal.rgb,s.albedoMetal.a,s.normalRough.a,N,V,s.pointAo.xyz,s.pointAo.w,slice);}
 sums[id.x]=vec4u(bitcast<vec3u>(lit),0u);
}`
