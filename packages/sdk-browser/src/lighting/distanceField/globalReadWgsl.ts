import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS,
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { fieldLayout, vec4Array } from '../../gpu/core/fieldLayout.ts'
import { ATLAS_FETCH_WGSL } from './atlasFetchWgsl.ts'

/**
 * THE GLOBAL DISTANCE FIELD'S READS: the distance to the nearest surface around a position, from
 * the clipmaps the field is composited into (`globalUpdate.ts`), and the cone trace of the sky's
 * occlusion that reads it.
 *
 * A position finds the page that holds it in the page table (a `u32` per page: the page's index in
 * the atlas, the top bit set where it carries coverage, all ones where none is allocated), the
 * page's voxels in the atlas a byte each (`atlasFetchWgsl.ts`), filtered trilinearly, the distance
 * mapped from [0, 1] to [-range, range], range being the clipmap's influence range (four voxels
 * either side); a value of 1 is a position no surface reaches. A clipmap wraps: a position outside
 * it reads the page it wraps to, so a read is taken only inside the clipmap whose box holds it.
 * Lengths are in the reference's unit, the centimetre; the positions the functions take are
 * TRANSLATED, the view's `translation` added to a world position (`gdfTranslated`), so that a
 * float holds them whatever the distance of the camera from the origin, and so are the view
 * block's clipmaps.
 *
 * The coarse mip (`gdfMipUv`, `gdfMipSample`) is read at a position of the same clipmaps and holds
 * the distance in units of the mip's range, clamped to the clipmap's layer.
 *
 * The bindings are consecutive from `first` in the bind group `group`: the view block (`GdfView`),
 * the page table (`texture_3d<u32>`, read by load), the page atlas (a read-only storage buffer of
 * words) and the coarse mip (`texture_3d<f32>`, a 32-bit float read by load). A view whose
 * `clipmaps` is 0 answers as a scene with no distance field does: nothing occludes.
 */

const MAX = GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS
const PAGE = GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION
const INFLUENCE = GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS

/** The view block: per clipmap its translated centre and half-extent, its position-to-volume
 *  coordinate (add in `xyz`, multiply in `w`), its position-to-mip coordinate (scale then bias, the
 *  mip's first and last usable layer in their `w`); then the clipmaps held, the pages along a
 *  clipmap, the texel of the volume (one over its voxels), the farthest a cone is traced, the mip
 *  divider and the distance at which the pages take over from the mip, the sky light's occlusion
 *  distance for the global field and the translation from the world. */
export const GDF_VIEW = fieldLayout('GdfView', [
  ['centerExtent', vec4Array(MAX)],
  ['uvAddMul', vec4Array(MAX)],
  ['mipScale', vec4Array(MAX)],
  ['mipBias', vec4Array(MAX)],
  ['clipmaps', 'u32'],
  ['pagesAlong', 'u32'],
  ['texel', 'f32'],
  ['maxConeDistance', 'f32'],
  ['mipFactor', 'f32'],
  ['mipTransition', 'f32'],
  ['occlusionDistance', 'f32'],
  ['padA', 'f32'],
  ['translation', 'vec3f'],
  ['padB', 'f32'],
] as const)

export const GDF_VIEW_STRUCT_WGSL = wgslBlock('GDF_VIEW_STRUCT_WGSL', [], `\n${GDF_VIEW.wgsl}`)

