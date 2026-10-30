import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { WORLD_AT_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { dfshCommonWgsl } from '../../../distanceField/shadow/commonWgsl.ts'
import { DFSH_MAX_LIGHTS } from '../../../distanceField/shadow/layout.ts'
import { dfshTileTraceWgsl } from '../../../distanceField/shadow/traceWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../../../reflections/constantsWgsl.ts'
import {
  REFLECTION_GROUP,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../../../reflections/viewLayout.ts'

/** The side of a workgroup, in threads. */
export const FIELD_SHADOW_GROUP = 8
/** The group of the sun's lists and the meshes' fields (`meshShadowLayoutEntries`); the reflection group is the one before. */
export const FIELD_SHADOW_LISTS_GROUP = 2
/**
 * The bindings of group 0: the uniform, the traced factors (written by the trace, read by the upsample), the sun masks (the upsample's) and, for the water's
 * kernels, the water's depth, the list of the tiles that hold water and its count (both kernels read them).
 */
export const FIELD_SHADOW_BINDINGS = {
  params: 0,
  factors: 1,
  mask: 2,
  depth: 3,
  tiles: 4,
  count: 5,
} as const
/** The surface a kernel traces: the opaque scene's (the depth pyramid's level 0) or the single-layer water's (its own depth, the upsample run over the tiles that hold it). */
export type FieldShadowSource = 'scene' | 'water'
const B = FIELD_SHADOW_BINDINGS

export const FIELD_SHADOW_TRACE_ENTRY = 'fieldShadowTrace'
export const FIELD_SHADOW_UPSAMPLE_ENTRY = 'fieldShadowUpsample'

/** The depth given to a pixel with no surface: far past any cascade. */
const NO_SURFACE_DEPTH = '1.0e30'
/** The tolerance of the upsample's depth weights, in metres (the reference's, 0.0001 centimetres). */
const DEPTH_EPSILON = '1.0e-6'

/**
 * THE SUN'S DISTANCE-FIELD CASCADE ON THE VIEW, for the sun `params.sizes.w` of the lists (`fieldCascade.ts` says where it lies):
 *
 * THE TRACE (`fieldShadowTrace`, a thread a texel of the traced image, which is the window `params.sizes.z` times smaller; the water's, a workgroup a listed tile): the texel's pixel is the window's pixel at its
 * corner (and the farthest of the pixels of its block decides, with it, whether the block is traced); its depth along the view axis, in metres, decides whether it is traced — farther than the
 * cascade's near edge less its fade and nearer than its far edge. A ray starts off the surface by 2 centimetres and the share `params.sun.w` of the depth, goes
 * `params.range.w` centimetres toward the sun and is walked through the meshes of the tile the pixel is in (`dfshTraceThroughTileWith`: a cone of the tangent
 * `params.range.z`, at least 0.4 centimetres wide, the surfaces expanded only for the two-sided meshes). The texel keeps the visibility and the depth.
 *
 * THE UPSAMPLE (`fieldShadowUpsample`, a thread a pixel of the window): the four traced texels around the pixel weighed by the pixel's bilinear weights, by 1 over the distance
 * of their depth from the pixel's and by whether they were traced — a texel out of the cascade's range counts only if it is shadowed —; faded to 1 over the far fade and
 * from 1 over the near one, then laid into the sun's layer of the masks by the minimum.
 */
const PARAMS_WGSL = wgslBlock(
  'FIELD_SHADOW_PARAMS_WGSL',
  [],
  `struct FieldShadowParams{
 sizes:vec4u,
 window:vec4u,
 range:vec4f,
 sun:vec4f,
 forward:vec4f,
 fade:vec4f,
 layer:vec4u,
}
@group(0) @binding(${B.params}) var<uniform> params:FieldShadowParams;`,
)

const depthWgsl = (source: FieldShadowSource) =>
  wgslBlock(
    `FIELD_SHADOW_DEPTH_WGSL(${source})`,
    [],
    `${
      source === 'water'
        ? `@group(0) @binding(${B.depth}) var waterDepth:texture_depth_2d;
fn fieldRawDepth(pixel:vec2i)->f32{return textureLoad(waterDepth,pixel,0);}`
        : 'fn fieldRawDepth(pixel:vec2i)->f32{return hizOpaqueDepth(pixel);}'
    }
/** The depth along the view axis of the pixel, in metres; far past any cascade where it holds no surface. */
fn fieldDepthAt(pixel:vec2u)->f32{
 let z=fieldRawDepth(vec2i(pixel));
 if(z==0.0){return ${NO_SURFACE_DEPTH};}
 return dot(worldAt(vec2f(pixel)+vec2f(0.5),z)-view.camera.xyz,params.forward.xyz);
}`,
  )

/** The trace of the texel `gid` of the traced image: the visibility and the depth it keeps. */
const TRACE_TEXEL_WGSL = wgslBlock(
  'FIELD_SHADOW_TRACE_TEXEL_WGSL',
  [],
  `
@group(0) @binding(${B.factors}) var factors:texture_storage_2d<rg32float,write>;
fn fieldTraceTexel(gid:vec2u){
 if(any(gid>=params.sizes.xy)){return;}
 let factor=params.sizes.z;
 let last=params.window.zw-vec2u(1u);
 let corner=min(gid*factor+params.window.xy,last);
 let depth=fieldDepthAt(corner);
 var furthest=depth;
 if(factor>1u){
  var deepest=2.0;
  var farthest=corner;
  for(var k=0u;k<factor*factor;k++){
   let at=min(corner+vec2u(k%factor,k/factor),last);
   let z=fieldRawDepth(vec2i(at));
   if(z<deepest){deepest=z;farthest=at;}
  }
  furthest=fieldDepthAt(farthest);
 }
 var visibility=1.0;
 if(furthest>params.range.x&&depth<params.range.y){
  let z=fieldRawDepth(vec2i(corner));
  let fromEye=(worldAt(vec2f(corner)+vec2f(0.5),z)-view.camera.xyz)*100.0;
  let toSun=params.sun.xyz;
  let start=fromEye+toSun*(2.0+params.sun.w*depth*100.0);
  let end=fromEye+toSun*params.range.w;
  visibility=dfshTraceThroughTileWith(params.sizes.w,fromEye,start,end,vec2f(params.range.z,0.4),false);
 }
 textureStore(factors,gid,vec4f(visibility,min(depth,${NO_SURFACE_DEPTH}),0.0,0.0));
}`,
)

/** The scene's trace: a thread a texel of the traced image. */
const TRACE_SCENE_WGSL = `
@compute @workgroup_size(${FIELD_SHADOW_GROUP},${FIELD_SHADOW_GROUP},1)
fn ${FIELD_SHADOW_TRACE_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 fieldTraceTexel(gid.xy);
}`

/**
 * The water's trace: a workgroup a listed tile (the dispatch is indirect, in rows, as the upsample's), over the texels of the traced image the tile's pixels read: the
 * tile's own texels, and with a traced image smaller than the window the one past them that the upsample's bilinear taps reach. The texel a neighbouring tile shares is
 * traced by both, the same value.
 */
const TRACE_WATER_WGSL = `
@group(0) @binding(${B.tiles}) var<storage,read> waterTiles:array<u32>;
@group(0) @binding(${B.count}) var<uniform> waterCount:vec4u;
@compute @workgroup_size(${FIELD_SHADOW_GROUP},${FIELD_SHADOW_GROUP},1)
fn ${FIELD_SHADOW_TRACE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let rank=flatIndex(group,groups,1u);
 if(rank>=waterCount.x){return;}
 let factor=params.sizes.z;
 let reach=select(${FIELD_SHADOW_GROUP}u,${FIELD_SHADOW_GROUP}u/factor+1u,factor>1u);
 if(any(lane.xy>=vec2u(reach))){return;}
 let packed=waterTiles[rank];
 fieldTraceTexel(vec2u(packed&0xffffu,packed>>16u)*${FIELD_SHADOW_GROUP}u/factor+lane.xy);
}`

/** The kernels' shared part: the visibility the four traced texels around `pixel` give it, faded over the cascade's edges. */
const UPSAMPLE_COMMON_WGSL = wgslBlock(
  'FIELD_SHADOW_UPSAMPLE_COMMON_WGSL',
  [],
  `
@group(0) @binding(${B.factors}) var factors:texture_2d<f32>;
fn fieldTexel(index:vec2i)->vec2f{
 let size=vec2i(textureDimensions(factors));
 return textureLoad(factors,clamp(index,vec2i(0),size-vec2i(1)),0).xy;
}
fn fieldVisibilityAt(pixel:vec2u)->f32{
 let depth=fieldDepthAt(pixel);
 let factor=f32(params.sizes.z);
 let at=vec2f(pixel-params.window.xy)+vec2f(0.5);
 var visibility=1.0;
 if(params.sizes.z>1u){
  let base=floor(at/factor);
  let weights=saturate((at-(base*factor+vec2f(0.5)))/factor);
  let corner=vec2i(base);
  let v00=fieldTexel(corner);
  let v10=fieldTexel(corner+vec2i(1,0));
  let v01=fieldTexel(corner+vec2i(0,1));
  let v11=fieldTexel(corner+vec2i(1,1));
  let shares=vec4f(v00.x,v10.x,v01.x,v11.x);
  let depths=abs(vec4f(v00.y,v10.y,v01.y,v11.y));
  let inRange=(depths>vec4f(params.range.x))&(depths<vec4f(params.range.y));
  let used=select(vec4f(0.0),vec4f(1.0),inRange|(shares<vec4f(1.0)));
  let bilinear=vec4f((1.0-weights.y)*(1.0-weights.x),(1.0-weights.y)*weights.x,weights.y*(1.0-weights.x),weights.y*weights.x);
  let weighed=bilinear*used/(abs(depths-vec4f(depth))+vec4f(${DEPTH_EPSILON}));
  let total=dot(weighed,vec4f(1.0));
  if(total!=0.0){visibility=dot(shares,weighed)/total;}
 }else{
  visibility=fieldTexel(vec2i(pixel-params.window.xy)).x;
 }
 visibility=mix(1.0,visibility,1.0-saturate((depth-params.fade.x)*params.fade.y));
 return mix(1.0,visibility,saturate((depth-params.fade.z)*params.fade.w));
}`,
)

const UPSAMPLE_SCENE_WGSL = `
@group(0) @binding(${B.mask}) var shadowMask:texture_storage_2d_array<r32float,read_write>;
@compute @workgroup_size(${FIELD_SHADOW_GROUP},${FIELD_SHADOW_GROUP},1)
fn ${FIELD_SHADOW_UPSAMPLE_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 let pixel=gid.xy+params.window.xy;
 if(any(pixel>=params.window.zw)){return;}
 let visibility=fieldVisibilityAt(pixel);
 if(visibility<1.0){
  let held=textureLoad(shadowMask,pixel,params.layer.x).x;
  textureStore(shadowMask,pixel,params.layer.x,vec4f(min(held,visibility),0.0,0.0,0.0));
 }
}`

/** The water's upsample: a workgroup a listed tile (the dispatch is indirect, in rows), the sun's layer written outright (the draw over the tiles reads only these). */
const UPSAMPLE_WATER_WGSL = `
@group(0) @binding(${B.mask}) var shadowMask:texture_storage_2d_array<r32float,write>;
@group(0) @binding(${B.tiles}) var<storage,read> waterTiles:array<u32>;
@group(0) @binding(${B.count}) var<uniform> waterCount:vec4u;
@compute @workgroup_size(${FIELD_SHADOW_GROUP},${FIELD_SHADOW_GROUP},1)
fn ${FIELD_SHADOW_UPSAMPLE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let rank=flatIndex(group,groups,1u);
 if(rank>=waterCount.x){return;}
 let packed=waterTiles[rank];
 let pixel=vec2u(packed&0xffffu,packed>>16u)*${FIELD_SHADOW_GROUP}u+lane.xy;
 if(any(pixel>=params.window.zw)){return;}
 textureStore(shadowMask,pixel,params.layer.x,vec4f(fieldVisibilityAt(pixel),0.0,0.0,0.0));
}`

const viewGroupLibs = (source: FieldShadowSource) => [
  PARAMS_WGSL,
  WORLD_AT_WGSL,
  REFLECTION_CONSTANTS_WGSL,
  reflectionBindingsWgsl(REFLECTION_GROUP),
  reflectionLightViewWgsl(REFLECTION_GROUP),
  depthWgsl(source),
]

/** The program of the trace over `source`: its own group, the reflection group (the view and the depth pyramid) and the lists' group; the water's runs over the listed tiles. */
export const fieldShadowTraceProgram = (source: FieldShadowSource = 'scene') =>
  wgslProgram(source === 'water' ? TRACE_WATER_WGSL : TRACE_SCENE_WGSL, [
    ...viewGroupLibs(source),
    TRACE_TEXEL_WGSL,
    ...(source === 'water' ? [FLAT_INDEX_WGSL] : []),
    dfshCommonWgsl(FIELD_SHADOW_LISTS_GROUP, DFSH_MAX_LIGHTS),
    dfshTileTraceWgsl(FIELD_SHADOW_LISTS_GROUP, DFSH_MAX_LIGHTS),
  ])

/** The program of the upsample over `source`: its own group and the reflection group. */
export const fieldShadowUpsampleProgram = (source: FieldShadowSource = 'scene') =>
  wgslProgram(source === 'water' ? UPSAMPLE_WATER_WGSL : UPSAMPLE_SCENE_WGSL, [
    ...viewGroupLibs(source),
    UPSAMPLE_COMMON_WGSL,
    ...(source === 'water' ? [FLAT_INDEX_WGSL] : []),
  ])
