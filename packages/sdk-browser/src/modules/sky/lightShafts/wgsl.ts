import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { LIGHT_SHAFT_BLUR_SAMPLES } from '../../../../../sdk-core/src/modules/sky/lightShafts.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { DEVICE_DEPTH_FLOOR } from '../clouds/reconstructLayout.ts'

/**
 * The light shafts' uniform, one for every pass, written by the pass:
 * - `bounds`: the shafts' image bounds, `(minX, minY, maxX, maxY)` in texture coordinates;
 * - `aspect`: the image's aspect ratio in `xy`, its inverse in `zw`;
 * - `light`: `1 / occlusion depth range` (per metre) in `x`, the bloom scale in `y`, the occlusion
 *   darkness in `w`;
 * - `tint`: the bloom tint in `xyz`, the bloom threshold in `w`;
 * - `origin`: the light's place in the image's coordinates, aspect-corrected, in `xy`, the bloom's
 *   largest brightness in `z`, the exposure in `w`;
 * - `radial`: the blur's samples in `x`, the first pass's distance in `y`, the pass's index in `z`;
 * - `uv`: the texture coordinates per pixel written, in `xy` (`lightShaftUvPerPixel`);
 * - `depthTerms`: the perspective's device depth terms (`lightShaftDepthTerms`);
 * - `scene`: the scene's texture size in `xy`, its inverse in `zw`.
 */
export const LIGHT_SHAFT_VIEW = fieldLayout('LightShaftView', [
  ['bounds', 'vec4f'],
  ['aspect', 'vec4f'],
  ['light', 'vec4f'],
  ['tint', 'vec4f'],
  ['origin', 'vec4f'],
  ['radial', 'vec4f'],
  ['uv', 'vec4f'],
  ['depthTerms', 'vec4f'],
  ['scene', 'vec4f'],
] as const)

/** Where the passes bind what they read, in group 0: the uniform; the image read (the scene's
 *  colour, or the shafts'); the sampler; the scene's depth. */
export const LIGHT_SHAFT_BINDING = { view: 0, source: 1, sampler: 2, depth: 3 } as const

/** The passes' fragment entries: the reductions, the radial blur, the occlusion's end, the bloom's. */
export const LIGHT_SHAFT_ENTRY = {
  vertex: 'fullscreen',
  occlusion: 'downsampleOcclusionMain',
  bloom: 'downsampleBloomMain',
  blur: 'blurMain',
  finish: 'finishOcclusionMain',
  apply: 'applyBloomMain',
} as const

const B = LIGHT_SHAFT_BINDING
const E = LIGHT_SHAFT_ENTRY

/** The mask that is 1 at the image's edges and 0 at its centre, to the fourth power. */
const EDGE = `fn edgeMask(uv:vec2f)->f32{
 let n=(uv-view.bounds.xy)/view.bounds.zw;
 let e=1.0-n.x*(1.0-n.x)*n.y*(1.0-n.y)*8.0;
 return e*e*e*e;
}`

