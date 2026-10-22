import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { DOF_PARAMS_WGSL, DOF_STEP_WGSL, DOF_TILE_WGSL } from './dofCommonWgsl.ts'
import { COC_TILE, GROUP, TILE_FORMAT } from './dofLayout.ts'

/** The flattening's bindings: the circle of confusion read, the two tile images written. */
export const FLATTEN_BINDINGS = { coc: 2, fg: 3, bg: 4 } as const
/** The dilation's: the tiles read, the dilated minimum and maximum read, the tiles written. */
export const DILATE_BINDINGS = {
  fg: 2,
  bg: 3,
  minMaxFg: 4,
  minMaxBg: 5,
  outFg: 6,
  outBg: 7,
} as const

/** The dilation's kinds, as the pipeline constant `MODE` reads them. */
export const DILATE_MODES = { standalone: 0, minMax: 1, minAbs: 2 } as const

/** The range of the circles at one texel of the gather: its own circle, or the four of the setup around it. */
const FLAT_TILE_WGSL = wgslBlock(
  'FLAT_TILE_WGSL',
  [DOF_PARAMS_WGSL, DOF_TILE_WGSL],
  `override GATHER4:bool=false;
@group(0) @binding(${FLATTEN_BINDINGS.coc}) var cocTexture:texture_2d<f32>;
fn cocLoad(p:vec2i,last:vec2i)->f32{return textureLoad(cocTexture,clamp(p,vec2i(0),last),0).x;}
fn flatTile(id:vec2u)->CocTile{
 if(!GATHER4){return cocTileOf(cocLoad(vec2i(min(id,view.gather.xy-vec2u(1u))),vec2i(view.gather.xy)-vec2i(1)));}
 let last=vec2i(view.pre.xy)-vec2i(1);
 let stride=vec2f(view.pre.xy)/vec2f(view.gather.xy);
 let at=vec2i(floor(min(vec2f(id)*stride+0.5,vec2f(view.pre.xy)-0.5)-0.5));
 var tile=cocTileOf(cocLoad(at,last));
 for(var i=1;i<4;i++){
  let other=cocTileOf(cocLoad(at+vec2i(i%2,i/2),last));
  tile=CocTile(min(tile.fgMin,other.fgMin),max(tile.fgMax,other.fgMax),min(tile.bgMin,other.bgMin),max(tile.bgMax,other.bgMax),min(tile.bgNear,other.bgNear),0.0);
 }
 return tile;
}`,
)

/**
 * The tiles of the circle of confusion's range: each workgroup of `COC_TILE` texels a side of the
 * gather reduces the circles of its texels — a texel past the gather's edge reads the edge's — to
 * the foreground's smallest and largest circle, the background's largest, smallest and smallest
 * intersectable, one tile texel; the distance to the closest geometry starts at the smallest
 * background circle. The reduction halves the lanes in workgroup memory. Where the setup is accumulated
 * at another size than the gather (`GATHER4`), each texel reads the 2 × 2 texels of the setup around its
 * place (`stride`, the setup's size over the gather's), the range of the four.
 */
export const cocFlattenShader = () =>
  wgslProgram(
    `@group(0) @binding(${FLATTEN_BINDINGS.fg}) var fgOut:texture_storage_2d<${TILE_FORMAT},write>;
@group(0) @binding(${FLATTEN_BINDINGS.bg}) var bgOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> ranges:array<vec4f,${COC_TILE * COC_TILE}>;
var<workgroup> nears:array<f32,${COC_TILE * COC_TILE}>;
@compute @workgroup_size(${GROUP},${GROUP})
fn flattenCoc(@builtin(global_invocation_id) gid:vec3u,@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatTile(gid.xy);
 ranges[lane]=vec4f(tile.fgMin,tile.fgMax,tile.bgMin,tile.bgMax);
 nears[lane]=tile.bgNear;
 ${workgroupSumLoop(COC_TILE * COC_TILE, 'let a=ranges[lane];let b=ranges[lane+stride];ranges[lane]=vec4f(min(a.x,b.x),max(a.y,b.y),min(a.z,b.z),max(a.w,b.w));nears[lane]=min(nears[lane],nears[lane+stride]);')}
 if(lane==0u){
  let r=ranges[0];
  textureStore(fgOut,vec2i(wg.xy),cocTileFg(CocTile(r.x,r.y,r.z,r.w,nears[0],r.z)));
  textureStore(bgOut,vec2i(wg.xy),cocTileBg(CocTile(r.x,r.y,r.z,r.w,nears[0],r.z)));
 }
}`,
    [FLAT_TILE_WGSL],
  )

/** One tile's neighbour sample's reach, in tiles of the largest circle's error. */
const NEIGHBOURS = `
fn openBucket()->CocTile{return CocTile(0.0,-DOF_EXTREME,DOF_EXTREME,0.0,DOF_EXTREME,DOF_EXTREME);}
fn ringSquare(ring:u32,batch:u32)->vec2i{
 let r=i32(ring);
 if(batch<ring){return vec2i(r,i32(batch));}
 if(batch<ring*3u){return vec2i(r-i32(batch-ring),r);}
 return vec2i(-r,r-(i32(batch)-i32(ring*3u)));
}`

