import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { pixelToNdc, transformHomogeneousPoint } from '../../../math/src/wgsl/projection.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { HAIR_AABB_PRECISION_SCALE } from './boundsWgsl.ts'
import { HAIR_DEEP_SHADOW_MAX_SLOTS, HAIR_DEEP_SHADOW_TILE_BINS } from './deepShadowMath.ts'
import { HAIR_MACRO_GROUP_SHIFT } from './materialMath.ts'
import { HAIR_RIBBON_WGSL, HAIR_VIEW_WGSL, HAIR_VIEW_WORDS } from './ribbonWgsl.ts'
import { SEGMENT_VERTICES } from './transmittanceWgsl.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_GROUP_SIZE,
} from './visibilityMath.ts'

/** The words a slot's view block takes in the buffer of blocks: padded to 64 so that a bind group can name
 *  it at an offset of a uniform buffer (256 bytes). */
const HAIR_DEEP_SHADOW_BLOCK_WORDS = 64
if (HAIR_VIEW_WORDS > HAIR_DEEP_SHADOW_BLOCK_WORDS)
  throw new Error('the view block outgrew its slot')
/** The words of the parameters of the allocation (`DeepParams`). */
export const HAIR_DEEP_SHADOW_PARAM_WORDS = 16

const SLOTS = HAIR_DEEP_SHADOW_MAX_SLOTS
const BINS = HAIR_DEEP_SHADOW_TILE_BINS

/**
 * THE VIEW OF EACH DEEP SHADOW AND ITS TILE OF THE ATLAS, one thread a slot (a light and a macro group): the
 * group's box is framed from the light — a directional light by an orthographic view of the box's bounding
 * radius, a local one by a perspective view whose half angle covers the box (held to the settings' widest) —
 * the tile it asks is the size the frustum's far face covers on the screen, each tile rounded up to a power of
 * two between the least and the atlas, the tiles packed row after row from the largest, and, where the atlas
 * is too small, every tile halved until they fit. The view's matrices (the plain and the one that carries the
 * tile's scale and bias, which the strands are drawn with), the tile and the least width of a strand there are
 * written for the passes that read the shadow (`DeepViewInfo`), and the block the strands' ribbons read of a
 * view (`HAIR_VIEW_WGSL`) for each slot. The depth is reversed: 1 at the near face, 0 at the far. A
 * right-handed basis is built from the light toward the box's centre, the axis up being z (y where the light
 * looks along z).
 */