/** The page and mip functions over the bindings. */
const GDF_PAGES_WGSL = wgslBlock(
  'GDF_PAGES_WGSL',
  [ATLAS_FETCH_WGSL],
  `
const GDF_INVALID_PAGE=0xFFFFFFFFu;
const GDF_CONE_STEPS=10u;
struct GdfPageAt{valid:bool,page:u32,local:vec3f}
fn gdfTranslated(world:vec3f)->vec3f{return world+gdfView.translation;}
fn gdfBoxDistanceInside(center:vec3f,extent:f32,p:vec3f)->f32{
 let toMin=max(p-center+vec3f(extent),vec3f(0.0));
 let toMax=max(center+vec3f(extent)-p,vec3f(0.0));
 let closest=min(toMin,toMax);
 return min(closest.x,min(closest.y,closest.z));
}
fn gdfVolumeUv(p:vec3f,clipmap:u32)->vec3f{
 let m=gdfView.uvAddMul[clipmap];
 return fract(fract(p*m.w+m.xyz));
}
fn gdfInfluenceRange(clipmap:u32)->f32{
 return ${INFLUENCE}.0*2.0*gdfView.centerExtent[clipmap].w*gdfView.texel;
}
fn gdfPageAt(volumeUv:vec3f,clipmap:u32)->GdfPageAt{
 let along=f32(gdfView.pagesAlong);
 let coord=vec3i(saturate(volumeUv)*along)+vec3i(0,0,i32(clipmap*gdfView.pagesAlong));
 let packed=textureLoad(gdfPageTable,coord,0).x;
 return GdfPageAt(packed!=GDF_INVALID_PAGE,packed&0x00FFFFFFu,fract(volumeUv*along)*${PAGE}.0);
}
fn gdfDecode(encoded:f32,range:f32)->f32{return (encoded*2.0-1.0)*range;}
fn gdfPageValue(volumeUv:vec3f,clipmap:u32)->f32{
 let hit=gdfPageAt(volumeUv,clipmap);
 return select(1.0,gdfAtlasSample(hit.page,hit.local),hit.valid);
}
fn gdfMipUv(p:vec3f,clipmap:u32)->vec3f{
 let scale=gdfView.mipScale[clipmap];
 let bias=gdfView.mipBias[clipmap];
 var uv=saturate(p*scale.xyz+bias.xyz);
 uv.z=clamp(uv.z,scale.w,bias.w);
 return uv;
}
fn gdfMipSample(uv:vec3f)->f32{
 let size=vec3f(textureDimensions(gdfMip));
 let at=uv*size-0.5;
 let base=floor(at);
 let f=at-base;
 let low=clamp(vec3i(base),vec3i(0),vec3i(size)-1);
 let high=clamp(vec3i(base)+1,vec3i(0),vec3i(size)-1);
 let x0=mix(textureLoad(gdfMip,low,0).x,textureLoad(gdfMip,vec3i(high.x,low.y,low.z),0).x,f.x);
 let x1=mix(textureLoad(gdfMip,vec3i(low.x,high.y,low.z),0).x,textureLoad(gdfMip,vec3i(high.x,high.y,low.z),0).x,f.x);
 let x2=mix(textureLoad(gdfMip,vec3i(low.x,low.y,high.z),0).x,textureLoad(gdfMip,vec3i(high.x,low.y,high.z),0).x,f.x);
 let x3=mix(textureLoad(gdfMip,vec3i(low.x,high.y,high.z),0).x,textureLoad(gdfMip,high,0).x,f.x);
 return mix(mix(x0,x1,f.y),mix(x2,x3,f.y),f.z);
}
fn gdfSample(p:vec3f,maxDistance:f32,minClipmap:u32)->f32{
 for(var clipmap=minClipmap;clipmap<gdfView.clipmaps;clipmap++){
  let value=gdfPageValue(gdfVolumeUv(p,clipmap),clipmap);
  if(value<1.0){return gdfDecode(value,gdfInfluenceRange(clipmap));}
 }
 return maxDistance;
}
fn gdfDistanceToNearestSurface(p:vec3f)->f32{
 var nearest=0.0;
 for(var clipmap=0u;clipmap<gdfView.clipmaps;clipmap++){
  let box=gdfView.centerExtent[clipmap];
  let range=gdfInfluenceRange(clipmap);
  nearest=range;
  if(gdfBoxDistanceInside(box.xyz,box.w,p)>box.w*gdfView.texel){
   let value=gdfPageValue(gdfVolumeUv(p,clipmap),clipmap);
   if(value<1.0){return gdfDecode(value,range);}
  }
 }
 return nearest;
}`,
)

/** The cone trace over the sample above. */
const GDF_CONE_WGSL = wgslBlock(
  'GDF_CONE_WGSL',
  [GDF_PAGES_WGSL],
  `
fn gdfConeTraceClipmap(clipmap:u32,p:vec3f,direction:vec3f,tanHalfAngle:f32)->f32{
 let reach=gdfView.occlusionDistance;
 let minStep=gdfView.centerExtent[clipmap].w*2.0/100.0;
 let invReach=1.0/reach;
 var minVisibility=1.0;
 var offset=2.0;
 for(var stepIndex=0u;stepIndex<GDF_CONE_STEPS&&offset<reach;stepIndex++){
  let toSurface=gdfSample(p+direction*offset,reach,clipmap);
  let invRadius=1.0/(offset*tanHalfAngle);
  var visibility=saturate(toSurface*invRadius);
  let fraction=(offset+toSurface)*invReach;
  visibility=max(visibility,saturate(fraction*fraction*0.6));
  minVisibility=min(minVisibility,visibility);
  offset+=max(toSurface,minStep);
 }
 return minVisibility;
}
fn gdfConeTrace(p:vec3f,direction:vec3f,tanHalfAngle:f32)->f32{
 for(var clipmap=0u;clipmap<gdfView.clipmaps;clipmap++){
  let box=gdfView.centerExtent[clipmap];
  if(gdfBoxDistanceInside(box.xyz,box.w,p)>gdfView.occlusionDistance){
   return gdfConeTraceClipmap(clipmap,p,direction,tanHalfAngle);
  }
 }
 return 1.0;
}
fn gdfSkyVisibility(p:vec3f,up:vec3f)->f32{
 if(gdfView.clipmaps==0u||gdfView.occlusionDistance<=0.0){return 1.0;}
 return gdfConeTrace(p,up,tan(0.7853981633974483));
}`,
)

/** The reads, over the bindings `first` on from the group `group`. */
export function globalDistanceFieldReadWgsl(group: number, first: number) {
  return wgslBlock(
    `GLOBAL_DISTANCE_FIELD_READ_WGSL ${group}, ${first}`,
    [GDF_VIEW_STRUCT_WGSL, GDF_CONE_WGSL],
    `
@group(${group}) @binding(${first}) var<uniform> gdfView:GdfView;
@group(${group}) @binding(${first + 1}) var gdfPageTable:texture_3d<u32>;
@group(${group}) @binding(${first + 2}) var<storage,read> gdfPageAtlas:array<u32>;
@group(${group}) @binding(${first + 3}) var gdfMip:texture_3d<f32>;`,
  )
}

/** The bindings the reads take. */
export const GLOBAL_DISTANCE_FIELD_READ_BINDINGS = 4