const BODY = `
${LIGHT_SHAFT_VIEW.wgsl}
@group(0) @binding(${B.view}) var<uniform> view:LightShaftView;
@group(0) @binding(${B.source}) var source:texture_2d<f32>;
@group(0) @binding(${B.sampler}) var linearSampler:sampler;
@group(0) @binding(${B.depth}) var sceneDepth:texture_depth_2d;
fn uvOf(position:vec4f)->vec2f{return position.xy*view.uv.xy;}
${EDGE}
fn sceneTexel(uv:vec2f)->vec2i{
 return clamp(vec2i(floor(uv*view.scene.xy)),vec2i(0),vec2i(view.scene.xy)-vec2i(1));
}
/** The distance along the view axis of the pixel at \`uv\`, in metres: the device depth inverted. */
fn sceneDistance(uv:vec2f)->f32{
 let z=max(textureLoad(sceneDepth,sceneTexel(uv),0),DEVICE_DEPTH_FLOOR);
 let t=view.depthTerms;
 return (t.w*z-t.y)/(t.x-t.z*z);
}
@fragment fn ${E.occlusion}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let uv=uvOf(position);
 let occlusion=saturate(sceneDistance(uv)*view.light.x);
 return vec4f(max(occlusion,edgeMask(uv)),1.0,1.0,1.0);
}
@fragment fn ${E.bloom}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let uv=uvOf(position);
 let sceneColour=textureLoad(source,sceneTexel(uv),0).rgb*view.origin.w;
 let reach=sceneDistance(uv);
 let edge=edgeMask(uv);
 let luminance=max(dot(sceneColour,vec3f(0.3,0.59,0.11)),6.10352e-5);
 let adjusted=clamp(luminance-view.tint.w,0.0,view.origin.z);
 let colour=view.light.y*sceneColour/luminance*adjusted*2.0;
 let depthMask=saturate((reach-0.5/view.light.x)*view.light.x);
 let originMask=1.0-saturate(length(view.origin.xy-uv*view.aspect.zw)*2.0);
 return vec4f(colour*view.tint.xyz*depthMask*(1.0-edge)*originMask*originMask,1.0);
}
@fragment fn ${E.blur}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let uv=uvOf(position);
 let count=${LIGHT_SHAFT_BLUR_SAMPLES};
 let aspectUv=uv*view.aspect.zw;
 let passScale=pow(0.4*f32(count),view.radial.z);
 let blur=(view.origin.xy-aspectUv)*min(view.radial.y*passScale,1.0);
 var sum=vec3f(0.0);
 for(var i=0;i<count;i++){
  let at=(aspectUv+blur*f32(i)/f32(count))*view.aspect.xy;
  sum+=textureSampleLevel(source,linearSampler,clamp(at,view.bounds.xy,view.bounds.zw),0.0).xyz;
 }
 return vec4f(sum/f32(count),1.0);
}
@fragment fn ${E.finish}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let uv=uvOf(position);
 let occlusion=textureSampleLevel(source,linearSampler,uv,0.0).x;
 var shaded=mix(view.light.w,1.0,occlusion*occlusion);
 shaded=mix(shaded,1.0,saturate(length(view.origin.xy-uv*view.aspect.zw)*0.2));
 return vec4f(shaded,1.0,1.0,1.0);
}
@fragment fn ${E.apply}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let uv=clamp(uvOf(position),view.bounds.xy,view.bounds.zw);
 return vec4f(textureSampleLevel(source,linearSampler,uv,0.0).rgb/view.origin.w,1.0);
}
`

/** The passes' whole shader text: one module, each pass naming its fragment entry. */
export const lightShaftProgram = wgslProgram(BODY, [FULLSCREEN_VERTEX, DEVICE_DEPTH_FLOOR])

/** The mask's view, the fog's uniform: the bounds of the mask's reads, `(minX, minY, maxX, maxY)` in texture
 *  coordinates (`lightShaftBounds`), and the scene's texture size in `xy`, its inverse in `zw`. */
export const LIGHT_SHAFT_MASK_VIEW = fieldLayout('LightShaftMaskView', [
  ['bounds', 'vec4f'],
  ['scene', 'vec4f'],
] as const)

/**
 * What the fog needs of the occlusion mask, as a block of WGSL over the resources the fog's program
 * binds in `group`: the mask's texture at `binding.texture`, its sampler (bilinear, clamped) at
 * `binding.sampler` and `LightShaftMaskView` at `binding.view` (`LIGHT_SHAFT_MASK_VIEW`).
 * `lightShaftMask(pixel)` answers the factor to multiply the fog's inscattering by, for the view
 * pixel `pixel` (its centre): the pixel over the scene's texture size is read from the mask, kept
 * to the bounds of the mask's view.
 */
export const lightShaftMaskWgsl = (
  group: number,
  binding: { readonly texture: number; readonly sampler: number; readonly view: number },
): WgslDecl =>
  wgslBlock(
    `lightShaftMaskWgsl(${group},${binding.texture},${binding.sampler},${binding.view})`,
    [],
    `${LIGHT_SHAFT_MASK_VIEW.wgsl}
@group(${group}) @binding(${binding.texture}) var lightShaftMaskTexture:texture_2d<f32>;
@group(${group}) @binding(${binding.sampler}) var lightShaftMaskSampler:sampler;
@group(${group}) @binding(${binding.view}) var<uniform> lightShaftMaskView:LightShaftMaskView;
fn lightShaftMask(pixel:vec2f)->f32{
 let uv=clamp(pixel*lightShaftMaskView.scene.zw,lightShaftMaskView.bounds.xy,lightShaftMaskView.bounds.zw);
 return textureSampleLevel(lightShaftMaskTexture,lightShaftMaskSampler,uv,0.0).x;
}`,
  )
