import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { HAIR_VOXEL_FIX_POINT_SCALE, HAIR_VOXEL_BITS, VOXEL_NODE_WGSL } from './voxelRasterWgsl.ts'
import { VOXEL_LEVELS_WGSL } from './voxelMipWgsl.ts'
import { interleavedGradientNoise } from '../../../math/src/wgsl/sampling.ts'

/**
 * THE OFFSET OF A VOXEL'S RAY, in [0, 1] on each axis: noise of the pixel (`hairVoxelJitter(pixel, id, frame, mode)`), the reference's `GetHairVoxelJitter`: none for mode 0, moving with
 * the frame (and the macro group `id`) for mode 1, still for any other.
 */
export const HAIR_VOXEL_JITTER_WGSL = wgslBlock(
  'HAIR_VOXEL_JITTER_WGSL',
  [interleavedGradientNoise],
  `fn hairVoxelJitter(pixel:vec2u,id:u32,frame:u32,mode:u32)->vec3f{
 if(mode==0u){return vec3f(0.0);}
 let seed=f32(select((frame%8u)+id%8u,0u,mode>1u));
 let at=vec2f(pixel);
 return vec3f(interleavedGradientNoise(at,seed),interleavedGradientNoise(at,seed*117.0),interleavedGradientNoise(at,seed*7901.0));
}`,
)

/** The mask word of a march: the hair count (thousandths, 24 bits) and the visibility (8 bits, on top) the strands' lighting reads. */
export const HAIR_PACK_MASK_WGSL = wgslFn(
  'packMask',
  [],
  `fn packMask(hairCount:f32,visibility:f32)->u32{return min(u32(hairCount*1000.0),0x00FFFFFFu)|(min(u32(visibility*255.0),0xFFu)<<24u);}`,
)

/** The farthest a ray goes in the volume (the reference's 100000 centimetres, in metres). */
export const HAIR_TRAVERSAL_MAX_DISTANCE = 1000
/** The steps of a ray at most. */
const MAX_STEPS = 1024

/** The density of a voxel and the segment's box, before the march. */
const DENSITY_TEXT = `struct Traversal{hairCount:f32,visibility:f32,hitT:f32}
struct TraversalSettings{densityScale:f32,countThreshold:f32,distanceThreshold:f32,steppingScale:f32,random:vec3f,tanConeAngle:f32,castShadow:bool,useOpaque:bool}
fn initTraversal()->Traversal{return Traversal(0.0,1.0,-1.0);}
fn lineBoxIntersect(origin:vec3f,end:vec3f,lo:vec3f,hi:vec3f)->vec2f{
 let inverse=vec3f(1.0)/(end-origin);
 let first=(lo-origin)*inverse;
 let second=(hi-origin)*inverse;
 let closest=min(first,second);
 let furthest=max(first,second);
 return saturate(vec2f(max(closest.x,max(closest.y,closest.z)),min(furthest.x,min(furthest.y,furthest.z))));
}
// The density of a voxel of a page's level: its hair count (scaled) and the visibility its opaque mark leaves.
fn voxelDensity(page:u32,voxel:vec3u,level:u32,densityScale:f32,castShadow:bool,useOpaque:bool)->Traversal{
 var trace=initTraversal();
 let raw=voxels[levelVoxelAt(page,level,voxel>>vec3u(level))];
 if(!castShadow||(raw&${HAIR_VOXEL_BITS.noShadow}u)==0u){
  trace.hairCount=f32(raw&${HAIR_VOXEL_BITS.hairMask}u)/${HAIR_VOXEL_FIX_POINT_SCALE}.0*densityScale;
  trace.visibility=select(1.0,1.0-saturate(f32((raw&${HAIR_VOXEL_BITS.opaqueMask}u)>>24u)/255.0),useOpaque);
 }
 return trace;
}
// The hair count that ends a march at an opaque surface: the opaque mark's own value, in hair counts.
fn opaqueVoxelValue()->f32{return f32(${HAIR_VOXEL_BITS.opaqueMask}u)/${HAIR_VOXEL_FIX_POINT_SCALE}.0-1.0;}`

