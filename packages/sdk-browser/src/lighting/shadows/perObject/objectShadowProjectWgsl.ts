import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { viewDepthOfDevice } from '../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { VSM_SUN_MASK_FORMAT } from '../vsm/projection/maskFormat.ts'

/**
 * THE PROJECTION OF THE TRANSLUCENT OBJECT SHADOWS: where a light's shadow is projected onto the opaque surfaces, each subject of the light is
 * read back. The pixel's place in the world (from the scene depth) is carried into the subject's light frame (`Subject.clip`); inside the
 * subject's rectangle the two coefficient targets give the density the translucent casters add along the ray to the light up to the pixel's
 * depth (a Fourier series of the opacity, its high terms damped against ringing), and the transmission is the exponential of minus that
 * density. The shadow fades with the subject's own fade and, for a sun, past the end of the subject's depth range; the subjects of a light
 * combine by their minimum. The depth the casters were drawn at is the normalized distance from the light, 0 at the subject's near end.
 */

export const OBJECT_SHADOW_PROJECT_BINDINGS = {
  params: 0,
  subjects: 1,
  coefficients0: 2,
  coefficients1: 3,
  sampler: 4,
  depth: 5,
  sunMask: 8,
} as const

/** Words of the per-draw uniform: the clip-to-view matrix, the view-to-world rotation, the viewport, the depth terms and the subject range. */
export const OBJECT_SHADOW_PARAM_FLOATS = 16 + 16 + 4 + 4 + 4
/** Words of one subject's record: the clip matrix, the offset into the light's translated space, the rectangle's scale and offset, the depth terms, the interior. */
export const OBJECT_SHADOW_SUBJECT_FLOATS = 16 + 4 + 4 + 4 + 4

const B = OBJECT_SHADOW_PROJECT_BINDINGS

/**
 * THE FOURIER SERIES OF THE SUBJECTS' DENSITY, read back by the projection onto the opaque surfaces and by the translucent surfaces' own shadow
 * (`blend/objectShadow/objectShadowSelfWgsl.ts`): from a texel of the two coefficient layers (the cosines, then the sines) and the normalized depth, the
 * density the casters add along the ray to the light up to that depth: the integral at depth 0 times the depth over two, plus the first three harmonics,
 * their high terms damped against ringing.
 */
export const OBJECT_SHADOW_SERIES_WGSL = wgslBlock(
  'OBJECT_SHADOW_SERIES_WGSL',
  [TWO_PI],
  `const RINGING_FACTOR=1.0;
const RINGING_TERMS=8.0;
fn objectShadowSeries(cosines:vec4f,sines:vec4f,depth:f32)->f32{
 let frequencies=TWO_PI*vec3f(1.0,2.0,3.0);
 let terms=vec3f(1.0,2.0,3.0)/RINGING_TERMS;
 let scales=exp(-RINGING_FACTOR*terms*terms)/frequencies;
 let waves=frequencies*depth;
 let sinWave=sin(waves);
 let cosWave=1.0-cos(waves);
 return cosines.x*depth*0.5+dot(sinWave*cosines.yzw*scales,vec3f(1.0))+dot(cosWave*sines.yzw*scales,vec3f(1.0));
}`,
)

