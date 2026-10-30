import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS,
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { fieldLayout, vec4Array } from '../../gpu/core/fieldLayout.ts'
import { ATLAS_BUFFER_WGSL, ATLAS_TEXTURE_WGSL, COVERAGE_FETCH_WGSL } from './atlasFetchWgsl.ts'

/**
 * THE GLOBAL DISTANCE FIELD'S READS: the distance to the nearest surface around a position, from
 * the clipmaps the field is composited into (`globalUpdate.ts`), and the cone trace of the sky's
 * occlusion that reads it.
 *
 * A position finds the page that holds it in the page table (a `u32` per page: the page's index in
 * the atlas, the top bit set where it carries coverage, all ones where none is allocated), the
 * page's voxels in the atlas a byte each (`atlasFetchWgsl.ts`: a texture the hardware filters, or a
 * buffer filtered by hand where the device has no such texture, the view block's flag saying which),
 * filtered trilinearly, the distance
 * mapped from [0, 1] to [-range, range], range being the clipmap's influence range (four voxels
 * either side); a value of 1 is a position no surface reaches. A clipmap wraps: a position outside
 * it reads the page it wraps to, so a read is taken only inside the clipmap whose box holds it.
 * Lengths are in the reference's unit, the centimetre; the positions the functions take are
 * TRANSLATED, the view's `translation` added to a world position (`gdfTranslated`), so that a
 * float holds them whatever the distance of the camera from the origin, and so are the view
 * block's clipmaps.
 *
 * The coarse mip (`gdfMipUv`, `gdfMipSample`) is read at a position of the same clipmaps and holds
 * the distance in units of the mip's range, clamped to the clipmap's layer. It is filtered trilinearly
 * by one fetch of the field's sampler where the device filters 32-bit floats, else by hand from eight loads.
 *
 * The bindings are consecutive from `first` in the bind group `group`: the view block (`GdfView`),
 * the page table (`texture_3d<u32>`, read by load), the page atlas as a buffer (a read-only storage
 * buffer of words, the coverage atlas past its pages), the coarse mip (`texture_3d<f32>`, a 32-bit float read by load or, where the device filters it, through the sampler), the page atlas
 * as a texture (`texture_3d<f32>`, an 8-bit `r8unorm`) and the sampler, linear and repeating, of both textures (a read of the mip keeps half a texel inside it, so its border is never reached); the one of the two atlases the
 * field does not keep is a stand-in of one texel, and the buffer holds the coverage atlas too. A view
 * whose `clipmaps` is 0 answers as a scene with no distance field does: nothing occludes.
 */

const MAX = GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS
const PAGE = GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION
const INFLUENCE = GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS

/** The view block: per clipmap its translated centre and half-extent, its position-to-volume
 *  coordinate (add in `xyz`, multiply in `w`), its position-to-mip coordinate (scale then bias, the
 *  mip's first and last usable layer in their `w`); then the clipmaps held, the pages along a
 *  clipmap, the texel of the volume (one over its voxels), the farthest a cone is traced, the mip
 *  divider and the distance at which the pages take over from the mip, the sky light's occlusion
 *  distance for the global field, the most steps of a ray in a clipmap (`GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS`)
 *  and the options of a ray marched through it (`globalTraceWgsl.ts`: the expand scales of the pages the
 *  meshes cover and of those only two-sided meshes reach, the scale of the least step in the latter, the
 *  two thresholds of the dithered transparency), the word of the page atlas's buffer the coverage atlas begins at, the translation
 *  from the world and the flags (`GDF_VIEW_FLAG`). */
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
  ['traceSteps', 'u32'],
  ['expandCovered', 'f32'],
  ['expandNotCovered', 'f32'],
  ['minStepNotCovered', 'f32'],
  ['ditherStep', 'f32'],
  ['ditherTrace', 'f32'],
  ['coverageBase', 'u32'],
  ['translation', 'vec3f'],
  ['flags', 'u32'],
] as const)

/** The bits of the view block's `flags`: the page atlas is a texture, not a buffer; a page only two-sided
 *  meshes reach counts as wholly not covered, the coverage atlas left unread. */