/** The march itself (`mipmap`: the step's width picks the level of the page and grows). */
const traceText = (
  mipmap: boolean,
  forceable: boolean,
) => `${forceable ? 'var<private> forcedMip:i32=-1;\n' : ''}fn traceVoxels(p0:vec3f,p1:vec3f,node:VoxelNode,settings:TraversalSettings)->Traversal{
 var trace=initTraversal();
 if(any(node.pages==vec3u(0u))){return trace;}
 let span=lineBoxIntersect(p0,p1,node.lo,node.hi);
 if(!(span.x<span.y)){return trace;}
 let o=mix(p0,p1,vec3f(span.x));
 let e=mix(p0,p1,vec3f(span.y));
 let extent=min(distance(e,o),settings.distanceThreshold);
 let pagesBoundMax=node.lo+vec3f(node.pages)*node.size*f32(params.pageResolution);
 let d=normalize(e-o)*node.size;
 let maxStep=f32(min(u32(ceil(extent/node.size)),${MAX_STEPS}u));
 if(!(maxStep>0.0)){return trace;}
 let deltaWorld=extent/maxStep;
 let jitter=settings.random*2.0-vec3f(1.0);
 let virtualMax=vec3f(node.voxels-vec3u(1u));
 let lastLevel=firstTrailingBit(params.pageResolution);
 var stepScale=1.0;
 var held=vec3u(9999u);
 var valid=false;
 var page=0u;
 for(var at=0.0;at<maxStep;at+=stepScale){
  let steppingWorldSize=max(deltaWorld*stepScale,settings.tanConeAngle*at*node.size);
  let hit=o+at*d+jitter*steppingWorldSize*0.5;
  let within=all(hit<pagesBoundMax);
  let volume=vec3u(clamp((hit-node.lo)/node.size,vec3f(0.0),virtualMax));
  let pageCoord=volume/params.pageResolution;
  if(any(pageCoord!=held)){
   held=pageCoord;
   page=pageIndex[coordToIndex(pageCoord,node.pages,node.offset)];
   valid=page!=INVALID_PAGE;
  }
  if(valid&&within){
   var countScale=1.0;
   var level=0u;
${
  mipmap
    ? `   countScale=steppingWorldSize/node.size;
   level=min(u32(max(log2(countScale),0.0)),lastLevel);`
    : ''
}${forceable ? '\n   if(forcedMip>=0){level=min(u32(forcedMip),lastLevel);}' : ''}
   let found=voxelDensity(page,volume-pageCoord*params.pageResolution,level,settings.densityScale*countScale,settings.castShadow,settings.useOpaque);
   trace.hairCount+=found.hairCount;
   trace.visibility=min(trace.visibility,found.visibility);
   if(trace.visibility==0.0||(settings.countThreshold!=0.0&&trace.hairCount>settings.countThreshold)){
    trace.hitT=distance(hit,p0);
    return trace;
   }
  }
${mipmap ? '  stepScale=min(f32(params.pageResolution),stepScale*settings.steppingScale);' : ''}
 }
 return trace;
}`

/**
 * THE MARCH OF A SEGMENT THROUGH THE VOXELS, the reference's linear traversal and its mipmapped form
 * (`mipmap`): the part of the segment inside the macro group's box is walked a voxel a step, the page of
 * each step found in the page index (a page with none is skipped), the density of the voxel read from the
 * page's level the step's width asks for (the mipmapped form only, the step growing by `steppingScale`
 * up to a page), summed as a hair count, the opaque marks multiplying a visibility. The march stops where
 * the visibility is nil or the count passes `countThreshold`. A step is moved by `random` (in [-1, 1],
 * half the step wide) and the cone `tanConeAngle` widens it. Reads `nodes`, `pageIndex`, `voxels` (its host
 * declares them), `params`. `forceable` adds the module variable `forcedMip`, the level of the pages every step reads where it is
 * 0 or more (the debug view of the voxels sets it).
 */
export const voxelTraversalWgsl = (mipmap: boolean, forceable = false) =>
  wgslBlock(
    `HAIR_VOXEL_TRAVERSAL_WGSL(${mipmap}${forceable ? ', forceable' : ''})`,
    [VOXEL_NODE_WGSL, VOXEL_LEVELS_WGSL],
    `${DENSITY_TEXT}\n${traceText(mipmap, forceable)}`,
  )
