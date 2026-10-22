import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DIVISOR_FLOOR } from '../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { DEPTH_WGSL } from '../../post/taa/depthWgsl.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { AO_BINDINGS, AO_PARAMS } from './layout.ts'
import { AO_BASIS_SIDE, AO_RANDOM_BASIS } from './tables.ts'

/** Stored depths are divided by this so the half-precision setup texture holds them (in centimetres):
 *  4096 · 32, the reference's own scale. */
export const AO_DEPTH_SCALE = 4096 * 32
/** The farthest distance a depth is read as, in centimetres: a pixel with no surface (depth 0) reads this far,
 *  never beyond what the setup texture's half floats hold over the scale above. */
export const AO_FAR_CM = 1e7 * CENTIMETRES_PER_METRE

/** A table of vec2 constants as a function of its index (`name(i)`): a branch a row, no array to index. */
export const vec2Table = (name: string, rows: readonly (readonly [number, number])[]) =>
  `fn ${name}(i:u32)->vec2f{\n${rows
    .map(([x, y], at) => ` if(i==${at}u){return vec2f(${wgslF32(x)},${wgslF32(y)});}`)
    .join('\n')}\n return vec2f(0.0);\n}`

/**
 * WHAT EVERY PASS OF THE OCCLUSION DECLARES: its uniform (`AoParams`, named `view` as the depth terms of the temporal
 * passes expect, `DEPTH_WGSL`), the depth the image drew with its furthest-depth pyramid, the surfaces' normals, the
 * half-size depth map, the setup texture it reads and the coarser occlusion (`AO_BINDINGS`); a device depth as a
 * distance in centimetres (`aoDepthCm`, the engine's one conversion, `sceneDepthOf`, held to what the half floats
 * of the setup hold), a pixel's own depth and its surface's normal, and the depth a tap reads (`aoPyramidDepth`):
 * one texel of the half-size map — the farthest opaque depth of a block of two pixels, the cell held to the
 * image's, made from the opaque depth alone, for the engine's pyramid folds in the transparents' front, which an
 * occlusion of the opaque surfaces must not see —, or, where the climb of the samples asks a level of detail
 * from one half up, a cell of the engine's coarser levels; and the noise block's direction for a pixel
 * (`aoNoise`).
 */
export const AO_COMMON_WGSL = wgslBlock(
  'AO_COMMON_WGSL',
  [hizDepthWgsl(0, AO_BINDINGS.depth), DEPTH_WGSL, DIVISOR_FLOOR],
  `${AO_PARAMS.wgsl}
@group(0) @binding(${AO_BINDINGS.params}) var<uniform> view:AoParams;
@group(0) @binding(${AO_BINDINGS.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${AO_BINDINGS.half}) var halfDepth:texture_2d<f32>;
@group(0) @binding(${AO_BINDINGS.setup}) var setupTex:texture_2d<f32>;
@group(0) @binding(${AO_BINDINGS.lower}) var lowerAo:texture_2d<f32>;
const AO_DEPTH_SCALE:f32=${wgslF32(AO_DEPTH_SCALE)};
fn aoDepthCm(z:f32)->f32{return min(sceneDepthOf(z)*${wgslF32(CENTIMETRES_PER_METRE)},${wgslF32(AO_FAR_CM)});}
fn aoSceneDepth(pixel:vec2i)->f32{return aoDepthCm(hizOpaqueDepth(pixel));}
fn aoSafeNormalize(v:vec3f,fallback:vec3f)->vec3f{
 let l=length(v);
 return select(fallback,v/max(l,DIVISOR_FLOOR),l>1e-6);
}
fn aoSurfaceNormal(pixel:vec2i)->vec3f{
 return aoSafeNormalize(textureLoad(normals,pixel,0).xyz,vec3f(0.0,0.0,1.0));
}
fn aoPyramidDepth(ndc:vec2f,lod:f32)->f32{
 let pixel=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*view.lens.zw;
 let level=clamp(i32(floor(max(lod,0.0)+0.5)),0,max(hizLevelCount()-2,0));
 if(level==0){
  let last=vec2i(ceil(view.lens.zw*0.5))-vec2i(1);
  return textureLoad(halfDepth,clamp(vec2i(floor(pixel*0.5)),vec2i(0),last),0).a*AO_DEPTH_SCALE;
 }
 return aoDepthCm(hizCellCullFarthest(vec2i(floor(pixel/exp2(f32(level+1)))),level+1));
}
${vec2Table('aoBasis', AO_RANDOM_BASIS)}
fn aoNoise(pixel:vec2i)->vec2f{
 let t=vec2i(floor(vec2f(pixel)+vec2f(0.5)+view.noise.xy));
 return aoBasis(u32(t.x&${AO_BASIS_SIDE - 1})+${AO_BASIS_SIDE}u*u32(t.y&${AO_BASIS_SIDE - 1}));
}`,
)
