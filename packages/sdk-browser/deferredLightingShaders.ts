import { STANDARD_LIGHTING_WGSL } from './standardLighting.ts';
import { DIRECT_LIGHTING_WGSL } from './directLightingWgsl.ts';
import { BOUNCE_APPLY_WGSL } from './bounceApplyWgsl.ts';

export const FULLSCREEN_VERTEX = `@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}`;
/** Last link of every composition: linear radiance carried into display space. */
const SRGB_WGSL = `
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(max(c,vec3f(0.0)),vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}`;
/** Contract curve, applied just before sRGB and never before a blend (P4). */
export const ACES_WGSL = `
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}`;
/** View uniform, shared by both programs and by the water composite: `viewport` carries the
 *  size, the raw-output flag of diagnostic views and the rank of a sampled image
 *  (`directLightSamplingWgsl.ts`); `lightParams` the contract light count, tiles in X and Y, and
 *  exposure, applied before ACES (P4). Nothing else — there is no longer a sky or an ambient to
 *  pass to opaque resolve (P6). */
export const VIEW_WGSL = `struct View{inverseViewProjection:mat4x4f,camera:vec4f,viewport:vec4f,background:vec4f,lightParams:vec4f,}`;
/** World position of a pixel at a depth, reconstructed through that view: the one reading of
 *  the depth buffer every fullscreen pass shares. */
export const WORLD_AT_WGSL = `
fn worldAt(pixel:vec2f,z:f32)->vec3f{
 let ndc=vec4f(pixel.x/view.viewport.x*2.0-1.0,1.0-pixel.y/view.viewport.y*2.0,z,1.0);
 let world=view.inverseViewProjection*ndc;
 return world.xyz/world.w;
}`;
/** The surfaces, their depth and the view: bindings 0 to 5 of every pass that lights a surface
 *  buffer — the deferred resolve, and the water composite on the same numbers. */
export const SURFACE_BINDINGS_WGSL = `
@group(0) @binding(0) var baseMetal:texture_2d<f32>;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var emissiveAo:texture_2d<f32>;
@group(0) @binding(3) var flags:texture_2d<u32>;
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<uniform> view:View;`;
/**
 * Unlit view: material albedo as-is, with no light, no ambient and no emission. This is not
 * a light, it is a diagnostic view — the one geometry benches that compare images pixel for
 * pixel ask for, and the one the engine renders by default as long as no light is declared,
 * because a scene with no source has nothing to light (P6).
 */
export const UNLIT_LIGHTING_SHADER = `
${VIEW_WGSL}
${SURFACE_BINDINGS_WGSL}
${FULLSCREEN_VERTEX}
@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 return vec4f(textureLoad(baseMetal,coord,0).rgb,1.0);
}`;
/** Contract bindings: declared lights, their per-tile lists and their shadow atlas. */
export const CONTRACT_BINDINGS_WGSL = `
@group(0) @binding(6) var<storage,read> directLights:DirectLights;
@group(0) @binding(7) var<storage,read> tileLights:array<u32>;
@group(0) @binding(8) var<storage,read> shadows:ShadowSlices;
@group(0) @binding(9) var shadowAtlas:texture_depth_2d;
@group(0) @binding(10) var shadowSampler:sampler_comparison;`;
/** Shared body of the two contract programs: only the bounce lines separate them. */
const contractSurface = (bounce: string, diagnostic = '') => `
${FULLSCREEN_VERTEX}
${WORLD_AT_WGSL}
@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==1u||flag==3u){return vec4f(base.rgb,1.0);}
 let normal=textureLoad(normalRough,coord,0);let emissive=textureLoad(emissiveAo,coord,0);
 let P=worldAt(pixel.xy,textureLoad(depth,coord,0));
 let V=normalize(view.camera.xyz-P);let N=normalize(normal.xyz);
 ${diagnostic}
 let lit=contractLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a,pixel.xy);
 return vec4f(lit+emissive.rgb${bounce},1.0);
}`;
/**
 * Contract program: deferred resolve lit by the declared lights only, with their shadows.
 * No ambient term, no constant sky, no light written in the scene is added (P6). Surfaces
 * marked unlit or in display space come out as-is, as before: they are materials with no
 * response to light, not lit surfaces.
 */
export const DIRECT_LIGHTING_SHADER = `
${VIEW_WGSL}
${SURFACE_BINDINGS_WGSL}
${CONTRACT_BINDINGS_WGSL}
${STANDARD_LIGHTING_WGSL}
${DIRECT_LIGHTING_WGSL}
${contractSurface('')}`;
/**
 * The same program, plus bounced light: probe irradiance multiplied by the pixel's diffuse
 * albedo, added to the direct. It is a separate program, not a branch, so a session without
 * bounce runs exactly the previous shader, bit for bit.
 */
export const BOUNCE_LIGHTING_SHADER = `
${VIEW_WGSL}
${SURFACE_BINDINGS_WGSL}
${CONTRACT_BINDINGS_WGSL}
${STANDARD_LIGHTING_WGSL}
${DIRECT_LIGHTING_WGSL}
${BOUNCE_APPLY_WGSL}
${contractSurface(
  '+bounceLighting(base.rgb,base.a,N,P,emissive.a)',
  'if(bounceOnly()){return vec4f(bounceIrradiance(N,P,view.lightParams.w),1.0);}',
)}`;
/**
 * Composition, one source for two separate programs — never a branch in the shader.
 * `chaine` is what linear radiance goes through before sRGB, and `courbe` what must be
 * declared for that. Background, premultiplication and the raw output of diagnostic views are shared.
 */
const composeSource = (courbe: string, chaine: string) => `
${VIEW_WGSL}
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${FULLSCREEN_VERTEX}
${SRGB_WGSL}${courbe}
fn composeColor(pixel:vec4f)->vec4f{
 let value=textureLoad(hdr,vec2i(pixel.xy),0);
 if(value.a==0.0){return view.background;}
 if(view.viewport.z!=0.0){return vec4f(value.rgb,1.0);}
 let color=linearToSrgb(${chaine});
 return vec4f(color*value.a+view.background.rgb*(1.0-value.a),1.0);
}
@fragment fn compose(@builtin(position) pixel:vec4f)->@location(0) vec4f{return composeColor(pixel);}
struct DisplayOutput{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn composePresent(@builtin(position) pixel:vec4f)->DisplayOutput{
 let color=composeColor(pixel);
 return DisplayOutput(color,color);
}`;
/**
 * Contract composition: exposure multiplies linear radiance before ACES, last link of the
 * chain (P4). That is the one of programs lit by declared lights.
 */
export const COMPOSE_SHADER = composeSource(
  ACES_WGSL,
  'aces(value.rgb*view.lightParams.w/max(value.a,1e-6))',
);
/**
 * Unlit-view composition: identity, from linear to sRGB and nothing else. With no declared
 * source there is no radiance to expose or bring into the display range (P6) — albedo is
 * read as-is, which is what benches that compare images pixel for pixel ask for.
 */
export const UNLIT_COMPOSE_SHADER = composeSource('', 'value.rgb/max(value.a,1e-6)');
