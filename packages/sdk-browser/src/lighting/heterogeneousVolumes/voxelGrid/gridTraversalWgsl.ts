import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { HV_INTERSECT_AABB } from '../intersectAabbWgsl.ts'
import { VG_EVAL_WGSL } from './gridEvalWgsl.ts'

/**
 * THE WALK OF A RAY THROUGH THE VOXEL GRIDS, cell by cell (DDA): the transmittance a ray finds between two points, in the ortho grid and in
 * the frustum grid. The ray is cut into the grid's cells (the top level), each cell it crosses walked in turn through its bottom level (and,
 * with the indirection grid, through the indirection cells it holds first); a cell's extinction is constant, so the transmittance across
 * it is the exponential of the extinction over the distance, in the world. The walk stops once the transmittance of every channel is under
 * 1e-4. `vgTraceOrtho` takes a world ray and its span, `vgTraceFrustum` clips the span to the frustum grid and gives it back.
 *
 * The host declares what `VG_EVAL_WGSL` lists.
 */
export const VG_TRAVERSAL_WGSL = wgslBlock(
  'VG_TRAVERSAL_WGSL',
  [VG_EVAL_WGSL, HV_INTERSECT_AABB],
  `const VG_OPACITY_FLOOR=1.0e-4;

/** The distance along a ray to the first face of each axis ahead of the position, a face too near to be told from the start moved to the
 *  next (the rounding error removed). */
fn vgDdaStart(position:vec3f,direction:vec3f,inverse:vec3f)->vec3f{
 let faces=select(ceil(position)-vec3f(1.0),floor(position)+vec3f(1.0),direction>vec3f(0.0));
 var hit=(faces-position)*inverse;
 let ahead=abs(inverse);
 if(hit.x<=VG_OPACITY_FLOOR){hit.x+=ahead.x;}
 if(hit.y<=VG_OPACITY_FLOOR){hit.y+=ahead.y;}
 if(hit.z<=VG_OPACITY_FLOOR){hit.z+=ahead.z;}
 return hit;
}
/** The distance to the nearest of the three faces ahead, past what has been marched; the face crossed moves on by one cell. */
fn vgDdaStep(hit:ptr<function,vec3f>,inverse:vec3f,marched:f32)->f32{
 let ahead=abs(inverse);
 let now=*hit;
 if(now.x<now.y){
  if(now.x<now.z){
   (*hit).x+=ahead.x;
   return now.x-marched;
  }
  (*hit).z+=ahead.z;
  return now.z-marched;
 }
 if(now.y<now.z){
  (*hit).y+=ahead.y;
  return now.y-marched;
 }
 (*hit).z+=ahead.z;
 return now.z-marched;
}

fn vgTopWord(frustum:bool,index:u32)->u32{
 if(frustum){return gridFrustumTop[index];}
 return gridOrthoTop[index];
}
fn vgExtinctionCell(frustum:bool,index:u32)->vec3f{
 if(frustum){return vgColorOf(gridFrustumExtinction[index]);}
 return vgColorOf(gridExtinction[index]);
}

/** The cells of the bottom level of a top-level cell a ray crosses between two points (in the top level's cell units), each with its
 *  constant extinction. 'worldSpan' is the world length of the ray in the top level, 'voxelLength' its length in cell units. */
fn vgMarchBottomLevel(frustum:bool,worldSpan:f32,voxelLength:f32,topStart:vec3f,topEnd:vec3f,word:u32,transmittance:ptr<function,vec3f>){
 let bottomIndex=vgBottomIndex(word);
 let resolution=vec3f(f32(word&7u));
 let topLength=length(topEnd-topStart);
 let lowest=floor((topStart+topEnd)*0.5);
 let localOrigin=(topStart-lowest)*resolution;
 var localDirection=(topEnd-lowest)*resolution-localOrigin;
 let localLength=length(localDirection);
 localDirection/=localLength;
 let inverse=vec3f(1.0)/localDirection;
 var marched=0.0;
 var position=localOrigin;
 var hit=vgDdaStart(position,localDirection,inverse);
 while(marched<localLength&&all(*transmittance>vec3f(VG_OPACITY_FLOOR))){
  var delta=vgDdaStep(&hit,inverse,marched);
  if(marched+delta>localLength){delta=localLength-marched;}
  let end=position+localDirection*delta;
  let at=clamp((position+end)*0.5,vec3f(0.0),resolution-vec3f(1.0));
  let extinction=vgExtinctionCell(frustum,bottomIndex+mortonEncode3(vec3u(at)));
  let worldDelta=max((delta/localLength)*topLength*worldSpan/voxelLength,0.0);
  *transmittance*=saturate(exp(-extinction*worldDelta));
  marched+=delta;
  position=end;
 }
}

/** The same through a top-level cell that holds indirection cells: each indirection cell the ray crosses with a bottom level of its own is
 *  walked through that. */
fn vgMarchIndirection(worldSpan:f32,voxelLength:f32,topStart:vec3f,topEnd:vec3f,word:u32,transmittance:ptr<function,vec3f>){
 let indirectionIndex=vgBottomIndex(word);
 let resolution=vec3f(f32(word&7u));
 let topLength=length(topEnd-topStart);
 let lowest=floor((topStart+topEnd)*0.5);
 let localOrigin=(topStart-lowest)*resolution;
 var localDirection=(topEnd-lowest)*resolution-localOrigin;
 let localLength=length(localDirection);
 localDirection/=localLength;
 let inverse=vec3f(1.0)/localDirection;
 var marched=0.0;
 var position=localOrigin;
 var hit=vgDdaStart(position,localDirection,inverse);
 while(marched<localLength&&all(*transmittance>vec3f(VG_OPACITY_FLOOR))){
  var delta=vgDdaStep(&hit,inverse,marched);
  if(marched+delta>localLength){delta=localLength-marched;}
  let end=position+localDirection*delta;
  let at=clamp((position+end)*0.5,vec3f(0.0),resolution-vec3f(1.0));
  let inner=gridIndirection[indirectionIndex+mortonEncode3(vec3u(at))];
  if(vgIsAllocated(inner)){
   vgMarchBottomLevel(false,worldSpan*topLength/localLength,voxelLength,position,end,inner,transmittance);
  }
  marched+=delta;
  position=end;
 }
}

/** The ray from 'origin' along 'direction' (in cell units of the top level) from 'tMin' to 'tMax', 'worldSpan' its length in the world:
 *  each cell it crosses, with a bottom level, walked into; a cell of one voxel is crossed in one step. */
fn vgMarchTopLevel(frustum:bool,indirection:bool,origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,worldSpan:f32,resolution:vec3i,transmittance:ptr<function,vec3f>){
 let inverse=vec3f(1.0)/direction;
 var marched=tMin;
 var position=origin;
 var hit=vgDdaStart(position,direction,inverse);
 let last=vec3f(resolution-vec3i(1));
 while(marched<tMax&&all(*transmittance>vec3f(VG_OPACITY_FLOOR))){
  var delta=vgDdaStep(&hit,inverse,marched);
  if(marched+delta>tMax){delta=tMax-marched;}
  let end=position+direction*delta;
  let at=clamp((position+end)*0.5,vec3f(0.0),last);
  let word=vgTopWord(frustum,vgLinearIndex(vec3u(at),resolution));
  if(vgIsAllocated(word)){
   if(indirection&&!frustum){
    vgMarchIndirection(worldSpan,tMax,position,end,word,transmittance);
   }else if((word&7u)>1u){
    vgMarchBottomLevel(frustum,worldSpan,tMax,position,end,word,transmittance);
   }else{
    let worldDelta=max(delta*worldSpan/tMax,0.0);
    *transmittance*=saturate(exp(-vgExtinctionCell(frustum,vgBottomIndex(word))*worldDelta));
   }
  }
  marched+=delta;
  position=end;
 }
}

/** The transmittance of the ortho grid along the world ray from 'tMin' to 'tMax'; one where the ray misses the grid. */
fn vgTraceOrtho(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32)->vec3f{
 var transmittance=vec3f(1.0);
 let clip=hvIntersectAabb(origin,direction,tMin,tMax,gridParams.orthoMin,gridParams.orthoMax);
 if(clip.x>clip.y){return transmittance;}
 let extent=gridParams.orthoMax-gridParams.orthoMin;
 let resolution=vec3f(gridParams.orthoResolution);
 let voxelBegin=(origin+direction*clip.x-gridParams.orthoMin)/extent*resolution;
 let voxelEnd=(origin+direction*clip.y-gridParams.orthoMin)/extent*resolution;
 var voxelDirection=voxelEnd-voxelBegin;
 let voxelLength=length(voxelDirection);
 voxelDirection/=voxelLength;
 vgMarchTopLevel(false,gridParams.indirection!=0,voxelBegin,voxelDirection,0.0,voxelLength,clip.y-clip.x,gridParams.orthoResolution,&transmittance);
 return transmittance;
}

/** The transmittance of the frustum grid along the world ray from 'tMin' to 'tMax'; the span is given back clipped to the grid (empty,
 *  zero to zero, where the ray misses it). */
fn vgTraceFrustum(origin:vec3f,direction:vec3f,tMin:ptr<function,f32>,tMax:ptr<function,f32>)->vec3f{
 var transmittance=vec3f(1.0);
 let viewOrigin=(gridParams.worldToView*vec4f(origin,1.0)).xyz;
 let viewAhead=(gridParams.worldToView*vec4f(origin+direction,1.0)).xyz;
 var voxelOrigin=vgViewToVoxel(viewOrigin);
 var voxelDirection=vgViewToVoxel(viewAhead)-voxelOrigin;
 let toVoxel=length(voxelDirection);
 voxelDirection/=toVoxel;
 let clip=hvIntersectAabb(voxelOrigin,voxelDirection,*tMin*toVoxel,*tMax*toVoxel,vec3f(0.0),vec3f(gridParams.frustumResolution));
 if(clip.x>clip.y){
  *tMin=0.0;
  *tMax=0.0;
  return transmittance;
 }
 voxelOrigin+=voxelDirection*clip.x;
 let voxelLength=clip.y-clip.x;
 let toWorld=1.0/toVoxel;
 vgMarchTopLevel(true,false,voxelOrigin,voxelDirection,0.0,voxelLength,voxelLength*toWorld,gridParams.frustumResolution,&transmittance);
 *tMin=clip.x*toWorld;
 *tMax=clip.y*toWorld;
 return transmittance;
}`,
)
