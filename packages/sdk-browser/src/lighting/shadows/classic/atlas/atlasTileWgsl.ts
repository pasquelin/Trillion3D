import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { PAGE_NORMAL_WGSL } from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_INFO_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../../vsm/constants.ts'
import { VSM_PROJECTION_RECORD_WGSL } from '../../vsm/projection/projectionDataWgsl.ts'
import { VSM_RENDER_RECORD_WGSL } from '../../vsm/render/renderParamsWgsl.ts'
import { ATLAS_MAP_WORDS, ATLAS_TILE_NO_DYNAMIC, atlasTileAt } from './atlasPlan.ts'

/**
 * THE ATLAS BUFFER AS THE SHADERS READ IT, and the depth bias a map's casters are drawn with (`DrawBias`, `drawBias.ts`). The atlas raster reads the tiles in both stages; the pool
 * raster, which draws the voxel rows of a classic frame and every row while the atlas pipelines compile, reads the bias alone, in its vertex stage: in a frame of virtual shadow maps it
 * is bound to a buffer of zeros, so no map there has a bias.
 */

/** The binding of the atlas buffer in group 1 of the raster. */
export const ATLAS_RASTER_BINDING = 6

/**
 * A map's tile as the shaders read it from the atlas buffer: `vsmAtlasTileOf(map)` gives the tile's corner in the atlas, its side, its mip, whether the map has a tile
 * (placed, and asked pages), the atlas it lies in, the flags, the atlas's size and the tile's corner in the map, in texels of its mip. Declares the buffer at group `group`, binding `binding`.
 */
export const atlasTileWgsl = (group: number, binding: number) =>
  wgslBlock(
    `VSM_ATLAS_TILE_WGSL(${group},${binding})`,
    [VSM_CONSTANTS_WGSL],
    `@group(${group}) @binding(${binding}) var<storage,read> vsmAtlas:array<u32>;
struct VsmAtlasTile{corner:vec2u,side:u32,mip:u32,page:u32,valid:bool,noDynamic:bool,size:vec2f,mapCorner:vec2u,bias:vec3f,}
/** The bias of map 'map': constant, slope factor, slope limit; the constant zero where the map has none. */
fn vsmDrawBiasOf(map:u32)->vec3f{
 let at=map*${ATLAS_MAP_WORDS}u+${atlasTileAt(0)}u;
 return vec3f(bitcast<f32>(vsmAtlas[at+8u]),bitcast<f32>(vsmAtlas[at+9u]),bitcast<f32>(vsmAtlas[at+10u]));
}
fn vsmAtlasTileOf(map:u32)->VsmAtlasTile{
 let at=map*${ATLAS_MAP_WORDS}u;
 let corner=vsmAtlas[at+${atlasTileAt(0)}u];
 var t:VsmAtlasTile;
 t.corner=vec2u(corner&0xFFFFu,corner>>16u);
 t.side=vsmAtlas[at+${atlasTileAt(0) + 1}u];
 t.mip=vsmAtlas[at+${atlasTileAt(0) + 2}u];
 t.page=vsmAtlas[at+${atlasTileAt(0) + 7}u];
 // A map the entries asked no page of has a zero rect (the complement of its first page is never zero).
 t.valid=vsmAtlas[at+${atlasTileAt(0) + 3}u]!=0u&&vsmAtlas[at]!=0u;
 t.noDynamic=(vsmAtlas[at+${atlasTileAt(0) + 4}u]&${ATLAS_TILE_NO_DYNAMIC}u)!=0u;
 t.size=vec2f(f32(vsmAtlas[at+${atlasTileAt(0) + 5}u]),f32(vsmAtlas[at+${atlasTileAt(0) + 6}u]));
 t.mapCorner=vec2u(~vsmAtlas[at],~vsmAtlas[at+1u])*VSM_PAGE_TEXELS;
 t.bias=vsmDrawBiasOf(map);
 return t;
}`,
  )

