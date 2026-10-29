import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { WATER_BINDINGS, WATER_GROUP } from './waterLayout.ts'
import { WATER_MATH_WGSL } from './waterMathWgsl.ts'
import { waterTileVertexWgsl } from './waterTileWgsl.ts'

/**
 * THE WATER PASS'S GROUP in the blend module (`waterLayout.ts`), the draw of its tiles and its two reads of the copy of the
 * scene without the water: the bilateral read of its depth and of its colour.
 *
 * `waterBehind` reads the depth at four texels about `uv` by one gather, weighed bilinearly and by
 * what the surface's depth says: a texel nearer the eye than the water's surface by more than the
 * surface's slope across the pixel belongs to something in front of the water and weighs nothing, and
 * so does one the mask says is no water. The weights are normalised; their sum too small, all
 * zero, which says the read found nothing. Depths are linear (the clip w), in metres, and held
 * finite so that a weight of zero kills the sky's. `mask` is each texel's share of the refraction.
 * `waterBehindColor` reads the colour of the same texels by the same weights.
 */
export const WATER_COMMON_WGSL = wgslBlock(
  'WATER_COMMON_WGSL',
  [WATER_MATH_WGSL, waterTileVertexWgsl(WATER_GROUP, WATER_BINDINGS.tiles)],
  `@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.params}) var<uniform> water:WaterParams;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.color}) var waterColor:texture_2d<f32>;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.depth}) var waterDepth:texture_2d<f32>;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.mask}) var waterMask:texture_2d<f32>;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.point}) var waterPoint:sampler;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.normals}) var waterNormals:texture_2d<f32>;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.specular}) var waterSpecular:texture_2d<f32>;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.waterDepth}) var waterDepthTexture:texture_depth_2d;
@group(${WATER_GROUP}) @binding(${WATER_BINDINGS.sun}) var waterSun:texture_2d<f32>;
struct WaterBehind{depth:f32,weights:vec4f,mask:vec4f,}
fn waterBehind(uv:vec2f,surfaceDepth:f32,slope:f32)->WaterBehind{
 let at=uv+(0.5/256.0)*water.scene.zw;
 let d4=min(textureGather(0,waterDepth,waterPoint,at),vec4f(WATER_FAR));
 let t=fract(at*water.scene.xy-0.5);
 let bilinear=vec4f((1.0-t.x)*t.y,t.x*t.y,t.x*(1.0-t.y),(1.0-t.x)*(1.0-t.y));
 var keep=select(vec4f(0.0),vec4f(1.0),(d4+vec4f(slope))>=vec4f(surfaceDepth));
 var share=vec4f(1.0);
 if(water.modes.y!=0u){
  let packed=textureGather(0,waterMask,waterPoint,at);
  let isWater=packed>=vec4f(WATER_MASK_IS_WATER);
  share=select(vec4f(0.0),(packed-vec4f(WATER_MASK_IS_WATER))/WATER_MASK_REFRACTION,isWater);
  keep*=select(vec4f(0.0),vec4f(1.0),isWater);
 }
 var w=bilinear*keep;
 let total=w.x+w.y+w.z+w.w;
 w*=select(0.0,1.0/total,total>1e-5);
 return WaterBehind(dot(d4,w),w,share);
}
fn waterBehindColor(uv:vec2f,weights:vec4f)->vec3f{
 let at=uv+(0.5/256.0)*water.scene.zw;
 return vec3f(
  dot(textureGather(0,waterColor,waterPoint,at),weights),
  dot(textureGather(1,waterColor,waterPoint,at),weights),
  dot(textureGather(2,waterColor,waterPoint,at),weights));
}
`,
)