/** The dilation's overrides, its bindings and the reading of a ring of neighbours into buckets. */
const BUCKETS_WGSL = wgslBlock(
  'BUCKETS_WGSL',
  [DOF_PARAMS_WGSL, DOF_STEP_WGSL, DOF_TILE_WGSL],
  `override RADIUS:u32=1u;
override MODE:u32=0u;
@group(0) @binding(${DILATE_BINDINGS.fg}) var fgIn:texture_2d<f32>;
@group(0) @binding(${DILATE_BINDINGS.bg}) var bgIn:texture_2d<f32>;
@group(0) @binding(${DILATE_BINDINGS.minMaxFg}) var minMaxFg:texture_2d<f32>;
@group(0) @binding(${DILATE_BINDINGS.minMaxBg}) var minMaxBg:texture_2d<f32>;
@group(0) @binding(${DILATE_BINDINGS.outFg}) var fgOut:texture_storage_2d<${TILE_FORMAT},write>;
@group(0) @binding(${DILATE_BINDINGS.outBg}) var bgOut:texture_storage_2d<${TILE_FORMAT},write>;${NEIGHBOURS}
fn tileAt(p:vec2i)->CocTile{return cocTileRead(textureLoad(fgIn,p,0),textureLoad(bgIn,p,0));}
fn mergeNeighbour(bucket:ptr<function,CocTile>,n:CocTile,closest:f32){
 let reach=closest*view.basis.z;
 (*bucket).fgMin=min((*bucket).fgMin,n.fgMin);
 (*bucket).fgMax=max((*bucket).fgMax,n.fgMax);
 (*bucket).bgMin=min((*bucket).bgMin,n.bgMin);
 (*bucket).bgMax=max((*bucket).bgMax,n.bgMax);
 (*bucket).bgNear=min((*bucket).bgNear,n.bgNear+reach);
 (*bucket).bgCloser=min((*bucket).bgCloser,n.bgCloser+reach);
}
fn fillBuckets(pos:vec2i,multiplier:i32)->array<CocTile,3>{
 var buckets:array<CocTile,3>;
 let count=vec2i(view.tiles.xy);
 for(var b=0u;b<RADIUS;b++){
  let ring=b+1u;
  var bucket=openBucket();
  for(var batch=0u;batch<4u*ring;batch++){
   let square=ringSquare(ring,batch);
   for(var s=0u;s<2u;s++){
    let offset=select(1,-1,s==1u)*(multiplier*square);
    let at=pos+offset;
    if(any(at<vec2i(0))||any(at>=count)){continue;}
    let closest=length(max(f32(multiplier)*(${COC_TILE}.0*abs(vec2f(offset)))-${COC_TILE}.0,vec2f(0.0)));
    mergeNeighbour(&bucket,tileAt(at),closest);
   }
  }
  buckets[b]=bucket;
 }
 return buckets;
}`,
)

/**
 * The dilation of the tiles' ranges: each tile reads the tiles in square rings around it, up to
 * `RADIUS` of them at `step.a.x` tiles apart, and sorts them into one bucket a ring — the foreground's
 * smallest and largest circles, the background's, the smallest it can intersect and the conservative
 * distance to closer geometry, each against the distance of the neighbour's tile —; then keeps from
 * the buckets those whose circle is large enough to reach the tile (`basis.y` and `basis.z`, the bound
 * of a circle's reach in tiles and its inverse, the error of the kernel's centre included).
 * Three kinds (`MODE`): a stand-alone dilation; one that keeps the minimum foreground and maximum
 * background circles alone; one that takes those from the minimum-maximum pass and dilates the rest.
 */
export const dilateShader = () =>
  wgslProgram(
    `@compute @workgroup_size(${GROUP},${GROUP})
fn dilateCoc(@builtin(global_invocation_id) gid:vec3u){
 let pos=vec2i(gid.xy);
 let multiplier=select(i32(dofStep.a.x),1,MODE==0u);
 let fMultiplier=f32(multiplier);
 var buckets=fillBuckets(pos,multiplier);
 var out=tileAt(min(pos,vec2i(view.tiles.xy)-vec2i(1)));
 if(MODE==2u){
  let held=min(pos,vec2i(view.tiles.xy)-vec2i(1));
  let pinned=cocTileRead(textureLoad(minMaxFg,held,0),textureLoad(minMaxBg,held,0));
  out.fgMin=pinned.fgMin;
  out.bgMax=pinned.bgMax;
 }else{
  for(var k=0u;k<RADIUS;k++){
   let spread=fMultiplier*(f32(k+1u)*${COC_TILE}.0)-${COC_TILE}.0;
   if(-buckets[k].fgMin*view.basis.y>spread){out.fgMin=min(out.fgMin,buckets[k].fgMin);}
   if(buckets[k].bgMax*view.basis.y>spread){out.bgMax=max(out.bgMax,buckets[k].bgMax);}
  }
 }
 for(var k=0u;k<RADIUS;k++){
  let spread=fMultiplier*(f32(k+1u)*${COC_TILE}.0)-${COC_TILE}.0;
  if(-out.fgMin*view.basis.y>spread){out.fgMax=max(out.fgMax,buckets[k].fgMax);}
  if(out.bgMax*view.basis.y>spread){
   out.bgMin=min(out.bgMin,buckets[k].bgMin);
   out.bgNear=min(out.bgNear,buckets[k].bgNear);
  }
  out.bgCloser=min(out.bgCloser,buckets[k].bgCloser);
 }
 if(MODE==1u){out.fgMax=0.0;out.bgMin=0.0;out.bgNear=0.0;out.bgCloser=0.0;}
 if(all(gid.xy<view.tiles.xy)){
  textureStore(fgOut,pos,cocTileFg(out));
  textureStore(bgOut,pos,cocTileBg(out));
 }
}`,
    [BUCKETS_WGSL, DOF_PARAMS_WGSL, DOF_STEP_WGSL, DOF_TILE_WGSL],
  )