export const DEEP_SHADOW_ALLOCATE_WGSL = wgslProgram(
  `struct DeepParams{
 slotResolution:u32,slotCount:u32,macroCount:u32,minTileLog2:u32,
 atlasResolution:u32,rasterScale:f32,aabbScale:f32,maxHalfFov:f32,
 texelSize:f32,minNear:f32,pad0:u32,pad1:u32,
 pad2:u32,pad3:u32,pad4:u32,pad5:u32}
struct DeepLight{direction:vec3f,owner:u32,position:vec3f,directional:u32}
struct DeepViewInfo{toClipScaledBiased:mat4x4f,toClip:mat4x4f,atlasScaleBias:vec4f,viewForward:vec3f,minRadius:f32}
@group(0) @binding(0) var<uniform> params:DeepParams;
@group(0) @binding(1) var<uniform> view:HairView;
@group(0) @binding(2) var<storage,read> lights:array<DeepLight>;
@group(0) @binding(3) var<storage,read> macroAabb:array<i32>;
@group(0) @binding(4) var<storage,read_write> viewInfos:array<DeepViewInfo>;
@group(0) @binding(5) var<storage,read_write> viewBlocks:array<u32>;
const PRECISION=${HAIR_AABB_PRECISION_SCALE}.0;
const BINS=${BINS}u;
const SLOTS=${SLOTS}u;
var<workgroup> binCounts:array<atomic<u32>,${BINS}>;
var<workgroup> bins:array<u32,${BINS * SLOTS}>;
var<workgroup> allocations:array<vec4u,${SLOTS}>;
var<workgroup> desired:array<u32,${SLOTS}>;
// A light's view of a box: the basis (right, up, forward), the eye, the scales of x and y, the depth's
// scale and offset (clip z = zScale * depth + zOffset), whether it is orthographic, the least width at
// depth 1, the far face's distance and the half extent there.
struct LightView{eye:vec3f,right:vec3f,up:vec3f,forward:vec3f,xyScale:f32,zScale:f32,zOffset:f32,ortho:bool,minRadius:f32,farDepth:f32,farExtent:f32,propagation:vec3f}
fn lightView(light:DeepLight,lo:vec3f,hi:vec3f)->LightView{
 let centre=(lo+hi)*0.5;
 let extents=(hi-lo)*0.5;
 let directional=light.directional!=0u;
 let lightPosition=light.position;
 // The coarse view, to measure the box's depth from the light.
 var eye=select(lightPosition,centre-light.direction*length(extents),directional);
 var forward=normalize(centre-eye);
 var upAxis=select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),abs(forward.z)>0.999);
 var right=normalize(cross(forward,upAxis));
 var up=cross(right,forward);
 var low=vec3f(3.4e38);
 var high=vec3f(-3.4e38);
 for(var corner=0u;corner<8u;corner++){
  let p=vec3f(select(lo.x,hi.x,(corner&1u)!=0u),select(lo.y,hi.y,(corner&2u)!=0u),select(lo.z,hi.z,(corner&4u)!=0u))-eye;
  let seen=vec3f(dot(p,right),dot(p,up),dot(p,forward));
  low=min(low,seen);
  high=max(high,seen);
 }
 let lightExtentZ=(high.z-low.z)*0.5;
 let radius=length(extents)*params.aabbScale;
 var minZ=-lightExtentZ*params.aabbScale;
 var maxZ=lightExtentZ*params.aabbScale;
 var result:LightView;
 result.propagation=select(-normalize(lightPosition-centre),light.direction,directional);
 if(directional){
  eye=centre-light.direction*abs(minZ);
  forward=normalize(centre-eye);
  upAxis=select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),abs(forward.z)>0.999);
  right=normalize(cross(forward,upAxis));
  up=cross(right,forward);
  let zScale=1.0/(maxZ-minZ);
  result.eye=eye;result.right=right;result.up=up;result.forward=forward;
  result.xyScale=1.0/radius;
  result.zScale=-zScale;
  result.zOffset=1.0;
  result.ortho=true;
  result.minRadius=radius/f32(params.slotResolution)*params.rasterScale;
  result.farDepth=1.0/zScale;
  result.farExtent=radius;
  return result;
 }
 let distanceToCentre=length(lightPosition-centre);
 maxZ=max(params.minNear*0.2,distanceToCentre)+maxZ;
 minZ=max(params.minNear*0.1,distanceToCentre)+minZ;
 minZ=max(params.minNear,minZ);
 let halfFov=min(params.maxHalfFov,atan(radius/distanceToCentre));
 let tanHalf=tan(halfFov);
 result.eye=eye;result.right=right;result.up=up;result.forward=forward;
 result.xyScale=1.0/tanHalf;
 result.zScale=-minZ/(maxZ-minZ);
 result.zOffset=minZ*maxZ/(maxZ-minZ);
 result.ortho=false;
 result.minRadius=0.5*params.rasterScale*tan(halfFov)/(0.5*f32(params.slotResolution));
 result.farDepth=maxZ;
 result.farExtent=tanHalf*maxZ;
 return result;
}
// The four corners of the view's far face in the world, projected on the camera's screen: their box in pixels.
fn projectedSize(v:LightView)->vec2f{
 var low=vec2f(99999.0);
 var high=vec2f(-99999.0);
 for(var corner=0u;corner<4u;corner++){
  let x=select(-1.0,1.0,(corner&1u)!=0u);
  let y=select(-1.0,1.0,(corner&2u)!=0u);
  let world=v.eye+v.right*(x*v.farExtent)+v.up*(y*v.farExtent)+v.forward*v.farDepth;
  let clip=view.viewProj*vec4f(world,1.0);
  let uv=(clip.xy/clip.w)*vec2f(0.5,-0.5)+vec2f(0.5);
  low=min(low,uv);
  high=max(high,uv);
 }
 return max(high-low,vec2f(0.0))*view.size;
}
fn addToBin(size:vec2f,slot:u32){
 let largest=ceil(max(size.x,size.y));
 var requested=select(0u,u32(ceil(log2(largest))),largest>0.0);
 requested=clamp(requested,params.minTileLog2,params.minTileLog2+BINS-1u);
 let bin=requested-params.minTileLog2;
 let at=atomicAdd(&binCounts[bin],1u);
 bins[bin*SLOTS+at]=slot;
 desired[slot]=max(1u<<params.minTileLog2,u32(largest));
}
fn allocateTiles(){
 var maxAllowed=1u<<(params.minTileLog2+BINS-1u);
 for(var retry=0u;retry<BINS;retry++){
  var offset=vec2u(0u);
  var rowHeight=0u;
  var maxActual=0u;
  for(var i=0u;i<BINS;i++){
   let bin=BINS-1u-i;
   let count=atomicLoad(&binCounts[bin]);
   if(count==0u){continue;}
   let binResolution=min(1u<<(bin+params.minTileLog2),maxAllowed);
   maxActual=max(maxActual,binResolution);
   for(var element=0u;element<count;element++){
    let slot=bins[bin*SLOTS+element];
    let actual=min(desired[slot],binResolution);
    if(offset.x+actual>params.atlasResolution){
     offset.x=0u;
     offset.y+=rowHeight;
     rowHeight=0u;
    }
    allocations[slot]=vec4u(offset,vec2u(actual));
    offset.x+=actual;
    rowHeight=max(rowHeight,actual);
   }
  }
  if(offset.y+rowHeight<=params.atlasResolution){break;}
  maxAllowed=maxActual/2u;
 }
}
@compute @workgroup_size(${SLOTS}) fn hairDeepShadowAllocate(@builtin(local_invocation_index) slot:u32){
 if(slot<BINS){atomicStore(&binCounts[slot],0u);}
 workgroupBarrier();
 var v:LightView;
 if(slot<params.slotCount){
  let light=lights[slot];
  var lo=vec3f(3.4e38);
  var hi=vec3f(-3.4e38);
  if(light.owner<params.macroCount){
   let at=light.owner*6u;
   lo=vec3f(f32(macroAabb[at]),f32(macroAabb[at+1u]),f32(macroAabb[at+2u]))/PRECISION;
   hi=vec3f(f32(macroAabb[at+3u]),f32(macroAabb[at+4u]),f32(macroAabb[at+5u]))/PRECISION;
  }
  v=lightView(light,lo,hi);
  addToBin(projectedSize(v),slot);
 }
 workgroupBarrier();
 if(slot==0u){allocateTiles();}
 workgroupBarrier();
 if(slot<params.slotCount){
  let tile=allocations[slot];
  let scale=vec2f(tile.zw)*params.texelSize;
  var bias=vec2f(tile.xy)*params.texelSize;
  let atlasScaleBias=vec4f(scale,bias);
  bias=bias*vec2f(2.0,-2.0)-vec2f(1.0,-1.0)+vec2f(scale.x,-scale.y);
  // The rows of the view-projection (clip = rows . (p, 1)).
  let eyeRight=dot(v.right,v.eye);
  let eyeUp=dot(v.up,v.eye);
  let eyeForward=dot(v.forward,v.eye);
  let row0=v.xyScale*vec4f(v.right,-eyeRight);
  let row1=v.xyScale*vec4f(v.up,-eyeUp);
  let row2=v.zScale*vec4f(v.forward,-eyeForward)+vec4f(0.0,0.0,0.0,v.zOffset);
  let row3=select(vec4f(v.forward,-eyeForward),vec4f(0.0,0.0,0.0,1.0),v.ortho);
  let biased0=scale.x*row0+bias.x*row3;
  let biased1=scale.y*row1+bias.y*row3;
  viewInfos[slot]=DeepViewInfo(
   mat4x4f(vec4f(biased0.x,biased1.x,row2.x,row3.x),vec4f(biased0.y,biased1.y,row2.y,row3.y),vec4f(biased0.z,biased1.z,row2.z,row3.z),vec4f(biased0.w,biased1.w,row2.w,row3.w)),
   mat4x4f(vec4f(row0.x,row1.x,row2.x,row3.x),vec4f(row0.y,row1.y,row2.y,row3.y),vec4f(row0.z,row1.z,row2.z,row3.z),vec4f(row0.w,row1.w,row2.w,row3.w)),
   atlasScaleBias,v.propagation,v.minRadius);
  // The view block the strands' ribbons read (HAIR_VIEW_WGSL): the biased view-projection, the way the light
  // shines (the ribbons face against it), the least width, the atlas.
  let at=slot*${HAIR_DEEP_SHADOW_BLOCK_WORDS}u;
  var rows=array<vec4f,4>(biased0,biased1,row2,row3);
  for(var column=0u;column<4u;column++){
   for(var r=0u;r<4u;r++){viewBlocks[at+column*4u+r]=bitcast<u32>(rows[r][column]);}
  }
  viewBlocks[at+16u]=bitcast<u32>(v.propagation.x);
  viewBlocks[at+17u]=bitcast<u32>(v.propagation.y);
  viewBlocks[at+18u]=bitcast<u32>(v.propagation.z);
  viewBlocks[at+19u]=bitcast<u32>(select(0.0,1.0,v.ortho));
  for(var k=0u;k<4u;k++){viewBlocks[at+20u+k]=bitcast<u32>(v.minRadius);}
  viewBlocks[at+24u]=bitcast<u32>(f32(params.atlasResolution));
  viewBlocks[at+25u]=bitcast<u32>(f32(params.atlasResolution));
  viewBlocks[at+26u]=0u;
  viewBlocks[at+27u]=0u;
  for(var k=28u;k<${HAIR_VIEW_WORDS}u;k++){viewBlocks[at+k]=0u;}
  // The tile's scale and bias in the biased clip space, in the place of the inverse view-projection's first
  // column, which the strands' raster does not read: it keeps a draw to its tile.
  viewBlocks[at+28u]=bitcast<u32>(scale.x);
  viewBlocks[at+29u]=bitcast<u32>(scale.y);
  viewBlocks[at+30u]=bitcast<u32>(bias.x);
  viewBlocks[at+31u]=bitcast<u32>(bias.y);
 }
}`,
  [HAIR_VIEW_WGSL],
)