const CORE = wgslBlock(
  'OBJECT_SHADOW_PROJECT_WGSL',
  [OBJECT_SHADOW_SERIES_WGSL, viewDepthOfDevice, hizDepthWgsl(0, B.depth)],
  `
struct ObjectShadowParams{
 clipToView:mat4x4f,
 viewToWorld:mat4x4f,
 viewport:vec4f,
 depthTerms:vec4f,
 range:vec4f,
}
struct ObjectShadowSubject{
 clip:mat4x4f,
 origin:vec4f,
 tile:vec4f,
 depth:vec4f,
 interior:vec4f,
}
@group(0) @binding(${B.params}) var<uniform> shadowParams:ObjectShadowParams;
@group(0) @binding(${B.subjects}) var<storage,read> shadowSubjects:array<ObjectShadowSubject>;
@group(0) @binding(${B.coefficients0}) var coefficients0:texture_2d<f32>;
@group(0) @binding(${B.coefficients1}) var coefficients1:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var coefficientSampler:sampler;
fn objectShadowNdc(pixel:vec2f)->vec2f{
 let v=shadowParams.viewport;
 return vec2f(2.0*(pixel.x-v.x)/v.z-1.0,1.0-2.0*(pixel.y-v.y)/v.w);
}
fn objectShadowViewXY(ndc:vec2f,depth:f32)->vec2f{
 let p=shadowParams.clipToView*vec4f(ndc,0.5,1.0);
 if(shadowParams.range.w<0.5){return p.xy/p.w;}
 let v=p.xyz/p.w;
 return v.xy/(-v.z)*depth;
}
// The density the casters add along the ray to the light, up to the normalized depth.
fn objectShadowDensity(uv:vec2f,depth:f32)->f32{
 let cosines=textureSampleLevel(coefficients0,coefficientSampler,uv,0.0);
 let sines=textureSampleLevel(coefficients1,coefficientSampler,uv,0.0);
 return objectShadowSeries(cosines,sines,depth);
}
// The visibility of the surface at the pixel against the subjects of the draw: 1 unshadowed.
fn objectShadowVisibility(pixel:vec2f)->f32{
 let z=hizOpaqueDepth(vec2i(pixel));
 // Reverse depth: a pixel that holds no surface reads 0.
 if(z<=0.0){return 1.0;}
 let depth=viewDepthOfDevice(shadowParams.depthTerms,z);
 let view=vec4f(objectShadowViewXY(objectShadowNdc(pixel),depth),-depth,0.0);
 // The pixel's offset from the eye, in centimetres.
 let relative=(shadowParams.viewToWorld*view).xyz*100.0;
 var visibility=1.0;
 let first=u32(shadowParams.range.x);
 for(var k=0u;k<u32(shadowParams.range.y);k++){
  let s=shadowSubjects[first+k];
  let c=s.clip*vec4f(relative+s.origin.xyz,1.0);
  if(c.w<=0.0){continue;}
  let ndc=c.xy/c.w;
  let uv=vec2f(ndc.x*s.tile.x+s.tile.z,-ndc.y*s.tile.y+s.tile.w);
  if(any(uv<s.interior.xy)||any(uv>s.interior.zw)){continue;}
  let shadowZ=1.0-c.z*s.depth.x;
  let transmission=clamp(exp(-objectShadowDensity(uv,saturate(shadowZ))),0.0,1.0);
  let beyond=1.0-saturate((shadowZ-s.depth.z)*s.depth.w);
  visibility=min(visibility,mix(1.0,transmission,s.depth.y*beyond));
 }
 return visibility;
}`,
)

const LOCAL_WGSL = wgslBlock(
  'OBJECT_SHADOW_PROJECT_LOCAL_WGSL',
  [CORE],
  `
@vertex
fn objectShadowVertex(@builtin(vertex_index) corner:u32)->@builtin(position) vec4f{
 var quad=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
 return vec4f(quad[corner],0.0,1.0);
}
// A light's layer holds the square root of its visibility in every channel; the draw takes the minimum.
@fragment
fn objectShadowFragment(@builtin(position) position:vec4f)->@location(0) vec4f{
 return vec4f(sqrt(objectShadowVisibility(position.xy)));
}`,
)

const SUN_WGSL = wgslBlock(
  'OBJECT_SHADOW_PROJECT_SUN_WGSL',
  [CORE],
  `
@group(0) @binding(${B.sunMask}) var sunMask:texture_storage_2d_array<${VSM_SUN_MASK_FORMAT},read_write>;
@compute @workgroup_size(8,8,1)
fn objectShadowSun(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(sunMask);
 if(id.x>=size.x||id.y>=size.y){return;}
 let layer=i32(shadowParams.range.z);
 let held=textureLoad(sunMask,id.xy,layer).x;
 let shadow=objectShadowVisibility(vec2f(id.xy)+vec2f(0.5));
 if(shadow<held){textureStore(sunMask,id.xy,layer,vec4f(shadow,0.0,0.0,0.0));}
}`,
)

/** The program that projects a local light's subjects into its layer of the per-light mask. */
export const objectShadowLocalShader = () => wgslProgram('', [LOCAL_WGSL])
/** The program that projects a sun's subjects into its layer of the suns' mask. */
export const objectShadowSunShader = () => wgslProgram('', [SUN_WGSL])
