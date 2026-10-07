/**
 * The shipped direct-lighting resolve (`directLightingWgsl`, narrow or wide) in one compute pass:
 * each thread shades one sample through `contractLighting` — the function the deferred program
 * calls per pixel —, on the cell whose record starts the list buffer, with the resolve's own
 * bindings on the engine's numbers, and writes the f32 sum's bits. Only the entry points are the
 * proofs' (`narrow-resolve.gpu.ts`, `sampled-resolve.gpu.ts`).
 */
import { directLightingWgsl } from '../../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../../../packages/sdk-browser/src/lighting/standardLighting.ts'
import { wgslModule } from '../../../packages/math/src/wgsl/assemble.ts'
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

/** The shipped resolve, or with `per` its light term on the surface taken again per light. */
function lighting(
  narrow: boolean,
  shadowed: boolean,
  rects: boolean,
  lobes: boolean,
  per: boolean,
) {
  // The lights with the standard lobe they shade with, each declaration once.
  const shipped = wgslModule(
    directLightingWgsl({ narrow, unshadowed: !shadowed, rectless: !rects, lobeless: !lobes }),
    STANDARD_LIGHTING_WGSL,
  )
  const term = '(surfaceLight(shading,N,V,'
  if (!per) return shipped
  if (lobes || shipped.split(term).length !== 2) throw new Error('PER_LIGHT_TERM_UNMATCHED')
  return shipped.replace(term, '(standardLighting(rgb,metal,rough,N,V,')
}

/** With `lobes`, the program with the anisotropic and clear-coat lobes (`lobesWgsl.ts`) and its two
 *  entries that set a sample's lobes by hand (`LOBE_ENTRIES_WGSL`). With `perLight`, the program
 *  without them whose lights each take what the pixel's lights share of its surface again
 *  (`standardLighting`), as before it was taken once a pixel (`lobeSurface`). */
export const resolveHarness = (
  narrow: boolean,
  shadowed = true,
  rects = true,
  lobes = false,
  perLight = false,
) => `
${VIEW_WGSL.text}
@group(0) @binding(5) var<uniform> view:View;
${CONTRACT_BINDINGS_WGSL.text}
${lighting(narrow, shadowed, rects, lobes, perLight)}${lobes ? LOBE_ENTRIES_WGSL : ''}
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

/** A sample's light through the lobes program, its lobes set by hand (\`setLobes\`): \`zeroLobes\`, lobes on with
 *  no strength and no coat — what a pixel whose maps zeroed both would read, were it marked —;
 *  \`isoAniso\`, the anisotropic lobe at a strength whose αt rounds to α, along a tangent of the
 *  normal: the isotropic lobe written in the anisotropic form. */
const LOBE_ENTRIES_WGSL = `
// The harness lights no mirror term: the coat's (\`lobeMirror\`) reads none.
fn surfaceMirrorLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{return vec3f(0.0);}
fn lobeSample(s:Sample)->vec3f{
 return contractLighting(s.albedoMetal.rgb,s.albedoMetal.a,s.normalRough.a,normalize(s.normalRough.xyz),normalize(s.eyeFlag.xyz),s.pointAo.xyz,s.pointAo.w,vec2f(${SAMPLE_PIXEL.join(',')}),0u,cellShadowed(0u));
}
@compute @workgroup_size(64)
fn zeroLobes(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&samples)){return;}
 let s=samples[id.x];
 surfaceModel=u32(s.eyeFlag.w);
 shadowFootprint=0.01;
 let N=normalize(s.normalRough.xyz);
 setLobes(vec3f(0.0,0.0,1.0),0.0,0.0,0.5,N,N,normalize(s.eyeFlag.xyz),s.normalRough.a);
 sums[id.x]=vec4u(bitcast<vec3u>(lobeSample(s)),0u);
}
@compute @workgroup_size(64)
fn isoAniso(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&samples)){return;}
 let s=samples[id.x];
 surfaceModel=u32(s.eyeFlag.w);
 shadowFootprint=0.01;
 let N=normalize(s.normalRough.xyz);
 let T=normalize(cross(select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(N.y)>0.9),N));
 setLobes(T,1e-6,0.0,0.5,N,N,normalize(s.eyeFlag.xyz),s.normalRough.a);
 sums[id.x]=vec4u(bitcast<vec3u>(lobeSample(s)),0u);
}`