/**
 * THE STRANDS DRAWN INTO A DEEP SHADOW: the ribbons of an instance, six vertices a segment, seen from the
 * slot's view (the view block at binding 0 of group 1, naming the slot) — a segment that is not drawn or
 * whose ends have no side is six vertices at a point. The first pass (`hairDeepShadowFrontVs`, no fragment)
 * writes the nearest depth into the atlas; the second (`hairDeepShadowLayersFs`) adds to each of four layers
 * the share of the strand that lies at or in front of the layer's depth behind the front, times the strand's
 * coverage there (its real radius over the larger of that and the pixel's at its depth, the pixel's width
 * the least width at depth 1 times the depth, or the least width itself for an orthographic view), into the
 * four channels of the layers' atlas, summed by the blend unit.
 */
export const DEEP_SHADOW_RASTER_WGSL = wgslProgram(
  `@group(1) @binding(1) var frontDepth:texture_depth_2d;
@group(1) @binding(2) var<uniform> layerDepths:vec4f;
struct VsOut{@builtin(position) @invariant position:vec4f,@location(0) coverage:f32,@location(1) edge:vec3f}
@vertex fn hairDeepShadowVs(@builtin(vertex_index) vertex:u32)->VsOut{
 var result:VsOut;
 result.position=vec4f(0.0,0.0,0.0,1.0);
 result.coverage=0.0;
 let segment=vertex/${SEGMENT_VERTICES}u;
 if(!segmentDrawn(segment)){return result;}
 let first=spineAt(segment);
 let second=spineAt(segment+1u);
 if(!first.ok||!second.ok){return result;}
 let k=vertex%${SEGMENT_VERTICES}u;
 var spine=first;
 if(cornerTip(k)){spine=second;}
 result.position=cornerClip(spine,cornerRight(k));
 // The position in the tile's own clip space: a fragment outside it is another tile's.
 let tile=view.inverseViewProj[0];
 result.edge=vec3f((result.position.x-tile.z*result.position.w)/tile.x,(result.position.y-tile.w*result.position.w)/tile.y,result.position.w);
 let depth=result.position.z/result.position.w;
 let pixelRadius=select(depth*view.radii.x,view.radii.x,view.forward.w!=0.0);
 result.coverage=spine.radius/max(spine.radius,pixelRadius);
 return result;
}
// The front pass writes depth alone, a fragment outside the tile dropped.
@fragment fn hairDeepShadowFrontFs(@location(1) edge:vec3f){
 if(abs(edge.x)>edge.z||abs(edge.y)>edge.z){discard;}
}
@fragment fn hairDeepShadowLayersFs(@builtin(position) position:vec4f,@location(0) coverage:f32,@location(1) edge:vec3f)->@location(0) vec4f{
 if(abs(edge.x)>edge.z||abs(edge.y)>edge.z){discard;}
 let front=textureLoad(frontDepth,vec2i(position.xy),0);
 let behind=max(0.0,front-position.z);
 return select(vec4f(0.0),vec4f(1.0),vec4f(behind)<layerDepths)*coverage;
}`,
  [HAIR_RIBBON_WGSL],
)