/**
 * The lift of a surface by the draw bias, apart from where the bias is read: the map's constant grown by the slope of the surface against the light's axis, in distance, which the
 * depth the map spans per unit of distance brings to depth (the lift of a point of clip w 'w' is 'vsmDrawDepthPerDistance(m)*lift/w' in depth, taken off its clip z). The
 * tessellated patches, which bind no atlas buffer, take it from the words their window holds.
 */
export const DRAW_LIFT_WGSL = wgslBlock(
  'VSM_DRAW_LIFT_WGSL',
  [],
  `/** The slope of a surface whose normal makes the cosine 'nol' with the light's axis, held to 'maxSlope'. */
fn vsmAtlasSlope(nol:f32,maxSlope:f32)->f32{
 return clamp(select(maxSlope,sqrt(saturate(1.0-nol*nol))/nol,nol>0.0),0.0,maxSlope);
}
/** The distance a surface of 'normal' is lifted by in a map of 'bias' whose light looks along 'lightDirection'. */
fn vsmDrawLift(bias:vec3f,normal:vec3f,lightDirection:vec3f)->f32{
 return bias.x*(1.0+bias.y*vsmAtlasSlope(abs(dot(normal,lightDirection)),bias.z));
}
/** The depth the map spans per unit of distance, times the square of the clip w. */
fn vsmDrawDepthPerDistance(m:mat4x4f)->f32{return abs(m[2][2]*m[3][3]-m[3][2]*m[2][3]);}`,
)

/**
 * The draw bias of a map's casters (the buffer of `atlasTileWgsl(1, ATLAS_RASTER_BINDING)` declared by the program): the map's words in
 * the atlas buffer, the lift of `DRAW_LIFT_WGSL` and the world normal it is taken against — what a box face (the voxel raster) needs.
 */
export const DRAW_BIAS_WGSL = wgslBlock(
  'VSM_DRAW_BIAS_WGSL',
  [
    atlasTileWgsl(1, ATLAS_RASTER_BINDING),
    DRAW_LIFT_WGSL,
    VSM_CONSTANTS_WGSL,
    VSM_RENDER_RECORD_WGSL,
  ],
  `/** The world normal of a surface whose local normal is 'local', taken by the cofactor of the columns 'c0', 'c1', 'c2' of the placement's matrix. */
fn vsmDrawNormal(c0:vec3f,c1:vec3f,c2:vec3f,local:vec3f)->vec3f{
 return normalize(cross(c1,c2)*local.x+cross(c2,c0)*local.y+cross(c0,c1)*local.z);
}
/** Whether the map of a record is drawn with a depth bias. */
fn vsmAtlasBiased(r:vec4u)->bool{return vsmDrawBiasOf(vsmRecordMap(r)).x>0.0;}`,
)

/**
 * The draw bias at a caster's vertex (`DRAW_BIAS_WGSL`), its normal read from its page: the triangle rasters', which bind the page's
 * normals; the voxel raster, which binds none, takes `DRAW_BIAS_WGSL` alone.
 */
export const DRAW_BIAS_CLIP_WGSL = wgslBlock(
  'VSM_DRAW_BIAS_CLIP_WGSL',
  [DRAW_BIAS_WGSL, PAGE_INFO_WGSL, PAGE_NORMAL_WGSL, VSM_PROJECTION_RECORD_WGSL],
  `/** The map clip position with the depth bias of the vertex taken off: the lift of the vertex's normal (page 'page', vertex 'vertex') against the light's axis, brought to depth at the vertex. */
fn vsmAtlasBiasedClip(clip:vec4f,r:vec4u,raw:VsmProjectionRecord,page:PageInfo,h:ClusterHeader,vertex:u32)->vec4f{
 let bias=vsmDrawBiasOf(vsmRecordMap(r));
 if(bias.x<=0.0){return clip;}
 let normal=vsmDrawNormal(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz,pageNormal(page,h,vertex));
 let lift=vsmDrawLift(bias,normal,raw.lightDirection);
 return vec4f(clip.xy,clip.z-vsmDrawDepthPerDistance(raw.lightViewToClip)/(clip.w*clip.w)*lift*clip.w,clip.w);
}`,
)