export const GDF_VIEW_FLAG = { atlasTexture: 1, simpleCoverage: 2 } as const

const GDF_VIEW_STRUCT_WGSL = wgslBlock('GDF_VIEW_STRUCT_WGSL', [], `\n${GDF_VIEW.wgsl}`)

/** The page and mip functions over the bindings. */
const GDF_PAGES_WGSL = wgslBlock(
  'GDF_PAGES_WGSL',
  [ATLAS_BUFFER_WGSL, ATLAS_TEXTURE_WGSL, COVERAGE_FETCH_WGSL],
  `
${wgslConsts({ GDF_FLAG_ATLAS_TEXTURE: GDF_VIEW_FLAG.atlasTexture, GDF_FLAG_SIMPLE_COVERAGE: GDF_VIEW_FLAG.simpleCoverage })}
const GDF_INVALID_PAGE=0xFFFFFFFFu;
const GDF_COVERAGE_BIT=0x80000000u;
const GDF_CONE_STEPS=10u;
struct GdfPageAt{valid:bool,coverage:bool,page:u32,local:vec3f}
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
 return GdfPageAt(packed!=GDF_INVALID_PAGE,(packed&GDF_COVERAGE_BIT)!=0u,packed&0x00FFFFFFu,fract(volumeUv*along)*${PAGE}.0);
}
fn gdfAtlasSample(page:u32,local:vec3f)->f32{
 if((gdfView.flags&GDF_FLAG_ATLAS_TEXTURE)!=0u){return gdfAtlasSampleTexture(page,local);}
 return gdfAtlasSampleBuffer(page,local);
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

/** The coarse mip filtered by hand, on a device that does not filter a 32-bit float texture: the eight texels around the
 *  position, their indices clamped to the edge, weighted by its distance to them, what the hardware gives. */
const GDF_MIP_SAMPLE_POLYFILL_WGSL = wgslBlock(
  'GDF_MIP_SAMPLE_POLYFILL_WGSL',
  [],
  `
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
`,
)

/** The coarse mip filtered by the hardware, one fetch through `gdfAtlasSampler` (linear). The coordinate is clamped half a
 *  texel inside the volume first: within that inset the filter never reaches the border, so the sampler's address mode does
 *  not matter and the result equals the by-hand form's, trilinear with its indices clamped to the edge. */
const GDF_MIP_SAMPLE_NATIVE_WGSL = wgslBlock(
  'GDF_MIP_SAMPLE_NATIVE_WGSL',
  [],
  `
fn gdfMipSample(uv:vec3f)->f32{
 let size=vec3f(textureDimensions(gdfMip));
 let c=clamp(uv,0.5/size,1.0-0.5/size);
 return textureSampleLevel(gdfMip,gdfAtlasSampler,c,0.0).x;
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

/** The reads, over the bindings `first` on from the group `group`. `filterableMip` is whether the mip is read through
 *  the hardware's filter, on a device with `float32-filterable` (`hasFloat32Filterable`): one fetch of the sampler at
 *  `first + 5`; else by hand, eight loads. The layout of the same program says the same (`globalReadLayoutEntries`). */
export function globalDistanceFieldReadWgsl(group: number, first: number, filterableMip: boolean) {
  return wgslBlock(
    `GLOBAL_DISTANCE_FIELD_READ_WGSL ${group}, ${first}, ${filterableMip}`,
    [
      GDF_VIEW_STRUCT_WGSL,
      GDF_CONE_WGSL,
      filterableMip ? GDF_MIP_SAMPLE_NATIVE_WGSL : GDF_MIP_SAMPLE_POLYFILL_WGSL,
    ],
    `
@group(${group}) @binding(${first}) var<uniform> gdfView:GdfView;
@group(${group}) @binding(${first + 1}) var gdfPageTable:texture_3d<u32>;
@group(${group}) @binding(${first + 2}) var<storage,read> gdfPageAtlas:array<u32>;
@group(${group}) @binding(${first + 3}) var gdfMip:texture_3d<f32>;
@group(${group}) @binding(${first + 4}) var gdfAtlasTexture:texture_3d<f32>;
@group(${group}) @binding(${first + 5}) var gdfAtlasSampler:sampler;`,
  )
}