/** The taps of the soft kernel's disc. */
const SOFT_SAMPLES = 16

/**
 * THE DEEP SHADOW'S DENSITY FILTERS: the hair count the layers hold at a position of the light's view (its
 * texel position and depth), from the layers' atlas and the front depth's, by the kernel the settings choose —
 * a 2x2 bilinear one, a 3 by 3 of those two texels apart, or a soft one that sizes a 16-tap disc by how far
 * the nearest occluder lies (its aperture in degrees); the count interpolated between the layers by the
 * position's distance behind the front depth, less a bias. Reads `frontDepth` and `domLayers` (its host
 * declares them).
 */
export const DEEP_SHADOW_FILTER_WGSL = wgslBlock(
  'HAIR_DEEP_SHADOW_FILTER_WGSL',
  [],
  `fn distanceToFront(front:f32,z:f32,bias:f32)->f32{return max(0.0,front-z-bias);}
fn interpolateCount(t:f32,a:f32,b:f32)->f32{return saturate((t-a)/(b-a));}
fn hairCountOf(dom:vec4f,behind:f32,layers:vec4f)->f32{
 if(behind<layers.x){return mix(0.0,dom.x,interpolateCount(behind,0.0,layers.x));}
 if(behind<layers.y){return mix(dom.x,dom.y,interpolateCount(behind,layers.x,layers.y));}
 if(behind<layers.z){return mix(dom.y,dom.z,interpolateCount(behind,layers.y,layers.z));}
 if(behind<layers.w){return mix(dom.z,dom.w,interpolateCount(behind,layers.z,layers.w));}
 return dom.w;
}
fn sampleBilinear(position:vec3f,bias:f32,layers:vec4f)->f32{
 let corner=floor(position.xy-vec2f(0.5));
 let c0=vec2i(corner);
 let c1=c0+vec2i(1,0);
 let c2=c0+vec2i(0,1);
 let c3=c0+vec2i(1,1);
 let h0=hairCountOf(textureLoad(domLayers,c0,0),distanceToFront(textureLoad(frontDepth,c0,0),position.z,bias),layers);
 let h1=hairCountOf(textureLoad(domLayers,c1,0),distanceToFront(textureLoad(frontDepth,c1,0),position.z,bias),layers);
 let h2=hairCountOf(textureLoad(domLayers,c2,0),distanceToFront(textureLoad(frontDepth,c2,0),position.z,bias),layers);
 let h3=hairCountOf(textureLoad(domLayers,c3,0),distanceToFront(textureLoad(frontDepth,c3,0),position.z,bias),layers);
 let s=fract(position.xy-(corner+vec2f(0.5)));
 return mix(mix(h0,h1,s.x),mix(h2,h3,s.x),s.y);
}
fn sampleWide(position:vec3f,bias:f32,layers:vec4f)->f32{
 var count=0.0;
 for(var y=-1;y<=1;y++){
  for(var x=-1;x<=1;x++){count+=sampleBilinear(position+vec3f(f32(x)*2.0,f32(y)*2.0,0.0),bias,layers);}
 }
 return count/9.0;
}
var<private> DISC:array<vec2f,16>=array<vec2f,16>(
 vec2f(-0.94201624,-0.39906216),vec2f(0.94558609,-0.76890725),vec2f(-0.094184101,-0.92938870),vec2f(0.34495938,0.29387760),
 vec2f(-0.91588581,0.45771432),vec2f(-0.81544232,-0.87912464),vec2f(-0.38277543,0.27676845),vec2f(0.97484398,0.75648379),
 vec2f(0.44323325,-0.97511554),vec2f(0.53742981,-0.47373420),vec2f(-0.26496911,-0.41893023),vec2f(0.79197514,0.19090188),
 vec2f(-0.24188840,0.99706507),vec2f(-0.81409955,0.91437590),vec2f(0.19984126,0.78641367),vec2f(0.14383161,-0.14100790));
fn sampleSoft(position:vec3f,atlas:f32,bias:f32,layers:vec4f,apertureDegrees:f32)->f32{
 var occluder=0.0;
 for(var k=0u;k<5u;k++){
  let corner=floor(position.xy+DISC[k]*atlas-vec2f(0.5));
  let c0=vec2i(corner);
  for(var t=0u;t<4u;t++){
   let c=c0+vec2i(i32(t&1u),i32(t>>1u));
   occluder=max(occluder,distanceToFront(textureLoad(frontDepth,c,0),position.z,0.0));
  }
 }
 let radius=occluder*tan(apertureDegrees/180.0*3.141592653*0.5);
 var count=0.0;
 for(var k=0u;k<${SOFT_SAMPLES}u;k++){
  count+=sampleBilinear(position+vec3f(DISC[k]*radius*atlas,0.0),bias,layers);
 }
 return count/${SOFT_SAMPLES}.0;
}`,
)

