import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { AO_BINDINGS, AO_PARAMS } from './layout.ts'
import { AO_BASIS_SIDE, AO_RANDOM_BASIS } from './tables.ts'

/** Stored depths are divided by this so the half-precision setup texture holds them (in centimetres):
 *  4096 · 32, the reference's own scale. */
const AO_DEPTH_SCALE = 4096 * 32
/** The farthest distance a depth is read as, in metres: a pixel with no surface (depth 0) reads this far,
 *  never beyond what the setup texture's half floats hold. */
const AO_FAR_METRES = 1e7

/** A table of vec2 constants as a function of its index (`name(i)`): a branch a row, no array to index. */
export const vec2Table = (name: string, rows: readonly (readonly [number, number])[]) =>
  `fn ${name}(i:u32)->vec2f{\n${rows
    .map(([x, y], at) => ` if(i==${at}u){return vec2f(${wgslF32(x)},${wgslF32(y)});}`)
    .join('\n')}\n return vec2f(0.0);\n}`

/**
 * WHAT EVERY PASS OF THE OCCLUSION DECLARES: its uniform (`AoParams`), the depth the image drew with its
 * furthest-depth pyramid, the surfaces' normals, the setup texture it reads and the coarser occlusion
 * (`AO_BINDINGS`); a device depth as a distance in centimetres (`aoDepthCm`: `near / z` under the engine's
 * perspective, linear under an orthographic one), a pixel's own depth and its surface's normal, the depth
 * of the cell of the furthest-depth pyramid under a screen position at a level of detail (`aoPyramidDepth`: its
 * first level is the farthest depth of a block of two pixels, the cell held to the image's, read from the opaque depth alone — the pyramid
 * the engine builds folds in the transparents' front, which an occlusion of the opaque surfaces must not see —; a
 * level of detail from one half up reads the engine's coarser levels), and the noise block's direction for a
 * pixel (`aoNoise`).
 */
export const AO_COMMON_WGSL = wgslBlock(
  'AO_COMMON_WGSL',
  [hizDepthWgsl(0, AO_BINDINGS.depth)],
  `${AO_PARAMS.wgsl}
@group(0) @binding(${AO_BINDINGS.params}) var<uniform> ao:AoParams;
@group(0) @binding(${AO_BINDINGS.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${AO_BINDINGS.setup}) var setupTex:texture_2d<f32>;
@group(0) @binding(${AO_BINDINGS.lower}) var lowerAo:texture_2d<f32>;
const AO_DEPTH_SCALE:f32=${wgslF32(AO_DEPTH_SCALE)};
fn aoDepthCm(z:f32)->f32{
 let distance=select(ao.depth.y+(1.0-z)*ao.depth.x,ao.depth.x/max(z,1e-30),ao.depth.z>0.5);
 return min(distance,${wgslF32(AO_FAR_METRES)})*${wgslF32(CENTIMETRES_PER_METRE)};
}
fn aoSceneDepth(pixel:vec2i)->f32{return aoDepthCm(hizOpaqueDepth(pixel));}
fn aoSafeNormalize(v:vec3f,fallback:vec3f)->vec3f{
 let l=length(v);
 return select(fallback,v/max(l,1e-20),l>1e-6);
}
fn aoSurfaceNormal(pixel:vec2i)->vec3f{
 return aoSafeNormalize(textureLoad(normals,pixel,0).xyz,vec3f(0.0,0.0,1.0));
}
fn aoPyramidDepth(ndc:vec2f,lod:f32)->f32{
 let pixel=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*ao.lens.zw;
 let level=clamp(i32(floor(max(lod,0.0)+0.5)),0,max(hizLevelCount()-2,0));
 let cell=vec2i(floor(pixel/exp2(f32(level+1))));
 if(level==0){
  let last=vec2i(ceil(vec2f(hizLevels.level[0].yz)*0.5))-vec2i(1);
  let base=clamp(cell,vec2i(0),last)*2;
  let z=min(min(hizOpaqueDepth(base),hizOpaqueDepth(base+vec2i(1,0))),min(hizOpaqueDepth(base+vec2i(0,1)),hizOpaqueDepth(base+vec2i(1,1))));
  return aoDepthCm(z);
 }
 return aoDepthCm(hizCellCullFarthest(cell,level+1));
}
${vec2Table('aoBasis', AO_RANDOM_BASIS)}
fn aoNoise(pixel:vec2i)->vec2f{
 let t=vec2i(floor(vec2f(pixel)+vec2f(0.5)+ao.noise.xy));
 return aoBasis(u32(t.x&${AO_BASIS_SIDE - 1})+${AO_BASIS_SIDE}u*u32(t.y&${AO_BASIS_SIDE - 1}));
}`,
)