/**
 * THE TRANSMITTANCE OF EACH COMPACTED SAMPLE TOWARD A LIGHT, from its deep shadow: a thread a stored sample;
 * the sample's macro group names the slot (`slots`, one for each group of this light), the sample's place in
 * the world (the visibility's pixel centre at its depth) is carried into the slot's view, into the atlas's texels
 * by the tile's scale and bias, and the hair count is read by the kernel `kernelType` (0 and 4 none: a count of
 * nothing, 1 the 2x2 filter, 2 the wide one, 3 the soft one), less a bias of the first layer's depth times
 * `depthBiasScale`, times `densityScale`; the visibility is 1. A sample whose lighting channels the light
 * does not share gets nothing (the reference first leaves out a pixel the opaque surfaces' shadow of the light
 * wholly took; that light is nil at the sample whatever the mask, so the test is not made). The word is the voxel transmittance's (`packMask`).
 */
export const DEEP_SHADOW_MASK_WGSL = wgslProgram(
  `struct DeepViewInfo{toClipScaledBiased:mat4x4f,toClip:mat4x4f,atlasScaleBias:vec4f,viewForward:vec3f,minRadius:f32}
struct DeepMaskLight{
 layerDepths:vec4f,
 channels:u32,kernelType:u32,atlasResolution:u32,pad0:u32,
 densityScale:f32,depthBiasScale:f32,kernelAperture:f32,pad1:f32}
@group(0) @binding(0) var<storage,read> nodeCoord:array<u32>;
@group(0) @binding(1) var<storage,read> nodeData:array<u32>;
@group(0) @binding(2) var<storage,read> nodeCounter:array<u32>;
@group(0) @binding(3) var<storage,read_write> mask:array<u32>;
@group(0) @binding(4) var<uniform> view:HairView;
@group(0) @binding(5) var<uniform> light:DeepMaskLight;
@group(0) @binding(6) var<storage,read> slots:array<u32>;
@group(0) @binding(7) var<storage,read> viewInfos:array<DeepViewInfo>;
@group(0) @binding(8) var frontDepth:texture_depth_2d;
@group(0) @binding(9) var domLayers:texture_2d<f32>;
fn packMask(hairCount:f32,visibility:f32)->u32{return min(u32(hairCount*1000.0),0x00FFFFFFu)|(min(u32(visibility*255.0),0xFFu)<<24u);}
@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn hairDeepShadowMask(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let slot=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 if(slot>=nodeCounter[${HAIR_NODE_COUNTER_STORED}]){return;}
 let o=slot*${HAIR_NODE_DATA_WORDS}u;
 if((light.channels&((nodeData[o+4u]>>24u)&7u))==0u){mask[slot]=0u;return;}
 let at=nodeCoord[slot];
 let pixel=vec2u(at&${HAIR_COORD_MASK}u,at>>${HAIR_COORD_BITS}u);
 let h=transformHomogeneousPoint(view.inverseViewProj,vec3f(pixelToNdc(vec2f(pixel)+vec2f(0.5),view.size),bitcast<f32>(nodeData[o])));
 let position=h.xyz/h.w;
 let owner=min(nodeData[o+1u]>>${HAIR_MACRO_GROUP_SHIFT}u,15u);
 let mapped=slots[owner];
 // A group this light has no shadow for (out of its reach, or past the slots) is lit.
 if(mapped==0xFFFFFFFFu){mask[slot]=packMask(0.0,1.0);return;}
 let info=viewInfos[mapped];
 let clip=info.toClip*vec4f(position,1.0);
 let ndc=clip.xyz/clip.w;
 let uv=(ndc.xy+vec2f(1.0))*0.5;
 let atlas=f32(light.atlasResolution);
 let scaleBias=info.atlasScaleBias*vec4f(atlas,atlas,atlas,atlas);
 let lightSpace=vec3f(vec2f(uv.x,1.0-uv.y)*scaleBias.xy+scaleBias.zw,ndc.z);
 let bias=select(0.0,light.layerDepths.x*light.depthBiasScale,light.depthBiasScale>0.0);
 var count=0.0;
 if(light.kernelType==3u){count=sampleSoft(lightSpace,atlas,bias,light.layerDepths,light.kernelAperture);}
 else if(light.kernelType==2u){count=sampleWide(lightSpace,bias,light.layerDepths);}
 else if(light.kernelType==1u){count=sampleBilinear(lightSpace,bias,light.layerDepths);}
 mask[slot]=packMask(count*light.densityScale,1.0);
}`,
  [HAIR_VIEW_WGSL, DEEP_SHADOW_FILTER_WGSL, pixelToNdc, transformHomogeneousPoint, FLAT_INDEX_WGSL],
)
